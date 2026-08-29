/**
 * SONE — page and search routes.
 *
 * These read the materialised projection, never the CRDTs. That is the payoff
 * of ADR-0002: a page tree or a search result is one indexed query rather than
 * a walk over documents.
 *
 * Creating a page is the exception: it must write the CRDT log, because the
 * projection is derived and a page row without a document is an empty page.
 * That mistake was made once already, in a test helper, and it is exactly what
 * an importer would repeat.
 */

import {
  readTitleColor,
  readEntryIcon,
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  SCHEMA_VERSION,
  generateKeyBetween,
  type EntryKind,
  derivedTagColor,
  isTagColor,
  tagKey,
} from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import {
  effectiveRole,
  loadPageLocation,
  resolveSessionClaims,
  type AccessClaims,
} from '../auth/claims.js';
import { appendUpdate } from '../doc/docStore.js';
import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import { collateClause, workspaceI18n } from '../i18n/locale.js';
import { applyToDocument, loadDoc } from '../doc/docStore.js';
import { materializeYDoc } from '../materialize/materialize.js';
import { createEntry } from '../pages/createEntry.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { normaliseTags, writeTags } from '@sone/core';
import { requireSession, sessionTokenFrom } from './auth.js';
import { BodyError, type RequestContext, type Router } from './router.js';

export interface PageDeps {
  pool: Pool;
}

async function readBody<T>(ctx: RequestContext): Promise<T | null> {
  try {
    return await ctx.json<T>();
  } catch (err) {
    if (err instanceof BodyError) {
      ctx.fail(err.code === 'body_too_large' ? 413 : 400, err.code);
      return null;
    }
    throw err;
  }
}

type Claims = NonNullable<Awaited<ReturnType<typeof resolveSessionClaims>>>;

/**
 * Resolve claims without writing a response.
 *
 * Each route decides its own failure shape, because the right one differs: a
 * workspace-scoped route answers 403, but a route addressing a specific page
 * must answer 404 — a 403 there tells the caller the page exists in a
 * workspace they cannot see, which is precisely the leak the identical-answer
 * rule exists to prevent. An earlier version used one helper for both and
 * leaked exactly that; a test caught it.
 */
async function claimsOrNull(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
): Promise<Claims | null> {
  const token = sessionTokenFrom(ctx);
  if (!token) return null;
  return resolveSessionClaims(pool, token, workspaceId);
}

/**
 * Claims for a workspace named in the path.
 *
 * Answers 401 without a cookie and 403 for a non-member. Both are safe here:
 * the caller already knows the workspace id it asked about.
 */
async function claimsFor(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
): Promise<Claims | null> {
  if (!sessionTokenFrom(ctx)) {
    ctx.fail(401, 'not_authenticated');
    return null;
  }
  const claims = await claimsOrNull(pool, ctx, workspaceId);
  if (!claims) {
    ctx.fail(403, 'not_authorized');
    return null;
  }
  return claims;
}

/**
 * Re-project a document after the server changed it.
 *
 * Without this the projection lags until a sync room happens to flush, so a
 * rename would appear to do nothing until the page is next opened.
 */
interface MoveInput {
  pageId: string;
  entry: { workspaceId: string; ancestorIds: string[] };
  parentPageId: string | null;
  /**
   * Place the entry directly after this sibling, or first when null.
   *
   * Absent means "last", which is what a move without an opinion about order
   * should do. Present means the caller dropped it at a specific place.
   */
  afterPageId?: string | null | undefined;
  claims: AccessClaims;
  actorId: string | null;
}

type MoveResult = 'ok' | { status: number; code: string };

/**
 * Move an entry into a folder, or to the workspace root.
 *
 * Four rules, and the third is the one that matters most:
 *
 *  1. Only a folder may hold children, and only a folder may sit at the root
 *     (ADR-0019). A page must land in a folder.
 *  2. The destination must be in the same workspace. Moving across workspaces
 *     would carry a page out of the permissions that were granted on it.
 *  3. **A folder cannot move into itself or into one of its own descendants.**
 *     That would detach the subtree from the tree entirely: it would still
 *     exist, be unreachable from the root, and `ancestor_ids` — which every
 *     share link and subtree grant is computed from — would recurse forever.
 *     Checked against the destination's ancestors, which the projection already
 *     maintains.
 *  4. The caller needs edit rights on both ends. Rights on the entry alone
 *     would let someone move a page into a folder they cannot see, and rights
 *     on the destination alone would let them take a page they cannot edit.
 */
async function moveEntry(pool: Pool, input: MoveInput): Promise<MoveResult> {
  const { pageId, entry, parentPageId } = input;

  if (parentPageId === pageId) {
    return { status: 409, code: 'cannot_move_into_itself' };
  }

  const self = await queryOne<{ kind: string }>(
    pool,
    `SELECT kind FROM pages WHERE id = $1`,
    [pageId],
  );
  if (!self) return { status: 404, code: 'not_found' };

  if (parentPageId === null) {
    if (self.kind !== 'folder') {
      return { status: 409, code: 'pages_need_a_folder' };
    }
  } else {
    const parent = await queryOne<{
      id: string;
      workspace_id: string;
      kind: string;
      ancestor_ids: string[];
    }>(
      pool,
      `SELECT id, workspace_id, kind, ancestor_ids FROM pages WHERE id = $1`,
      [parentPageId],
    );
    if (!parent || parent.workspace_id !== entry.workspaceId) {
      return { status: 404, code: 'parent_not_found' };
    }
    if (parent.kind !== 'folder') {
      return { status: 409, code: 'parent_is_not_a_folder' };
    }
    if (parent.ancestor_ids.includes(pageId)) {
      return { status: 409, code: 'cannot_move_into_own_subtree' };
    }

    const parentRole = effectiveRole(input.claims, {
      id: parent.id,
      workspaceId: parent.workspace_id,
      ancestorIds: parent.ancestor_ids,
    });
    if (parentRole === null) return { status: 404, code: 'parent_not_found' };
    if (parentRole === 'viewer' || parentRole === 'commenter') {
      return { status: 403, code: 'not_authorized' };
    }
  }

  // Where among its new siblings.
  //
  // Sorted by (idx, id) throughout, because a fractional-index midpoint is
  // deterministic and two clients can produce the same key (ADR-0015) — so idx
  // alone is not a total order.
  const siblings = await queryRows<{ id: string; idx: string }>(
    pool,
    `SELECT id, idx FROM pages
      WHERE workspace_id = $1 AND parent_page_id IS NOT DISTINCT FROM $2 AND id <> $3
      ORDER BY idx, id`,
    [entry.workspaceId, parentPageId, pageId],
  );

  let idx: string;
  if (input.afterPageId === undefined) {
    // No opinion about order: last, which is where a newly arrived thing
    // belongs when nobody said otherwise.
    idx = generateKeyBetween(siblings[siblings.length - 1]?.idx ?? null, null);
  } else if (input.afterPageId === null) {
    idx = generateKeyBetween(null, siblings[0]?.idx ?? null);
  } else {
    const at = siblings.findIndex((row) => row.id === input.afterPageId);
    if (at === -1) {
      // The sibling named is not in this folder — a stale tree in the client,
      // or a concurrent move. Refused rather than silently placed somewhere
      // arbitrary, because "put it after that one" has no meaning otherwise.
      return { status: 409, code: 'sibling_not_found' };
    }
    idx = generateKeyBetween(siblings[at]!.idx, siblings[at + 1]?.idx ?? null);
  }

  // Written to the document, not the row: the parent lives in the CRDT
  // (ADR-0002), so writing the projection would be undone by the next
  // materialisation and the move would silently revert.
  const result = await applyToDocument(
    pool,
    pageId,
    (doc) => {
      const page = doc.getMap(DOC_KEYS.page);
      page.set(PAGE_KEYS.parentPageId, parentPageId);
      page.set(PAGE_KEYS.idx, idx);
    },
    input.actorId,
  );

  // Re-projected immediately, and the materialiser cascades ancestor_ids to
  // every descendant — without which a share link on the destination would not
  // cover what was just moved into it.
  if (result.changed) {
    await rematerialize(pool, pageId, entry.workspaceId, input.actorId);
  }

  return 'ok';
}

export function registerPageRoutes(router: Router, deps: PageDeps): void {
  /**
   * The page tree for a workspace.
   *
   * Flat list with parent ids rather than a nested structure: the client builds
   * the tree, and a flat response is cheap to diff when one page changes.
   * Filtered to what the caller may actually see.
   */
  router.get('/api/workspaces/:workspaceId/pages', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;

    const i18n = await workspaceI18n(deps.pool, workspaceId);
    const includeArchived = ctx.url.searchParams.get('archived') === 'true';

    // Sorting user-visible titles needs an ICU collation; the database itself
    // is C so that fractional indices compare byte-wise (ADR-0011).
    const rows = await queryRows<{
      id: string;
      parent_page_id: string | null;
      collection_id: string | null;
      idx: string;
      title: string;
      icon: unknown;
      kind: string;
      archived_at: Date | null;
      last_edited_at: Date;
      ancestor_ids: string[];
    }>(
      deps.pool,
      `SELECT id, parent_page_id, collection_id, idx, title, icon, kind,
              archived_at, last_edited_at, ancestor_ids
         FROM pages
        WHERE workspace_id = $1
          AND ($2 OR archived_at IS NULL)
          -- Rows are documents, not places (ADR-0021). A hundred-row table
          -- would otherwise put a hundred entries in the sidebar, which is
          -- the part of the folder shape that felt most wrong.
          AND kind <> 'row'
        ORDER BY idx, id`,
      [workspaceId, includeArchived],
    );
    void collateClause(i18n.sortCollation);

    const visible = rows.filter(
      (row) =>
        effectiveRole(claims, {
          id: row.id,
          workspaceId,
          ancestorIds: row.ancestor_ids,
        }) !== null,
    );

    ctx.send(200, {
      pages: visible.map((row) => ({
        id: row.id,
        parentPageId: row.parent_page_id,
        collectionId: row.collection_id,
        idx: row.idx,
        title: row.title,
        icon: row.icon,
        kind: row.kind === 'folder' ? 'folder' : 'page',
        archived: row.archived_at !== null,
        lastEditedAt: row.last_edited_at,
      })),
    });
  });

  /**
   * Create a page.
   *
   * Writes the CRDT log first, then the projection. Writing only the projection
   * produces a page row whose document is empty, because the CRDTs are the
   * truth (ADR-0002).
   */
  router.post('/api/workspaces/:workspaceId/pages', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;

    const body = await readBody<{
      title?: string;
      parentPageId?: string | null;
      afterPageId?: string | null;
      kind?: string;
    }>(ctx);
    if (!body) return;

    const parentPageId = body.parentPageId ?? null;

    // Defaults to a page, so a client that predates folders keeps working.
    const kind: EntryKind = body.kind === 'folder' ? 'folder' : 'page';
    if (body.kind !== undefined && body.kind !== 'page' && body.kind !== 'folder') {
      ctx.fail(422, 'invalid_kind');
      return;
    }

    if (parentPageId) {
      const parent = await queryOne<{
        id: string;
        workspace_id: string;
        kind: string;
        ancestor_ids: string[];
      }>(
        deps.pool,
        `SELECT id, workspace_id, kind, ancestor_ids FROM pages WHERE id = $1`,
        [parentPageId],
      );
      if (!parent || parent.workspace_id !== workspaceId) {
        ctx.fail(404, 'parent_not_found');
        return;
      }

      // A folder may contain both kinds; a page may contain nothing
      // (ADR-0019). Enforced here rather than in the database, where CRDT
      // updates arriving out of order would make a constraint reject
      // legitimate data. The pages_inside_pages view reports violations that
      // arrive anyway.
      if (parent.kind !== 'folder') {
        ctx.fail(409, 'parent_is_not_a_folder');
        return;
      }

      const role = effectiveRole(claims, {
        id: parent.id,
        workspaceId: parent.workspace_id,
        ancestorIds: parent.ancestor_ids,
      });
      if (role === null || role === 'viewer' || role === 'commenter') {
        ctx.fail(403, 'not_authorized');
        return;
      }
    } else {
      if (claims.workspaceRole === 'guest' || claims.workspaceRole === null) {
        // A guest has no implicit workspace access, so it cannot create a
        // top-level entry.
        ctx.fail(403, 'not_authorized');
        return;
      }
      // Only folders live at the workspace root. A page has to belong
      // somewhere, and "somewhere" is the structure folders exist to provide
      // (ADR-0019) — a root full of loose pages is the pile folders were meant
      // to replace.
      if (kind !== 'folder') {
        ctx.fail(409, 'pages_need_a_folder');
        return;
      }
    }

    const created = await createEntry(deps.pool, {
      workspaceId,
      kind,
      title: body.title ?? '',
      parentPageId,
      actorId: claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
    });

    ctx.send(201, created);
  });

  /** Page metadata. The body itself arrives over the sync connection. */
  router.get('/api/pages/:pageId', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const page = await queryOne<{
      id: string;
      workspace_id: string;
      parent_page_id: string | null;
      collection_id: string | null;
      title: string;
      icon: unknown;
      kind: string;
      cover_url: string | null;
      archived_at: Date | null;
      created_at: Date;
      last_edited_at: Date;
      ancestor_ids: string[];
    }>(
      deps.pool,
      `SELECT id, workspace_id, parent_page_id, collection_id, title, icon, kind,
              cover_url, archived_at, created_at, last_edited_at, ancestor_ids
         FROM pages WHERE id = $1`,
      [pageId],
    );

    if (!page) {
      // Identical to the unauthorised answer below: the distinction reveals
      // which pages exist.
      ctx.fail(404, 'not_found');
      return;
    }

    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }

    // Not a member of the page's workspace is indistinguishable from the page
    // not existing. A 403 here would confirm it exists.
    const claims = await claimsOrNull(deps.pool, ctx, page.workspace_id);
    const role = claims
      ? effectiveRole(claims, {
          id: page.id,
          workspaceId: page.workspace_id,
          ancestorIds: page.ancestor_ids,
        })
      : null;
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }

    ctx.send(200, {
      id: page.id,
      workspaceId: page.workspace_id,
      parentPageId: page.parent_page_id,
      collectionId: page.collection_id,
      title: page.title,
      icon: page.icon,
      kind: page.kind === 'folder' ? 'folder' : 'page',
      coverUrl: page.cover_url,
      archived: page.archived_at !== null,
      createdAt: page.created_at,
      lastEditedAt: page.last_edited_at,
      breadcrumb: page.ancestor_ids,
      role,
    });
  });

  /**
   * Rename an entry.
   *
   * Writes the CRDT document, not the projection. The title lives in the
   * document (ADR-0002), so writing the row would be overwritten by the next
   * materialisation and the rename would silently revert — and any client with
   * the page open would never see it.
   *
   * A folder has no editable body, so this is the only way to rename one.
   */
  router.patch('/api/pages/:pageId', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const page = await loadPageLocation(deps.pool, pageId);
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, page.workspaceId);
    const role = claims ? effectiveRole(claims, page) : null;
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (role === 'viewer' || role === 'commenter') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const body = await readBody<{
      title?: string;
      parentPageId?: string | null;
      /** Only meaningful alongside parentPageId. */
      afterPageId?: string | null;
      tags?: string[];
    }>(ctx);
    if (!body) return;

    const actorId =
      claims!.principal.kind === 'anonymous' ? null : claims!.principal.userId;

    // --- moving --------------------------------------------------------

    if ('parentPageId' in body) {
      const moved = await moveEntry(deps.pool, {
        pageId,
        entry: page,
        parentPageId: body.parentPageId ?? null,
        // `undefined` and `null` mean different things here — last versus
        // first — so the key's presence is what is tested, not its value.
        ...('afterPageId' in body ? { afterPageId: body.afterPageId } : {}),
        claims: claims!,
        actorId,
      });
      if (moved !== 'ok') {
        ctx.fail(moved.status, moved.code);
        return;
      }
      if (typeof body.title !== 'string' && !Array.isArray(body.tags)) {
        ctx.send(200, { id: pageId, parentPageId: body.parentPageId ?? null });
        return;
      }
    }

    // --- tags ----------------------------------------------------------

    if (Array.isArray(body.tags)) {
      const cleaned = normaliseTags(body.tags);
      const result = await applyToDocument(
        deps.pool,
        pageId,
        (doc) => {
          writeTags(doc, cleaned);
        },
        actorId,
      );
      if (result.changed) {
        await rematerialize(deps.pool, pageId, page.workspaceId, actorId);
      }
      if (typeof body.title !== 'string') {
        ctx.send(200, { id: pageId, tags: cleaned });
        return;
      }
    }

    // A title is required only when nothing else was asked for.
    //
    // Setting an icon should not mean sending the current title back, which
    // would overwrite whatever somebody else renamed it to in the meantime —
    // a lost rename for a change that had nothing to do with the name.
    const wantsIcon = 'icon' in body;
    const wantsTitleColor = 'titleColor' in body;

    if (typeof body.title !== 'string' && !wantsIcon && !wantsTitleColor) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    const title =
      typeof body.title === 'string' ? body.title.trim().slice(0, 512) : null;

    // An icon and the two colours around it, when the request carries them.
    //
    // Stored in the same jsonb the schema has had a column for since the first
    // migration and nothing ever wrote. The title colour lives beside the icon
    // rather than inside it: colouring a name and colouring its icon are two
    // decisions, and one is commonly wanted without the other.
    const icon = wantsIcon ? readEntryIcon(body.icon) : undefined;
    const titleColor = wantsTitleColor
      ? readTitleColor({ titleColor: body.titleColor })
      : undefined;

    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        const page = doc.getMap(DOC_KEYS.page);
        if (title !== null) page.set(PAGE_KEYS.title, title);

        if (wantsIcon || wantsTitleColor) {
          const existing = page.get(PAGE_KEYS.icon);
          const current =
            existing && typeof existing === 'object' && !Array.isArray(existing)
              ? (existing as Record<string, unknown>)
              : {};

          const next: Record<string, unknown> = { ...current };
          // Null clears rather than storing a default, the same distinction
          // block attributes make: an entry with no icon has to keep following
          // whatever the tree draws by default.
          if (wantsIcon) {
            if (icon) Object.assign(next, icon);
            else {
              delete next['kind'];
              delete next['value'];
              delete next['color'];
            }
          }
          if (wantsTitleColor) {
            if (titleColor) next['titleColor'] = titleColor;
            else delete next['titleColor'];
          }

          if (Object.keys(next).length === 0) page.delete(PAGE_KEYS.icon);
          else page.set(PAGE_KEYS.icon, next);
        }
      },
      actorId,
    );

    // Materialised straight away so the sidebar reflects the new title on the
    // next fetch rather than waiting for a sync room to flush.
    if (result.changed) {
      await rematerialize(deps.pool, pageId, page.workspaceId, actorId);
    }

    ctx.send(200, {
      id: pageId,
      ...(title !== null ? { title } : {}),
      ...(wantsIcon ? { icon } : {}),
      ...(wantsTitleColor ? { titleColor } : {}),
    });
  });

  /**
   * Every tag used in a workspace, with how many pages carry it.
   *
   * A query rather than a table: a tag exists because a page carries it, so an
   * unused one simply stops existing (ADR-0020).
   *
   * Counted over pages the caller can actually see. Without that, the tag list
   * would report how much exists in a workspace regardless of access — which
   * leaks the shape of things somebody was not given.
   */
  router.get('/api/workspaces/:workspaceId/tags', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, workspaceId);
    if (!claims) {
      ctx.fail(404, 'not_found');
      return;
    }

    // One row per (tag, page) with the page's ancestor path, because access is
    // decided per page and `effectiveRole` needs that path. Grouped afterwards
    // rather than in SQL: a GROUP BY would count pages the caller cannot see,
    // and a tag list that reports how much exists regardless of access leaks
    // the shape of things somebody was not given.
    const rows = await queryRows<{
      tag_key: string;
      tag_label: string;
      page_id: string;
      ancestor_ids: string[];
    }>(
      deps.pool,
      `SELECT t.tag_key, t.tag_label, t.page_id, p.ancestor_ids
         FROM page_tags t
         JOIN pages p ON p.id = t.page_id
        WHERE t.workspace_id = $1
          AND p.archived_at IS NULL
        ORDER BY t.tag_key COLLATE "und-x-icu", t.tag_label, t.page_id`,
      [workspaceId],
    );

    const byKey = new Map<string, { key: string; label: string; count: number }>();
    for (const row of rows) {
      const role = effectiveRole(claims, {
        id: row.page_id,
        workspaceId,
        ancestorIds: row.ancestor_ids,
      });
      if (role === null) continue;

      const existing = byKey.get(row.tag_key);
      if (existing) existing.count += 1;
      else {
        // The first label in the sorted order becomes the spelling shown, so
        // the answer is stable rather than whichever row the planner reached
        // first.
        byKey.set(row.tag_key, { key: row.tag_key, label: row.tag_label, count: 1 });
      }
    }

    // Chosen colours, if any. Decorative (ADR-0020): a tag with no row here is
    // not missing anything, it simply keeps the colour derived from its name.
    const chosen = await queryRows<{ tag_key: string; color: string }>(
      deps.pool,
      `SELECT tag_key, color FROM workspace_tag_colors WHERE workspace_id = $1`,
      [workspaceId],
    );
    const overrides = new Map(chosen.map((row) => [row.tag_key, row.color]));

    ctx.send(200, {
      tags: [...byKey.values()].map((tag) => ({
        ...tag,
        // Resolved here rather than in each client, so a tag is the same colour
        // in the sidebar, the properties panel and anywhere else it appears.
        color: overrides.get(tag.key) ?? derivedTagColor(tag.key),
        // Whether the colour was chosen or derived, so the picker can show
        // "default" as a state rather than guessing from the value.
        colorChosen: overrides.has(tag.key),
      })),
    });
  });

  /**
   * Choose a colour for a tag, or go back to the derived one.
   *
   * Workspace-wide, because a tag is workspace-wide: the same name on two pages
   * is one tag, and letting it be two colours would say otherwise.
   *
   * Any member who can edit may set one. It is decoration, and a workspace where
   * only administrators may colour a tag would simply have uncoloured tags.
   */
  router.put('/api/workspaces/:workspaceId/tags/:tagKey/color', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, workspaceId);
    if (!claims) {
      ctx.fail(404, 'not_found');
      return;
    }
    // 'guest' is the only workspace role that cannot; the others are owner,
    // admin and member. My first version also excluded 'viewer', which is a
    // *page* role and not a workspace one — the compiler pointed out that the
    // comparison could never be true.
    if (claims.workspaceRole === null || claims.workspaceRole === 'guest') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    let body: { color?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    // Normalised, so "Urgent" and "urgent" colour one tag rather than two.
    const key = tagKey(ctx.params['tagKey'] ?? '');
    if (key === '') {
      ctx.fail(422, 'invalid_tag');
      return;
    }

    const actorId = claims.principal.kind === 'anonymous' ? null : claims.principal.userId;

    if (body.color === null) {
      // Back to the derived colour. Deleting the row rather than storing the
      // derived value: stored, it would stop following the name if the
      // derivation ever changed, and it would look like somebody chose it.
      await deps.pool.query(
        `DELETE FROM workspace_tag_colors WHERE workspace_id = $1 AND tag_key = $2`,
        [workspaceId, key],
      );
      ctx.send(200, { key, color: derivedTagColor(key), colorChosen: false });
      return;
    }

    if (!isTagColor(body.color)) {
      // A palette name, not a colour value.
      ctx.fail(422, 'unsupported_color');
      return;
    }

    await deps.pool.query(
      `INSERT INTO workspace_tag_colors (workspace_id, tag_key, color, set_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (workspace_id, tag_key) DO UPDATE
         SET color = EXCLUDED.color, set_by = EXCLUDED.set_by, set_at = now()`,
      [workspaceId, key, body.color, actorId],
    );
    ctx.send(200, { key, color: body.color, colorChosen: true });
  });

  /**
   * Archive a page.
   *
   * Archive rather than delete: a note tool's users delete things they wanted.
   * Hard deletion is a separate, explicit operation.
   */
  router.delete('/api/pages/:pageId', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const page = await loadPageLocation(deps.pool, pageId);
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, page.workspaceId);
    const role = claims ? effectiveRole(claims, page) : null;
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }
    // 403 rather than 404 once read access is established: at that point the
    // caller already knows the page exists, and "you may look but not change
    // this" is the useful answer.
    if (role === 'viewer' || role === 'commenter') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    // The subtree goes with it, or archiving a parent leaves its children
    // reachable from search but not from the tree.
    await deps.pool.query(
      `UPDATE pages SET archived_at = now()
        WHERE archived_at IS NULL
          AND (id = $1 OR $1 = ANY(ancestor_ids))`,
      [pageId],
    );
    ctx.sendEmpty(204);
  });

  /**
   * What is in the workspace's trash.
   *
   * Only what was archived *directly*. Archiving a folder archives its subtree,
   * and listing every descendant would show one deletion as forty entries and
   * bury the thing somebody is looking for. A descendant is identified by
   * having an archived ancestor.
   */
  router.get('/api/workspaces/:workspaceId/trash', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;

    const rows = await queryRows<{
      id: string;
      title: string;
      kind: string;
      archived_at: Date;
      ancestor_ids: string[];
      parent_page_id: string | null;
      descendants: string;
      parent_missing: boolean;
    }>(
      deps.pool,
      `SELECT p.id, p.title, p.kind, p.archived_at, p.ancestor_ids, p.parent_page_id,
              (SELECT count(*) FROM pages c
                WHERE p.id = ANY(c.ancestor_ids) AND c.archived_at IS NOT NULL)::text
                AS descendants,
              -- Whether restoring would put it back somewhere that still
              -- exists. A parent that is itself archived means restoring this
              -- alone would leave it unreachable from the tree.
              (p.parent_page_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM pages q
                  WHERE q.id = p.parent_page_id AND q.archived_at IS NULL
               )) AS parent_missing
         FROM pages p
        WHERE p.workspace_id = $1
          AND p.archived_at IS NOT NULL
          -- One archiving action produces one entry.
          --
          -- Archiving a folder stamps every descendant in a single UPDATE, so
          -- they share a timestamp; those went with their parent and are not
          -- separate things to restore. An entry archived on its own, before or
          -- after its folder, has a different timestamp and is listed — it was
          -- a separate decision and deserves a separate way back.
          AND NOT EXISTS (
            SELECT 1 FROM pages a
             WHERE a.id = ANY(p.ancestor_ids)
               AND a.archived_at = p.archived_at
          )
        ORDER BY p.archived_at DESC`,
      [workspaceId],
    );

    const visible = rows.filter(
      (row) =>
        effectiveRole(claims, {
          id: row.id,
          workspaceId,
          ancestorIds: row.ancestor_ids,
        }) !== null,
    );

    ctx.send(200, {
      entries: visible.map((row) => ({
        id: row.id,
        title: row.title,
        kind: row.kind === 'folder' ? 'folder' : 'page',
        archivedAt: row.archived_at,
        descendants: Number(row.descendants),
        parentMissing: row.parent_missing,
      })),
    });
  });

  /**
   * Restore an archived entry and everything that went with it.
   *
   * The subtree comes back too, because it was archived as one action and
   * restoring only the top would leave the children in the trash, invisible
   * from both the tree and the trash listing.
   *
   * If the parent folder is gone, the entry is restored to the workspace root
   * rather than refused — but only if it is a folder. A page cannot sit at the
   * root (ADR-0019), so one whose folder is gone has nowhere to go and says so
   * instead of being restored somewhere arbitrary.
   */
  router.post('/api/pages/:pageId/restore', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const page = await loadPageLocation(deps.pool, pageId);
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, page.workspaceId);
    const role = claims ? effectiveRole(claims, page) : null;
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (role === 'viewer' || role === 'commenter') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const row = await queryOne<{
      kind: string;
      parent_page_id: string | null;
      archived_at: Date | null;
    }>(
      deps.pool,
      `SELECT kind, parent_page_id, archived_at FROM pages WHERE id = $1`,
      [pageId],
    );
    if (!row || row.archived_at === null) {
      ctx.fail(409, 'not_archived');
      return;
    }

    const parentAlive =
      row.parent_page_id === null ||
      (await queryOne(
        deps.pool,
        `SELECT 1 FROM pages WHERE id = $1 AND archived_at IS NULL`,
        [row.parent_page_id],
      )) !== null;

    if (!parentAlive) {
      if (row.kind !== 'folder') {
        // Reported rather than guessed at. Silently putting a page somewhere
        // else is how somebody loses track of it a second time.
        ctx.fail(409, 'parent_missing');
        return;
      }
      const actorId =
        claims!.principal.kind === 'anonymous' ? null : claims!.principal.userId;
      const result = await applyToDocument(
        deps.pool,
        pageId,
        (doc) => {
          doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.parentPageId, null);
        },
        actorId,
      );
      if (result.changed) {
        await rematerialize(deps.pool, pageId, page.workspaceId, actorId);
      }
    }

    await deps.pool.query(
      `UPDATE pages SET archived_at = NULL
        WHERE archived_at IS NOT NULL
          AND (id = $1 OR $1 = ANY(ancestor_ids))`,
      [pageId],
    );

    ctx.send(200, { id: pageId, restoredToRoot: !parentAlive });
  });

  /**
   * Delete permanently.
   *
   * The explicit operation the archive route's comment has been promising.
   *
   * Deletes the row, which cascades to the document updates, snapshots, files
   * and permissions. That is genuinely irreversible: the CRDT log is where the
   * content lives, so once it is gone the page cannot be rebuilt from anything
   * except a database backup.
   *
   * Two guards. It only works on something already archived, so a single
   * mistaken call cannot destroy a live page — deleting is always two steps.
   * And it requires admin rather than edit rights, because destroying content
   * is not the same kind of act as changing it.
   */
  router.delete('/api/pages/:pageId/permanently', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const page = await loadPageLocation(deps.pool, pageId);
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, page.workspaceId);
    const role = claims ? effectiveRole(claims, page) : null;
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (role !== 'admin') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const row = await queryOne<{ archived_at: Date | null }>(
      deps.pool,
      `SELECT archived_at FROM pages WHERE id = $1`,
      [pageId],
    );
    if (!row || row.archived_at === null) {
      // Deleting is always two steps: archive, then destroy. A single mistaken
      // call cannot take a live page with it.
      ctx.fail(409, 'not_archived');
      return;
    }

    // The documents have to go explicitly.
    //
    // `doc_updates.doc_id` and `doc_snapshots.doc_id` carry no foreign key to
    // `pages` — deliberately, because a CRDT update can arrive before the row it
    // belongs to and a constraint would reject data that is merely early
    // (migration 0003). The consequence here is that deleting the page alone
    // would remove the entry and leave its entire content behind as rows nothing
    // references: invisible, unreclaimable, and still growing the database.
    //
    // Found by a test asserting the updates were gone, which they were not.
    const removed = await withTransaction(deps.pool, async (client) => {
      const ids = await queryRows<{ id: string }>(
        client,
        `SELECT id FROM pages WHERE id = $1 OR $1 = ANY(ancestor_ids)`,
        [pageId],
      );
      const docIds = ids.map((row) => row.id);

      await client.query(`DELETE FROM doc_updates WHERE doc_id = ANY($1::uuid[])`, [
        docIds,
      ]);
      await client.query(`DELETE FROM doc_snapshots WHERE doc_id = ANY($1::uuid[])`, [
        docIds,
      ]);
      const result = await client.query(
        `DELETE FROM pages WHERE id = ANY($1::uuid[])`,
        [docIds],
      );
      return result.rowCount ?? 0;
    });

    ctx.send(200, { id: pageId, deleted: removed });
  });

  /**
   * Full-text search within a workspace.
   *
   * Queries both the workspace dictionary and `simple`, matching how the index
   * is built (ADR-0011), so a German search for "Häuser" finds "Haus" while
   * content in another language still matches exactly.
   */
  router.get('/api/workspaces/:workspaceId/search', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;

    const raw = (ctx.url.searchParams.get('q') ?? '').trim();
    if (raw.length < 2) {
      // One character matches most of the workspace and is never what anyone
      // meant.
      ctx.send(200, { results: [], query: raw });
      return;
    }

    const limit = Math.min(50, Number(ctx.url.searchParams.get('limit') ?? '20') || 20);
    const i18n = await workspaceI18n(deps.pool, workspaceId);

    // websearch_to_tsquery rather than to_tsquery: it accepts what a person
    // types, including quotes and "or", instead of erroring on a bare space.
    const rows = await queryRows<{
      page_id: string;
      title: string;
      icon: unknown;
      ancestor_ids: string[];
      rank: number;
    }>(
      deps.pool,
      `SELECT ps.page_id, p.title, p.icon, p.ancestor_ids,
              greatest(
                ts_rank(ps.tsv, websearch_to_tsquery($3::regconfig, $2)),
                ts_rank(ps.tsv, websearch_to_tsquery('simple', $2))
              ) AS rank
         FROM page_search ps
         JOIN pages p ON p.id = ps.page_id
        WHERE ps.workspace_id = $1
          AND p.archived_at IS NULL
          AND (ps.tsv @@ websearch_to_tsquery($3::regconfig, $2)
               OR ps.tsv @@ websearch_to_tsquery('simple', $2))
        ORDER BY rank DESC, p.last_edited_at DESC
        LIMIT $4`,
      [workspaceId, raw, i18n.searchConfig, limit],
    );

    const visible = rows.filter(
      (row) =>
        effectiveRole(claims, {
          id: row.page_id,
          workspaceId,
          ancestorIds: row.ancestor_ids,
        }) !== null,
    );

    ctx.send(200, {
      query: raw,
      results: visible.map((row) => ({
        pageId: row.page_id,
        title: row.title,
        icon: row.icon,
        breadcrumb: row.ancestor_ids,
        rank: row.rank,
      })),
    });
  });

  /** Sessions list needs the user; kept here so the client has one origin. */
  router.get('/api/me', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    ctx.send(200, {
      id: auth.userId,
      displayName: auth.displayName,
      email: auth.email,
    });
  });
}
