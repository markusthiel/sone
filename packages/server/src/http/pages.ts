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

import { isUuid } from '../sync/protocol.js';

import {
  readTitleColor,
  readEntryCover,
  readEntryIcon,
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  SCHEMA_VERSION,
  generateKeyBetween,
  type EntryKind,
  type Role,
  derivedTagColor,
  isTagColor,
  tagKey,
} from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import {
  diffVersions,
  hasSearchCriteria,
  parseSearchQuery,
  type SearchFilters,
} from '@sone/core';

import {
  canEdit,
  effectiveRole,
  loadPageLocation,
  resolveSessionClaims,
  restrictedAtSql,
  type AccessClaims,
} from '../auth/claims.js';
import { deleteDocumentsFor } from '../doc/deleteDocuments.js';
import { appendUpdate } from '../doc/docStore.js';
import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import { collateClause, workspaceI18n } from '../i18n/locale.js';
import { readDocument } from '../materialize/readDocument.js';
import { applyToDocument, loadDoc } from '../doc/docStore.js';
import {
  VERSION_RETENTION_DAYS,
  listVersions,
  loadVersion,
  previousVersion,
  restoreInto,
  takeVersion,
} from '../doc/versions.js';
import { materializeYDoc } from '../materialize/materialize.js';
import { createEntry } from '../pages/createEntry.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { moveToWorkspace } from '../pages/moveWorkspace.js';
import { normaliseTags, writeTags } from '@sone/core';
import {
  claimsFor,
  claimsOrNull,
  requireSession,
  sessionTokenFrom,
  type Claims,
} from './auth.js';
import { BodyError, type RequestContext, type Router } from './router.js';
import { roleIn } from '../auth/claims.js';
import { isPathOnlyCondition, visiblePagesCondition } from '../pages/access.js';

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
/**
 * Claims for a workspace named in the path.
 *
 * Answers 401 without a cookie and 403 for a non-member. Both are safe here:
 * the caller already knows the workspace id it asked about.
 */
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
      path_only: boolean;
      restricted_at: string | null;
    }>(
      pool,
      `SELECT id, workspace_id, kind, ancestor_ids,
              ${restrictedAtSql('pages')} AS restricted_at
         FROM pages WHERE id = $1`,
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
      // Fetched with the row, because no listing filtered this one.
      restrictedAt: parent.restricted_at,
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

/**
 * Below how many results a search offers similar names instead (ADR-0036).
 *
 * Five: enough that a search which worked is left alone, low enough that one
 * which nearly failed gets help.
 */
const SIMILAR_THRESHOLD = 5;

/** How many suggestions. A typo producing twenty has not produced an answer. */
const SIMILAR_LIMIT = 5;

/**
 * How close a name has to be.
 *
 * 0.4 on `word_similarity` admits one or two wrong letters in a word and refuses
 * a different word. Written as a literal in the query rather than a parameter so
 * the planner can use it against the trigram index.
 */
const SIMILARITY_FLOOR = 0.4;

/**
 * How much of an entry the preview says (ADR-0071).
 *
 * Forty blocks is a screen or two — enough to recognise a page and to see
 * whether the part that mattered is in it. More would be the page, and the
 * preview is deliberately not the page: it exists so somebody can decide
 * whether to restore a thing, not so they can read it in the trash.
 */
const PREVIEW_BLOCKS = 40;

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
      cover: unknown;
      kind: string;
      template: boolean;
      locked: boolean;
      archived_at: Date | null;
      last_edited_at: Date;
      ancestor_ids: string[];
      path_only: boolean;
      restricted_at: string | null;
    }>(
      deps.pool,
      `SELECT p.id, p.parent_page_id, p.collection_id, p.idx, p.title, p.icon, p.cover,
              p.kind, p.template, p.locked, p.archived_at, p.last_edited_at, p.ancestor_ids,
              -- A page somebody reaches only as the path to a child they were
              -- granted. It appears, and the interface draws it without its
              -- title (ADR-0026).
              NOT ${visiblePagesCondition('p', '$3')} AS path_only,
              -- Fetched rather than assumed. The filter below used to be told
              -- the page was unrestricted, on the grounds that the listing
              -- condition had already excluded restricted ones — true of every
              -- row except the ones path_only exists for. A page kept as a path
              -- is kept *because* it is restricted.
              ${restrictedAtSql('p')} AS restricted_at
         FROM pages p
        WHERE p.workspace_id = $1
          AND ($2 OR p.archived_at IS NULL)
          -- Rows are documents, not places (ADR-0021). A hundred-row table
          -- would otherwise put a hundred entries in the sidebar, which is
          -- the part of the folder shape that felt most wrong.
          -- Rows and containers are documents, not places: a row belongs to a
          -- collection and a container to the page that embeds it, and neither
          -- has anywhere to sit in a tree of pages.
          AND p.kind NOT IN ('row', 'container')
          AND (
            ${visiblePagesCondition('p', '$3')}
            OR ${isPathOnlyCondition('p', '$3')}
          )
        ORDER BY p.idx, p.id`,
      [
        workspaceId,
        includeArchived,
        // No "and are they an admin" any more: whoever the workspace makes a
        // page admin sees it all, restricted or not, and the condition asks
        // that for itself rather than trusting each caller to work it out
        // (ADR-0087).
        claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
      ],
    );
    void collateClause(i18n.sortCollation);

    /*
     * Kept: what they may reach, and what they need in order to reach it.
     *
     * The second half was computed, documented and thrown away. `path_only`
     * marks a page somebody reaches only as the **path** to a child they were
     * granted — ADR-0026 requires it to appear, without its title, or the child
     * is reachable only by knowing its address. This filter then dropped
     * exactly those rows, because a page nobody may read resolves to no role.
     *
     * It went unnoticed because it only bites somebody whose role gives them
     * nothing. A member resolved to `editor` on the restricted ancestor and
     * kept it by accident — helped by the `restricted: false` that used to be
     * passed here. A **guest**, which is the case the feature exists for, got
     * the granted page as a root of the sidebar, floating outside the section
     * it lives in.
     */
    /*
     * The role, kept rather than thrown away (ADR-0095).
     *
     * This was a `filter` that computed `effectiveRole` for every row, compared
     * it with null and discarded it. So the answer to "what may this person do
     * with this entry" was worked out here, once per entry, and then a list of
     * pages that all look alike was sent — and the shell, having nothing to
     * ask, drew a rename field and three create buttons on a folder somebody
     * may only read, each of which the server answers 403 to.
     *
     * That is the third time in this codebase that a value was computed, used
     * for a decision, and dropped before anybody could see it (ADR-0088,
     * ADR-0091). It is the cheapest kind of feature there is: the work was
     * already being done.
     */
    const visible: Array<{ row: (typeof rows)[number]; role: Role | null }> = [];
    for (const row of rows) {
      const role = effectiveRole(claims, {
        id: row.id,
        workspaceId,
        ancestorIds: row.ancestor_ids,
        restrictedAt: row.restricted_at,
      });
      if (row.path_only || role !== null) visible.push({ row, role });
    }

    ctx.send(200, {
      pages: visible.map(({ row, role }) => ({
        id: row.id,
        parentPageId: row.parent_page_id,
        collectionId: row.collection_id,
        idx: row.idx,
        // A page kept only as the path to a child gives up its title.
        //
        // It has to appear, or the child it leads to is reachable only by
        // knowing its address — but its name is exactly what was withheld, and
        // sending it "so the interface can hide it" is sending it.
        title: row.path_only ? null : row.title,
        pathOnly: row.path_only,
        /*
         * What this person may do with this entry (ADR-0095).
         *
         * Null for a page kept only as a path: they may do nothing at all with
         * the row itself, and "no role" is the honest answer rather than a
         * missing field. Sent for every entry — a field that is usually there
         * is a field every caller handles twice, and the shell would then have
         * to decide what an absent one means, which is the question this
         * answers.
         */
        role: row.path_only ? null : role,
        icon: row.path_only ? null : row.icon,
        /*
         * The cover, so a folder can draw its own without opening a document
         * (ADR-0117).
         *
         * The folder view has no document open — it renders the tree node it
         * was handed, the same way it renames through a route rather than
         * through a Y.Doc. Read through core here rather than passed on raw, so
         * a value the projection is holding from before a rule changed cannot
         * reach a browser as a cover it would refuse.
         *
         * Withheld with the title for a path-only page: a picture is a fact
         * about a page somebody was told nothing about.
         */
        cover: row.path_only ? null : readEntryCover(row.cover),
        // A canvas is drawn differently in the tree and opened differently, so
        // the kind travels rather than being flattened to 'page'.
        kind:
          row.kind === 'folder' || row.kind === 'canvas'
            ? (row.kind as 'folder' | 'canvas')
            : 'page',
        // Sent so the ⋮ menu knows which label to show without a request of
        // its own — and withheld with the title for a path-only page, since a
        // page somebody cannot read should disclose nothing about itself.
        template: row.path_only ? false : row.template,
        // So the tree can draw a padlock, and the ⋮ menu knows which way its
        // toggle points, without opening the document (ADR-0049).
        locked: row.path_only ? false : row.locked,
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
      /** A template to start this page from (ADR-0045). */
      templateId?: unknown;
    }>(ctx);
    if (!body) return;

    const parentPageId = body.parentPageId ?? null;

    // Defaults to a page, so a client that predates folders keeps working.
    //
    // A canvas is a third kind rather than a page with a different body
    // (ADR-0043): it gets the tree, the trash, permissions, sharing and moving
    // between workspaces by being a page, and none of those had to learn what a
    // canvas is.
    const CREATABLE: readonly string[] = ['page', 'folder', 'canvas'];
    if (body.kind !== undefined && !CREATABLE.includes(body.kind)) {
      ctx.fail(422, 'invalid_kind');
      return;
    }
    const kind: EntryKind = CREATABLE.includes(body.kind ?? '')
      ? (body.kind as EntryKind)
      : 'page';

    if (parentPageId) {
      const parent = await queryOne<{
        id: string;
        workspace_id: string;
        kind: string;
        ancestor_ids: string[];
        restricted_at: string | null;
      }>(
        deps.pool,
        `SELECT id, workspace_id, kind, ancestor_ids,
              ${restrictedAtSql('pages')} AS restricted_at
         FROM pages WHERE id = $1`,
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
        /*
         * Fetched, not assumed.
         *
         * This passed a literal `null` and said "the listing condition above
         * already excluded restricted pages" — a sentence copied from a route
         * that has a listing. This one does not: it is a create, and the parent
         * arrives as an id in the request body. So a member whose role gives
         * `editor` could create a page inside a restricted folder they cannot
         * open, and the folder's own restriction had nothing to say about it.
         *
         * The same false sentence, in the same words, was what discarded
         * `path_only` in the tree route (ADR-0088). It is worth noticing that
         * both were found by changing a boolean into an id: an assumption
         * survives review, and a value that has to come from somewhere does
         * not.
         */
        restrictedAt: parent.restricted_at,
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

    /*
     * Started from a template, if one was named (ADR-0045).
     *
     * Checked here rather than in `createEntry`: whether this person may read
     * that template is an authorisation question and belongs with the other
     * ones. A template in another workspace is refused as not found, which is
     * the same answer a page in another workspace gets — the distinction would
     * say whether it exists.
     */
    let fromTemplate: Uint8Array | undefined;
    if (typeof body.templateId === 'string' && body.templateId !== '') {
      const template = await queryOne<{ id: string; template: boolean }>(
        deps.pool,
        `SELECT id, template FROM pages
          WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`,
        [body.templateId, workspaceId],
      );
      if (!template || !template.template) {
        ctx.fail(404, 'not_found');
        return;
      }
      const loaded = await loadDoc(deps.pool, template.id);
      try {
        fromTemplate = Y.encodeStateAsUpdate(loaded.doc);
      } finally {
        loaded.doc.destroy();
      }
    }

    const created = await createEntry(deps.pool, {
      workspaceId,
      kind,
      title: body.title ?? '',
      parentPageId,
      ...(fromTemplate ? { fromTemplate } : {}),
      actorId: claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
    });

    ctx.send(201, created);
  });

  /**
   * Every thread in the workspace that is still waiting (ADR-0046).
   *
   * The question the projection exists for: no amount of opening documents
   * answers "what has somebody asked that nobody has answered" well.
   *
   * Open by default, because that is the list somebody comes here for.
   * `?state=detached` for threads whose text has been deleted — unfinished
   * business of a different kind — and `?state=resolved` for decisions that were
   * made, which are worth being able to find.
   */
  router.get('/api/workspaces/:workspaceId/comments', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;

    const state = ctx.url.searchParams.get('state') ?? 'open';
    if (state !== 'open' && state !== 'resolved' && state !== 'detached') {
      ctx.fail(422, 'invalid_state');
      return;
    }

    const rows = await queryRows<{
      page_id: string;
      title: string;
      thread_id: string;
      quote: string;
      resolved: boolean;
      detached: boolean;
      messages: number;
      opened_by: string | null;
      last_message_at: Date | null;
    }>(
      deps.pool,
      `SELECT c.page_id, p.title, c.thread_id, c.quote, c.resolved, c.detached,
              c.messages, c.opened_by, c.last_message_at
         FROM page_comments c
         JOIN pages p ON p.id = c.page_id
        WHERE p.workspace_id = $1
          AND p.archived_at IS NULL
          AND ${
            state === 'resolved'
              ? 'c.resolved'
              : state === 'detached'
                ? 'NOT c.resolved AND c.detached'
                : 'NOT c.resolved AND NOT c.detached'
          }
          -- The same visibility condition as the tree and search. A quotation
          -- from a page somebody may not read is a disclosure, and this list is
          -- made of quotations.
          AND ${visiblePagesCondition('p', '$2')}
        ORDER BY c.last_message_at DESC NULLS LAST, c.thread_id
        LIMIT 200`,
      [
        workspaceId,
        claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
      ],
    );

    ctx.send(200, {
      threads: rows.map((row) => ({
        pageId: row.page_id,
        pageTitle: row.title,
        threadId: row.thread_id,
        quote: row.quote,
        resolved: row.resolved,
        detached: row.detached,
        messages: Number(row.messages),
        openedBy: row.opened_by,
        lastMessageAt: row.last_message_at,
      })),
    });
  });

  /**
   * The shapes a page can be started from (ADR-0045).
   *
   * Only ones this person may read: a template is an ordinary page and its
   * permissions are the page's own, so a restricted template is invisible to
   * somebody who could not open it — otherwise the menu would offer a shape
   * that then refuses to be copied.
   */
  router.get('/api/workspaces/:workspaceId/templates', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;

    const rows = await queryRows<{
      id: string;
      title: string;
      icon: unknown;
      kind: string;
    }>(
      deps.pool,
      `SELECT p.id, p.title, p.icon, p.kind
         FROM pages p
        WHERE p.workspace_id = $1
          AND p.template
          AND p.archived_at IS NULL
          -- The same condition the tree and search use, rather than a second
          -- one: its own comment says the copy that drifts is a disclosure, and
          -- a template's title discloses as much as a search result's.
          AND ${visiblePagesCondition('p', '$2')}
        ORDER BY p.title, p.id`,
      [
        workspaceId,
        claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
      ],
    );

    ctx.send(200, {
      templates: rows.map((row) => ({
        id: row.id,
        title: row.title,
        icon: row.icon,
        kind: row.kind === 'canvas' ? 'canvas' : 'page',
      })),
    });
  });

  /**
   * May this person read this page?
   *
   * Extracted rather than copied for the version routes: the check above is
   * eleven lines with three separate reasons to answer 404, and a second copy
   * of it is a second thing to keep in step — which the comment on
   * `visiblePagesCondition` already says is how a disclosure happens.
   */
  const mayReadPage = async (
    ctx: Parameters<Parameters<typeof router.get>[1]>[0],
    pageId: string,
  ): Promise<boolean> => {
    const page = await queryOne<{
      id: string;
      workspace_id: string;
      ancestor_ids: string[];
      restricted_at: string | null;
    }>(
      deps.pool,
      `SELECT id, workspace_id, ancestor_ids, restricted
         FROM pages WHERE id = $1 AND archived_at IS NULL`,
      [pageId],
    );
    if (!page) {
      ctx.fail(404, 'not_found');
      return false;
    }
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return false;
    }
    const claims = await claimsOrNull(deps.pool, ctx, page.workspace_id);
    const role = claims
      ? effectiveRole(claims, {
          id: page.id,
          workspaceId: page.workspace_id,
          ancestorIds: page.ancestor_ids,
          restrictedAt: page.restricted_at,
        })
      : null;
    if (role === null) {
      // Not a member is indistinguishable from the page not existing.
      ctx.fail(404, 'not_found');
      return false;
    }
    return true;
  };


  /**
   * Which pages point at this one (ADR-0174).
   *
   * The other direction of the links panel. *What does this page link to* is
   * answered from the open document; *who points here* is a question about
   * documents nobody has open, so it is answered from the projection.
   *
   * **The visibility condition is on the source page, not the target.** The
   * reader is already looking at the target — `mayReadPage` has just said so —
   * and what must not leak is the existence, the title or the count of the
   * pages linking in. A backlink from a page somebody may not open is a
   * disclosure exactly as a search result from it is, which is what
   * `visiblePagesCondition`'s own comment says about the copy that drifts.
   *
   * Read rights are enough to ask. Somebody who may read this page may be told
   * which of the pages they may *also* read refer to it — the condition is the
   * same one the tree and search use, so the answer cannot be larger than what
   * the sidebar already shows them.
   */
  router.get('/api/pages/:pageId/backlinks', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    if (!(await mayReadPage(ctx, pageId))) return;

    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const rows = await queryRows<{
      id: string;
      title: string | null;
      icon: unknown;
      kind: string;
      from_block_id: string;
    }>(
      deps.pool,
      `SELECT src.id, src.title, src.icon, src.kind, l.from_block_id
         FROM page_links l
         JOIN pages src ON src.id = l.from_page_id
        WHERE l.to_page_id = $1
          -- The trash is not a place to be sent (ADR-0027), and a page on its
          -- way out still holds its links.
          AND src.archived_at IS NULL
          AND ${visiblePagesCondition('src', '$2')}
        -- By title so the list reads as a list, with the id as a tiebreaker so
        -- two pages of one name do not swap places between requests.
        ORDER BY src.title, src.id, l.from_block_id
        LIMIT 200`,
      [pageId, session.userId],
    );

    ctx.send(200, {
      backlinks: rows.map((row) => ({
        pageId: row.id,
        title: row.title,
        icon: row.icon,
        kind: row.kind === 'canvas' ? 'canvas' : row.kind === 'folder' ? 'folder' : 'page',
        blockId: row.from_block_id,
      })),
    });
  });

  /**
   * What this page said, at moments worth keeping (ADR-0047).
   *
   * Read rights are enough: a version is the page, and somebody who may read it
   * now may read what it said on Tuesday.
   */
  router.get('/api/pages/:pageId/versions', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    if (!(await mayReadPage(ctx, pageId))) return;

    const versions = await listVersions(deps.pool, pageId);

    ctx.send(200, {
      versions: versions.map((version) => ({
        id: version.id,
        takenAt: version.takenAt,
        authors: version.authors,
        reason: version.reason,
      })),
      /*
       * How far back this goes, said rather than implied.
       *
       * History begins when it is switched on, and every page older than that
       * has one collapsed state and no past — no amount of work recovers what
       * compaction discarded. A list that stops without saying why looks like a
       * page nobody edited before then (ADR-0047).
       */
      retentionDays: VERSION_RETENTION_DAYS,
      complete: false,
    });
  });

  /**
   * One version, as text.
   *
   * The state is a Yjs document; what a reader wants is what it said. So this
   * projects it the same way the materialiser does and sends that — the client
   * has no business decoding a document it cannot edit.
   */
  router.get('/api/pages/:pageId/versions/:versionId', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    if (!(await mayReadPage(ctx, pageId))) return;

    const loaded = await loadVersion(deps.pool, pageId, ctx.params['versionId'] ?? '');
    if (!loaded) {
      ctx.fail(404, 'not_found');
      return;
    }

    try {
      const parsed = readDocument(loaded.doc, pageId);
      ctx.send(200, {
        id: loaded.row.id,
        takenAt: loaded.row.takenAt,
        authors: loaded.row.authors,
        title: parsed.page.title,
        blocks: parsed.blocks.map((block) => ({
          id: block.id,
          parentId: block.parentId,
          type: block.type,
          text: block.plainText,
          // A heading's level, a todo's state: without them a version is drawn
          // as a wall of paragraphs, which is what it was.
          props: block.props,
        })),
      });
    } finally {
      loaded.doc.destroy();
    }
  });

  /**
   * What changed between a version and its neighbour, or between it and now
   * (ADR-0053).
   *
   * `?against=now` compares it with the page as it stands — "what have I
   * missed"; the default compares it with the version before it — "what did
   * this edit do". Two questions rather than a matrix of pairs: an arbitrary
   * pair needs two pickers and answers something nobody asked for.
   *
   * Computed here because both states are already open on this side. Sending
   * two whole documents to the client so it can compare them is, for a hundred
   * pages, the archive twice.
   */
  router.get('/api/pages/:pageId/versions/:versionId/diff', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    if (!(await mayReadPage(ctx, pageId))) return;

    const against = ctx.url.searchParams.get('against') === 'now' ? 'now' : 'previous';

    const loaded = await loadVersion(deps.pool, pageId, ctx.params['versionId'] ?? '');
    if (!loaded) {
      ctx.fail(404, 'not_found');
      return;
    }

    const blocksOf = (parsed: ReturnType<typeof readDocument>) =>
      parsed.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        text: block.plainText,
      }));

    try {
      const mine = blocksOf(readDocument(loaded.doc, pageId));

      if (against === 'now') {
        const live = await loadDoc(deps.pool, pageId);
        try {
          // This version on the left, now on the right: the answer to "what has
          // happened since" reads forwards, like the page does.
          ctx.send(200, {
            against,
            ...diffVersions(mine, blocksOf(readDocument(live.doc, pageId))),
          });
        } finally {
          live.doc.destroy();
        }
        return;
      }

      const earlier = await previousVersion(deps.pool, pageId, loaded.row.id);
      if (!earlier) {
        // The first version has nothing before it. Not an error: its whole
        // content is what it introduced, and saying so is more useful than a
        // 404 for a question that is simply about the beginning.
        ctx.send(200, {
          against,
          isFirst: true,
          changes: mine.map((block) => ({ kind: 'added', block })),
          unmatched: 0,
        });
        return;
      }

      try {
        ctx.send(200, {
          against,
          ...diffVersions(blocksOf(readDocument(earlier.doc, pageId)), mine),
        });
      } finally {
        earlier.doc.destroy();
      }
    } finally {
      loaded.doc.destroy();
    }
  });

  /**
   * Make the page read as it did (ADR-0047).
   *
   * Edit rights, not read: this changes the page. And a version of the page as
   * it stood *before* the restore is taken first — otherwise the state somebody
   * is about to replace would be the one moment with no entry, which is the
   * moment they are most likely to want back.
   */
  router.post('/api/pages/:pageId/versions/:versionId/restore', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const versionId = ctx.params['versionId'] ?? '';

    const page = await queryOne<{
      id: string;
      workspace_id: string;
      ancestor_ids: string[];
      restricted_at: string | null;
    }>(
      deps.pool,
      `SELECT p.id, p.workspace_id, p.ancestor_ids,
              ${restrictedAtSql('p')} AS restricted_at
         FROM pages p
        WHERE p.id = $1 AND p.archived_at IS NULL`,
      [pageId],
    );
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }
    const claims = await claimsFor(deps.pool, ctx, page.workspace_id);
    if (!claims) return;
    // `canEdit` rather than a comparison written here: the role ladder already
    // has a helper, and I started to hand-roll one — which is how a fifth place
    // ends up disagreeing with the other four about what an editor may do.
    if (
      !canEdit(claims, {
        id: page.id,
        workspaceId: page.workspace_id,
        ancestorIds: page.ancestor_ids,
        restrictedAt: page.restricted_at,
      })
    ) {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const loaded = await loadVersion(deps.pool, pageId, versionId);
    if (!loaded) {
      ctx.fail(404, 'not_found');
      return;
    }

    const actorId =
      claims.principal.kind === 'anonymous' ? null : claims.principal.userId;

    try {
      // The state about to be replaced, recorded first.
      const current = await loadDoc(deps.pool, pageId);
      try {
        await takeVersion(deps.pool, pageId, current.doc, current.throughSeq, 'restore', [
          ...(actorId ? [actorId] : []),
        ]);
      } finally {
        current.doc.destroy();
      }

      await applyToDocument(
        deps.pool,
        pageId,
        (doc) => restoreInto(doc, loaded.doc),
        actorId,
      );
      await rematerialize(deps.pool, pageId, page.workspace_id, actorId);
    } finally {
      loaded.doc.destroy();
    }

    ctx.send(200, { ok: true });
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
      cover: unknown;
      archived_at: Date | null;
      created_at: Date;
      last_edited_at: Date;
      ancestor_ids: string[];
      path_only: boolean;
      restricted_at: string | null;
      width: 'column' | 'full' | null;
    }>(
      deps.pool,
      `SELECT p.id, p.workspace_id, p.parent_page_id, p.collection_id, p.title, p.icon,
              p.kind, p.cover, p.width, p.archived_at, p.created_at, p.last_edited_at,
              p.ancestor_ids,
              ${restrictedAtSql('p')} AS restricted_at
         FROM pages p WHERE p.id = $1`,
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
          restrictedAt: page.restricted_at,
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
      cover: readEntryCover(page.cover),
      width: page.width,
      archived: page.archived_at !== null,
      createdAt: page.created_at,
      lastEditedAt: page.last_edited_at,
      breadcrumb: page.ancestor_ids,
      role,
    });
  });

  /**
   * What an entry says, as text, without opening it (ADR-0071).
   *
   * For the trash: restoring is a decision, and "Notizen" as a title is not
   * enough to make it — somebody has to be able to see what is in a thing
   * before deciding whether to bring it back or destroy it. Opening it is not
   * an option, because an archived page is not in the tree and the editor
   * cannot reach it.
   *
   * Read from the projection the materialiser already writes for search:
   * `blocks.plain_text`, in document order. Nothing new is stored, and nothing
   * is computed here — this is a read of a table that exists.
   *
   * Text only, never marks or attachments. A preview that tried to be the page
   * would be a second renderer to keep in step with the first, and this one has
   * one job: enough to recognise the thing.
   */
  router.get('/api/pages/:pageId/preview', async (ctx) => {
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
    // Reading is enough. Every role that may read the page may read what it
    // says, which is the same rule the page itself follows.
    if (!claims || effectiveRole(claims, page) === null) {
      ctx.fail(404, 'not_found');
      return;
    }

    // One more than the limit, so "there is more" is known rather than guessed.
    const rows = await queryRows<{ type: string; plain_text: string }>(
      deps.pool,
      `SELECT type, plain_text FROM blocks
        WHERE page_id = $1 AND plain_text <> ''
        ORDER BY idx
        LIMIT $2`,
      [pageId, PREVIEW_BLOCKS + 1],
    );

    ctx.send(200, {
      id: pageId,
      blocks: rows.slice(0, PREVIEW_BLOCKS).map((row) => ({
        type: row.type,
        text: row.plain_text,
      })),
      truncated: rows.length > PREVIEW_BLOCKS,
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
      icon?: unknown;
      titleColor?: unknown;
      /** 'column', 'full', or null to follow the reader's default. */
      width?: unknown;
      /** Whether this page is offered as a template (ADR-0045). */
      template?: unknown;
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
    // How wide the page is drawn (ADR-0028's measure, per page). Null clears it
    // back to the reader's default, the same distinction the icon makes.
    const wantsWidth = 'width' in body;
    // Whether this page is offered as a shape to start from. A fact about the
    // page, decided while looking at it (ADR-0045).
    const wantsTemplate = 'template' in body;
    // Locked against accidental editing (ADR-0049). A guard, not a permission —
    // anybody who may edit the page may lift it, which is why this needs no
    // check beyond the edit right the route already requires.
    const wantsLocked = 'locked' in body;
    /*
     * A picture, a colour or a gradient above the heading (ADR-0117).
     *
     * Through the route rather than only through the open document, because a
     * **folder** has no open document: the folder view renders a tree node and
     * renames through this same route. A page writes its own instead — it has
     * the document in hand, and the title beside it on the same heading does
     * the same. This route would reach an open page too, through the update
     * bus (ADR-0076); it would cost a rematerialise and a tree refetch.
     *
     * Two transports, one rule: both go through `readEntryCover`, so neither
     * can decide for itself what a cover may be — which is the half that keeps
     * a foreign URL out.
     */
    const wantsCover = 'cover' in body;
    const cover = wantsCover ? readEntryCover(body.cover) : undefined;
    // Refused rather than silently cleared. Null is how a cover is removed;
    // something malformed is a client bug, and answering it by deleting the
    // page's cover is the worst available reading of it.
    if (wantsCover && body.cover !== null && cover === null) {
      ctx.fail(422, 'invalid_cover');
      return;
    }
    const width =
      body.width === 'column' || body.width === 'full' ? body.width : null;
    if (wantsWidth && body.width !== null && width === null) {
      ctx.fail(422, 'invalid_width');
      return;
    }

    if (
      typeof body.title !== 'string' &&
      !wantsIcon &&
      !wantsTitleColor &&
      !wantsWidth &&
      !wantsTemplate &&
      !wantsLocked &&
      !wantsCover
    ) {
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
        if (wantsTemplate) {
          // Deleted rather than set to false: a page nobody has marked carries
          // nothing, the same distinction every other optional property makes.
          if (body.template === true) page.set(PAGE_KEYS.template, true);
          else page.delete(PAGE_KEYS.template);
        }
        if (wantsLocked) {
          // Deleted rather than set to false, like the template flag: a page
          // nobody has locked carries nothing.
          if (body.locked === true) page.set(PAGE_KEYS.locked, true);
          else page.delete(PAGE_KEYS.locked);
        }
        if (wantsWidth) {
          if (width) page.set(PAGE_KEYS.width, width);
          else page.delete(PAGE_KEYS.width);
        }
        if (wantsCover) {
          // Deleted rather than stored as a null, like every other optional
          // property here: an entry nobody has given a cover carries nothing,
          // and the default has to stay the default (ADR-0117).
          if (cover) page.set(PAGE_KEYS.cover, cover);
          else page.delete(PAGE_KEYS.cover);
        }

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
            // Cleared first, then assigned.
            //
            // It was assigned onto the existing object, so a request that
            // named no colour left the previous one in place — which made
            // "no colour" the one swatch that could not be chosen: the icon
            // kept whatever it had.
            delete next['kind'];
            delete next['value'];
            delete next['color'];
            if (icon) Object.assign(next, icon);
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
      ...(wantsCover ? { cover } : {}),
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
      path_only: boolean;
      restricted_at: string | null;
    }>(
      deps.pool,
      `SELECT t.tag_key, t.tag_label, t.page_id, p.ancestor_ids,
              ${restrictedAtSql('p')} AS restricted_at
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
        // Fetched per row: this query has no visibility condition, which is why
        // the filtering happens here at all. Saying "the listing already
        // excluded restricted pages" of a query that lists everything is how a
        // tag on a restricted page came to be counted for everybody.
        restrictedAt: row.restricted_at,
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
      restricted_at: string | null;
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
               )) AS parent_missing,
              ${restrictedAtSql('p')} AS restricted_at
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
          // Fetched per row. The query above lists what is archived, with no
          // visibility condition at all — this filter is the only one there is,
          // and it was being handed a null that let every restricted page pass.
          restrictedAt: row.restricted_at,
        }) !== null,
    );

    ctx.send(200, {
      entries: visible.map((row) => ({
        id: row.id,
        title: row.title,
        // A canvas is drawn differently in the tree and opened differently, so
        // the kind travels rather than being flattened to 'page'.
        kind:
          row.kind === 'folder' || row.kind === 'canvas'
            ? (row.kind as 'folder' | 'canvas')
            : 'page',
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
  /**
   * Move an entry, and everything under it, to another workspace (ADR-0038).
   *
   * `?dryRun=true` counts what it would cost and changes nothing, which is what
   * the confirmation shows. Counted from the subtree rather than estimated, and
   * the real move counts again inside its own transaction — a number read
   * separately can be wrong by the time somebody presses the button.
   *
   * The right is needed in *two* places: edit here, and owner or administrator
   * there. Anything less would be a way to push content into a workspace where
   * you have no standing, and its owners would find pages they did not put there.
   */
  router.post('/api/pages/:pageId/move-to-workspace', async (ctx) => {
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

    // Here: the same right the ordinary move needs.
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

    const body = await readBody<{ workspaceId?: string }>(ctx);
    if (!body) return;
    const target = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    if (target === '') {
      ctx.fail(422, 'workspace_required');
      return;
    }

    // There: owner or administrator, and by membership rather than by an
    // instance-wide right. Being able to administer every workspace is not the
    // same as having somewhere to put this.
    const actorId =
      claims!.principal.kind === 'anonymous' ? null : claims!.principal.userId;
    if (actorId === null) {
      // A share-link guest has no membership anywhere, so there is nowhere this
      // could go.
      ctx.fail(403, 'not_authorized');
      return;
    }
    const membership = await roleIn(deps.pool, target, actorId);
    if (!membership || (membership !== 'owner' && membership !== 'admin')) {
      // The same answer as a workspace that does not exist: the difference would
      // say whether one does.
      ctx.fail(404, 'not_found');
      return;
    }

    const dryRun = ctx.url.searchParams.get('dryRun') === 'true';
    const result = await moveToWorkspace(deps.pool, {
      pageId,
      targetWorkspaceId: target,
      dryRun,
    });
    if (!result.ok) {
      ctx.fail(result.failure.status, result.failure.code);
      return;
    }

    if (!dryRun) {
      // The projection is rebuilt against the workspace it is in now. Without
      // this the search row and the tree entry describe a page that has moved.
      await rematerialize(deps.pool, pageId, target, actorId);
    }

    ctx.send(200, {
      pageId,
      workspaceId: target,
      // Where it landed. A folder goes to the root; a page goes into the target's
      // first folder, because a page at a workspace's root is not a shape this
      // schema allows (ADR-0038).
      parentPageId: result.parentPageId,
      dryRun,
      cost: result.cost,
    });
  });

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

    /*
     * Where to put it back, when the caller knows (ADR-0071).
     *
     * This route used to have exactly one answer for a page whose folder is
     * gone: refuse. That was right — silently putting a page somewhere else is
     * how somebody loses track of it a second time — but it left no way to say
     * where it *should* go, so the only route out of the trash was blocked for
     * the entries most likely to be in it.
     *
     * A body is optional here: no body at all is the old call, and it still
     * means "put it back where it was".
     */
    let target: string | null = null;
    try {
      const body: { parentPageId?: unknown } = await ctx.json();
      if (typeof body.parentPageId === 'string' && body.parentPageId !== '') {
        target = body.parentPageId;
      }
    } catch {
      // No body, or one that is not JSON. Both mean "where it was".
    }

    if (target !== null) {
      if (target === pageId) {
        // Its own parent. Refused here rather than left to the projection,
        // which would produce a subtree that contains itself.
        ctx.fail(422, 'invalid_parent');
        return;
      }
      const folder = await queryOne<{
        id: string;
        kind: string;
        workspace_id: string;
        ancestor_ids: string[];
        restricted_at: string | null;
      }>(
        deps.pool,
        `SELECT p.id, p.kind, p.workspace_id, p.ancestor_ids,
                ${restrictedAtSql('p')} AS restricted_at
           FROM pages p
          WHERE p.id = $1 AND p.archived_at IS NULL`,
        [target],
      );
      // A folder, alive, in this workspace, that this person may write in. The
      // same answer for every failure: a target somebody may not see must not
      // be distinguishable from one that does not exist.
      const targetRole =
        folder && folder.workspace_id === page.workspaceId
          ? effectiveRole(claims!, {
              id: folder.id,
              workspaceId: folder.workspace_id,
              ancestorIds: folder.ancestor_ids,
              // The target arrives as an id in the request body, so nothing
              // filtered it: restoring into a restricted folder somebody cannot
              // open is exactly what this has to refuse.
              restrictedAt: folder.restricted_at,
            })
          : null;
      if (
        !folder ||
        folder.kind !== 'folder' ||
        targetRole === null ||
        targetRole === 'viewer' ||
        targetRole === 'commenter'
      ) {
        ctx.fail(404, 'not_found');
        return;
      }
      // Its own descendant would be a cycle: restoring into a folder that is
      // inside the thing being restored.
      if (folder.ancestor_ids.includes(pageId)) {
        ctx.fail(422, 'invalid_parent');
        return;
      }
    }

    const parentAlive =
      target !== null ||
      row.parent_page_id === null ||
      (await queryOne(
        deps.pool,
        `SELECT 1 FROM pages WHERE id = $1 AND archived_at IS NULL`,
        [row.parent_page_id],
      )) !== null;

    if (!parentAlive || target !== null) {
      if (!parentAlive && row.kind !== 'folder') {
        // Reported rather than guessed at, exactly as before: without a target
        // this is still a refusal, and the interface asks where instead.
        ctx.fail(409, 'parent_missing');
        return;
      }
      const actorId =
        claims!.principal.kind === 'anonymous' ? null : claims!.principal.userId;
      const result = await applyToDocument(
        deps.pool,
        pageId,
        (doc) => {
          doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.parentPageId, target);
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

    // "To the root" only when nowhere was asked for: a caller that named a
    // folder knows where its entry went.
    ctx.send(200, { id: pageId, restoredToRoot: !parentAlive && target === null });
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

    // The documents have to go explicitly — see `deleteDocumentsFor`, which is
    // where the reason lives now, because this was true in two other places as
    // well (ADR-0080). One of them was this route: it deleted by page id, and a
    // page's *internal comments* document has an id derived from the page's
    // rather than equal to it, so those survived every "delete this page".
    const removed = await withTransaction(deps.pool, async (client) => {
      const ids = await queryRows<{ id: string }>(
        client,
        `SELECT id FROM pages WHERE id = $1 OR $1 = ANY(ancestor_ids)`,
        [pageId],
      );
      const pageIds = ids.map((row) => row.id);

      await deleteDocumentsFor(client, pageIds);
      const result = await client.query(
        `DELETE FROM pages WHERE id = ANY($1::uuid[])`,
        [pageIds],
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
  /**
   * What was parsed out of a query, for the chips above the results.
   *
   * Sent rather than left to the client to re-derive: the client parses the same
   * string to show them while somebody types, and this is the server saying what
   * it actually used — which is the only version that can be trusted after the
   * fact (ADR-0050).
   */
  const describeFilters = (filters: SearchFilters, folderMatches?: number) => ({
    tags: filters.tags,
    /*
     * The folder names, and how many folders they matched (ADR-0050).
     *
     * The count is the whole reason a name is allowed instead of an id: two
     * folders called "Projekte" match both, and somebody should see that on
     * screen rather than wonder why a search reaches further than they meant.
     * Zero is worth showing too — it says the name is wrong, not that the
     * folder is empty.
     */
    in: filters.in,
    ...(folderMatches === undefined ? {} : { inMatched: folderMatches }),
    authors: filters.authors,
    assigned: filters.assigned,
    after: filters.after,
    before: filters.before,
    unreadable: filters.unreadable,
  });

  /**
   * Searches somebody has kept, and keeping one (ADR-0050).
   *
   * Per person: `assigned:me` means something different to everybody, so a
   * shared saved search would be a shared string that resolves differently per
   * reader.
   */
  router.get('/api/workspaces/:workspaceId/searches', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;
    if (claims.principal.kind !== 'user') {
      // A share-link visitor has nowhere to keep one. An empty list rather than
      // a refusal: the screen asks this of everybody who opens search.
      ctx.send(200, { searches: [] });
      return;
    }

    const rows = await queryRows<{ id: string; name: string; query: string }>(
      deps.pool,
      `SELECT id, name, query FROM saved_searches
        WHERE user_id = $1 AND workspace_id = $2
        ORDER BY name ASC`,
      [claims.principal.userId, workspaceId],
    );
    ctx.send(200, { searches: rows });
  });

  router.post('/api/workspaces/:workspaceId/searches', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;
    if (claims.principal.kind !== 'user') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    let body: { name?: unknown; query?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';
    if (name === '' || query === '') {
      ctx.fail(422, 'search_needs_a_name');
      return;
    }

    const row = await queryOne<{ id: string }>(
      deps.pool,
      `INSERT INTO saved_searches (user_id, workspace_id, name, query)
       VALUES ($1, $2, $3, $4)
       -- Saving over a name replaces it, which is what somebody refining a
       -- search means by saving it again.
       ON CONFLICT (user_id, workspace_id, name)
         DO UPDATE SET query = EXCLUDED.query
       RETURNING id`,
      [claims.principal.userId, workspaceId, name, query],
    );
    ctx.send(201, { id: row?.id ?? null });
  });

  router.delete('/api/searches/:searchId', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;
    // Scoped to the owner in the statement: an id from somebody else's list
    // matches nothing rather than being an error, which is the same answer as
    // an id that never existed.
    await deps.pool.query(`DELETE FROM saved_searches WHERE id = $1 AND user_id = $2`, [
      ctx.params['searchId'] ?? '',
      session.userId,
    ]);
    ctx.send(200, { deleted: true });
  });

  router.get('/api/workspaces/:workspaceId/search', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const claims = await claimsFor(deps.pool, ctx, workspaceId);
    if (!claims) return;

    const typed = (ctx.url.searchParams.get('q') ?? '').trim();
    /*
     * Filters out of the query, the rest of the words being the search
     * (ADR-0050). Parsed by core, because the interface parses the same string
     * to draw its chips and two parsers would eventually disagree about what
     * somebody typed.
     */
    const filters = parseSearchQuery(typed);
    const raw = filters.text;

    if (!hasSearchCriteria(filters)) {
      // One character matches most of the workspace and is never what anyone
      // meant — but a filter is not a guess, so `tag:rechnung` alone is a valid
      // search and gets past this.
      ctx.send(200, { results: [], query: typed, filters: describeFilters(filters) });
      return;
    }

    const limit = Math.min(50, Number(ctx.url.searchParams.get('limit') ?? '20') || 20);
    const i18n = await workspaceI18n(deps.pool, workspaceId);

    // How a match is marked inside a snippet (ADR-0033).
    //
    // Control characters, not `<mark>`. HTML delimiters would make this response
    // markup, and rendering it means innerHTML on a string built from document
    // content — a stored-XSS hole for the sake of two tags. The interface splits
    // on these and builds real elements, so nothing is ever interpreted.
    /*
     * The folders `in:` named, by name (ADR-0050).
     *
     * One statement, before the search: a name can match several folders, and
     * the search then wants every one of their ids. Folders only — `in:` means
     * "under this thing in the tree", and a page is not a place.
     */
    const folders =
      filters.in.length > 0
        ? await queryRows<{ id: string }>(
            deps.pool,
            `SELECT id FROM pages
              WHERE workspace_id = $1
                AND kind = 'folder'
                AND archived_at IS NULL
                AND lower(title) = ANY($2::text[])`,
            [workspaceId, filters.in],
          )
        : [];
    const folderIds = folders.map((one) => one.id);

    const headline =
      'StartSel=\u0002, StopSel=\u0003, MaxWords=26, MinWords=10, ShortWord=2, MaxFragments=1';

    // Two prefix queries, built from websearch_to_tsquery's own output.
    //
    // `websearch_to_tsquery` goes on parsing what a person types — quotes, "or",
    // a leading minus — and its output is reparsed with `:*` appended, which
    // makes the trailing lexeme a prefix and leaves every earlier one exact
    // (ADR-0033). Building on the parsed output rather than on the raw string is
    // the point: what is concatenated is already-validated lexemes, so nothing
    // malformed can reach to_tsquery and nothing can be injected.
    //
    // Only the last term. The earlier ones are words somebody has finished
    // typing, and making them prefixes too would answer "budget rep" with
    // everything about budgeting.
    //
    // `nullif` makes an unparseable query yield no rows rather than an error: the
    // concatenation is null-propagating and `tsv @@ NULL` matches nothing. The
    // route already refuses fewer than two characters, so this is the boundary of
    // a case that cannot arrive.
    const rows = await queryRows<{
      page_id: string;
      title: string;
      kind: string;
      icon: unknown;
      trail: unknown;
      ancestor_ids: string[];
      title_match: boolean;
      snippet: string | null;
      block_id: string | null;
      rank: number;
    }>(
      deps.pool,
      `WITH q AS (
         SELECT to_tsquery(
                  $3::regconfig,
                  nullif(websearch_to_tsquery($3::regconfig, $2)::text, '') || ':*'
                ) AS stemmed,
                to_tsquery(
                  'simple',
                  nullif(websearch_to_tsquery('simple', $2)::text, '') || ':*'
                ) AS simple
       )
       SELECT ps.page_id, p.title, p.kind, p.icon, p.ancestor_ids,
              greatest(ts_rank(ps.tsv, q.stemmed), ts_rank(ps.tsv, q.simple)) AS rank,
              -- Said rather than left to be inferred from a rank number, which
              -- means nothing to a reader.
              (setweight(to_tsvector($3::regconfig, p.title), 'A') @@ q.stemmed
               OR setweight(to_tsvector('simple', p.title), 'A') @@ q.simple) AS title_match,
              -- Where it lives. The ids alone were unrenderable, which is why the
              -- interface never used them.
              (SELECT jsonb_agg(jsonb_build_object('pageId', a.id, 'title', a.title)
                                ORDER BY array_position(p.ancestor_ids, a.id))
                 FROM pages a WHERE a.id = ANY(p.ancestor_ids)) AS trail,
              hit.snippet,
              hit.block_id
         FROM q, page_search ps
         JOIN pages p ON p.id = ps.page_id
         -- The best matching block, for a passage and a place to land.
         --
         -- Per block rather than over the page's text as one string: the snippet
         -- is then a real passage instead of a window into a concatenation, and
         -- the block's id comes with it. Nothing new is stored: plain_text is
         -- written by the materialiser for exactly this.
         LEFT JOIN LATERAL (
           SELECT b.id AS block_id,
                  ts_headline($3::regconfig, b.plain_text, q.stemmed, $6) AS snippet
             FROM blocks b
            WHERE b.page_id = p.id
              AND b.plain_text <> ''
              AND (to_tsvector($3::regconfig, b.plain_text) @@ q.stemmed
                   OR to_tsvector('simple', b.plain_text) @@ q.simple)
            ORDER BY ts_rank(to_tsvector($3::regconfig, b.plain_text), q.stemmed) DESC, b.idx
            LIMIT 1
         ) hit ON true
        WHERE ps.workspace_id = $1
          AND p.archived_at IS NULL
          -- With no words left, the filters are the search: the text condition
          -- is skipped rather than matched against an empty query, which would
          -- match nothing at all.
          AND ($7::boolean OR ps.tsv @@ q.stemmed OR ps.tsv @@ q.simple)
          -- Every tag named, not any of them: two tags in one query means
          -- "both", which is what somebody narrowing a list expects.
          AND ($8::text[] IS NULL OR EXISTS (
                SELECT 1 FROM page_tags pt
                 WHERE pt.page_id = p.id AND pt.tag_key = ANY($8::text[])
                HAVING count(*) = cardinality($8::text[])
              ))
          -- Pages holding a task assigned to one of these people (ADR-0052).
          --
          -- An id match rather than a prefix, unlike the author filter: the
          -- names here come from a picker in the interface and "me" is resolved
          -- before the query runs, so there is nothing to guess at.
          AND ($12::uuid[] IS NULL OR EXISTS (
                SELECT 1 FROM blocks b
                 WHERE b.page_id = p.id
                   AND b.type = 'todo'
                   AND (b.props ->> 'assignee')::uuid = ANY($12::uuid[])
              ))
          -- A prefix against any of the page's authors: nobody types a whole
          -- name to narrow a list.
          AND ($9::text[] IS NULL OR EXISTS (
                SELECT 1 FROM unnest(ps.authors) AS name, unnest($9::text[]) AS wanted
                 WHERE lower(name) LIKE wanted || '%'
              ))
          -- The page's last edit, by day.
          --
          -- In the *server's* zone, which is what a cast to date on a
          -- timestamptz uses. I wrote in ADR-0050 that this would be the
          -- workspace's own
          -- zone, and then found there is no such setting anywhere in SONE — so
          -- the record is corrected rather than the claim left standing. A
          -- container running in UTC and a reader in Berlin disagree about
          -- "today" for two hours, which is a real limit and is written down.
          --
          -- Inclusive at both ends, because "before 2026-09-01" meaning "up to
          -- the 31st" is a boundary nobody would guess.
          AND ($10::date IS NULL OR p.last_edited_at::date >= $10::date)
          AND ($11::date IS NULL OR p.last_edited_at::date <= $11::date)
          -- Under one of the folders the in: filter named (ADR-0050).
          --
          -- ancestor_ids rather than the parent: naming a folder means anywhere
          -- beneath it, which is what somebody narrowing a search by place
          -- means — a page two levels down is still in that folder.
          --
          -- The overlap operator, so several names are "any of these", unlike
          -- the tag filter which means "all of them". Two tags describe one
          -- page; two folders describe two places, and a page cannot be in
          -- both.
          --
          -- Written as SQL comments and without backticks: a backtick inside a
          -- template literal ends the literal, and this project has now made
          -- that mistake five times.
          AND ($13::uuid[] IS NULL OR p.ancestor_ids && $13::uuid[])
          -- The same condition the tree uses (ADR-0026).
          --
          -- Filtering after the query would still have been correct here, and
          -- it is done in the database anyway: a restricted page must not
          -- occupy one of the LIMIT rows, or a search returns fewer results the
          -- more is hidden — which is itself a signal about what exists.
          --
          -- No path-only case: a page nobody may read has nothing to match, and
          -- surfacing it as a nameless result would say something exists
          -- without saying what.
          AND ${visiblePagesCondition('p', '$5')}
        ORDER BY rank DESC, p.last_edited_at DESC
        LIMIT $4`,
      [
        workspaceId,
        raw,
        i18n.searchConfig,
        limit,
        claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
        headline,
        raw.length < 2,
        filters.tags.length > 0 ? filters.tags : null,
        filters.authors.length > 0 ? filters.authors : null,
        filters.after,
        filters.before,
        /*
         * "me" is this session, resolved here.
         *
         * The parser cannot know who is asking without being handed a session,
         * which would make a pure function depend on a request. Anything else
         * is taken as an id, and a name that is not one matches nothing —
         * which is the honest answer to a filter nobody can resolve.
         */
        filters.assigned.length > 0
          ? filters.assigned
              .map((who) =>
                who === 'me' && claims.principal.kind === 'user'
                  ? claims.principal.userId
                  : who,
              )
              .filter(isUuid)
          : null,
        /*
         * Folders named by `in:`, resolved to ids here (ADR-0050).
         *
         * By name, at search time, because that is what makes the syntax
         * shareable: somebody types `in:Projekte` and pastes it to a colleague.
         * Two folders with one name match both, and the response says how many
         * matched so the ambiguity is on screen rather than silent.
         */
        /*
         * Null only when no folder was *asked for* (ADR-0050).
         *
         * I hung this on whether the names resolved, so a name nothing is
         * called passed null — the filter was ignored and the search matched
         * everything. A filter that silently widens a search is the exact
         * failure this record warns about: somebody typed a narrowing and got
         * more than they had before.
         *
         * An empty array now, which matches nothing, and the reported count of
         * zero says why.
         */
        filters.in.length > 0 ? folderIds : null,
      ],
    );
    const visible = rows.filter(
      (row) =>
        effectiveRole(claims, {
          id: row.page_id,
          workspaceId,
          ancestorIds: row.ancestor_ids,
          // The listing condition above already excluded restricted pages, so
          // this second check only has to agree with it.
          restrictedAt: null,
        }) !== null,
    );

    // Names that are close, when the search itself did badly (ADR-0036).
    //
    // A separate list, never mixed into the ranked results: two ranking systems
    // in one ordered list cannot be reasoned about — a row is either above
    // another because it matched better or because a different measure said so,
    // and nobody can tell which by looking.
    //
    // Only when there are fewer than five results, and only names. Somebody
    // whose search worked does not need five guesses underneath it, and a
    // section that is always there is a section people learn to skip — which is
    // when they will not read it on the day it holds the answer.
    const similar =
      visible.length >= SIMILAR_THRESHOLD
        ? []
        : await queryRows<{
            page_id: string;
            title: string;
            kind: string;
            icon: unknown;
            trail: unknown;
            ancestor_ids: string[];
          }>(
            deps.pool,
            `SELECT p.id AS page_id, p.title, p.kind, p.icon, p.ancestor_ids,
                    (SELECT jsonb_agg(jsonb_build_object('pageId', a.id, 'title', a.title)
                                      ORDER BY array_position(p.ancestor_ids, a.id))
                       FROM pages a WHERE a.id = ANY(p.ancestor_ids)) AS trail
               FROM pages p
              WHERE p.workspace_id = $1
                AND p.archived_at IS NULL
                AND p.kind <> 'row'
                AND p.title <> ''
                AND NOT (p.id = ANY($2::uuid[]))
                -- word_similarity rather than similarity: a title is often
                -- longer than the query, and similarity() punishes it for the
                -- part that is not being searched for.
                AND word_similarity($3, p.title) >= ${SIMILARITY_FLOOR}
                AND ${visiblePagesCondition('p', '$4')}
              ORDER BY word_similarity($3, p.title) DESC, p.last_edited_at DESC
              LIMIT ${SIMILAR_LIMIT}`,
            [
              workspaceId,
              visible.map((row) => row.page_id),
              raw,
              claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
            ],
          );

    /*
     * A correction for a word in the body (ADR-0051).
     *
     * Only when the search found little, like the name suggestions above it: a
     * search that found what somebody wanted must not be interrupted with a
     * guess about what else they might have meant.
     *
     * The word list, not the content — so this returns the *correction*, and
     * the interface can offer it as a search rather than as a result. Which
     * means no visibility condition is needed here and none would help: the list
     * has no page ids, and the search somebody then runs applies the rules.
     */
    const corrections =
      visible.length >= SIMILAR_THRESHOLD || raw.length < 4
        ? []
        : await queryRows<{ word: string }>(
            deps.pool,
            `SELECT word FROM workspace_words
              WHERE workspace_id = $1
                AND word % $2
                -- Not the word somebody typed: if it is in the list, it is
                -- spelt correctly and suggesting it back is nonsense.
                AND word <> lower($2)
              ORDER BY similarity(word, $2) DESC
              LIMIT 3`,
            [workspaceId, raw],
          );

    ctx.send(200, {
      // What was typed, and what was made of it.
      query: typed,
      // With the count, which only the searching route knows: the early exit
      // above has not resolved any folders.
      filters: describeFilters(filters, folderIds.length),
      /** Spellings that exist in this workspace, when the search found little. */
      corrections: corrections.map((row) => row.word),
      results: visible.map((row) => ({
        pageId: row.page_id,
        title: row.title,
        /** A folder is drawn as a folder (ADR-0019). */
        kind: row.kind,
        icon: row.icon,
        /** Outermost first, with titles, so the path can be shown. */
        trail: Array.isArray(row.trail) ? row.trail : [],
        titleMatch: row.title_match,
        /**
         * The matching passage, with the match between U+0002 and U+0003.
         *
         * Null when what matched was the title or a tag and no block did, which
         * is an answer rather than a gap: there is no passage to show.
         */
        snippet: row.snippet,
        /** The block the passage came from, so a result can land on it. */
        blockId: row.block_id,
        rank: row.rank,
      })),
      /**
       * Names close enough to be worth offering, when the search found little.
       *
       * No snippet and no rank: there is nothing honest to say beyond the name
       * being close, and a number would invite comparison with the results
       * above, which were measured differently (ADR-0036).
       */
      similar: similar.map((row) => ({
        pageId: row.page_id,
        title: row.title,
        kind: row.kind,
        icon: row.icon,
        trail: Array.isArray(row.trail) ? row.trail : [],
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
