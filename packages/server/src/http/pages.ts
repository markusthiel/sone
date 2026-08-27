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
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  SCHEMA_VERSION,
  generateKeyBetween,
  type EntryKind,
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
async function rematerialize(
  pool: Pool,
  pageId: string,
  workspaceId: string,
  actorId: string | null,
): Promise<void> {
  const loaded = await loadDoc(pool, pageId);
  try {
    await withTransaction(pool, (client) =>
      materializeYDoc(client, pageId, loaded.doc, {
        throughSeq: loaded.throughSeq,
        workspaceId,
        actorId,
      }),
    );
  } finally {
    loaded.doc.destroy();
  }
}

interface MoveInput {
  pageId: string;
  entry: { workspaceId: string; ancestorIds: string[] };
  parentPageId: string | null;
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

  // Placed last among its new siblings. Sorted by (idx, id), because a
  // fractional-index midpoint is deterministic and two clients can produce the
  // same key (ADR-0015).
  const siblings = await queryRows<{ idx: string }>(
    pool,
    `SELECT idx FROM pages
      WHERE workspace_id = $1 AND parent_page_id IS NOT DISTINCT FROM $2 AND id <> $3
      ORDER BY idx DESC, id DESC LIMIT 1`,
    [entry.workspaceId, parentPageId, pageId],
  );
  const idx = generateKeyBetween(siblings[0]?.idx ?? null, null);

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
        claims: claims!,
        actorId,
      });
      if (moved !== 'ok') {
        ctx.fail(moved.status, moved.code);
        return;
      }
      if (typeof body.title !== 'string') {
        ctx.send(200, { id: pageId, parentPageId: body.parentPageId ?? null });
        return;
      }
    }

    if (typeof body.title !== 'string') {
      ctx.fail(422, 'missing_fields');
      return;
    }

    const title = body.title.trim().slice(0, 512);

    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, title);
      },
      actorId,
    );

    // Materialised straight away so the sidebar reflects the new title on the
    // next fetch rather than waiting for a sync room to flush.
    if (result.changed) {
      await rematerialize(deps.pool, pageId, page.workspaceId, actorId);
    }

    ctx.send(200, { id: pageId, title });
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
