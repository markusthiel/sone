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

import { effectiveRole, loadPageLocation, resolveSessionClaims } from '../auth/claims.js';
import { appendUpdate } from '../doc/docStore.js';
import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import { collateClause, workspaceI18n } from '../i18n/locale.js';
import { materializeYDoc } from '../materialize/materialize.js';
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
    } else if (claims.workspaceRole === 'guest' || claims.workspaceRole === null) {
      // A guest has no implicit workspace access, so it cannot create a
      // top-level page.
      ctx.fail(403, 'not_authorized');
      return;
    }

    const siblings = await queryRows<{ idx: string }>(
      deps.pool,
      `SELECT idx FROM pages
        WHERE workspace_id = $1
          AND parent_page_id IS NOT DISTINCT FROM $2
        ORDER BY idx DESC, id DESC
        LIMIT 1`,
      [workspaceId, parentPageId],
    );
    const idx = generateKeyBetween(siblings[0]?.idx ?? null, null);

    const pageId = crypto.randomUUID();
    const title = (body.title ?? '').trim().slice(0, 512);

    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.createdWith, 'sone-server');
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, title);
    // Written into the document rather than only into the projection, so a
    // folder is rebuildable from the CRDT log like everything else (ADR-0019).
    page.set(PAGE_KEYS.kind, kind);
    page.set(PAGE_KEYS.idx, idx);
    page.set(PAGE_KEYS.parentPageId, parentPageId);
    page.set(PAGE_KEYS.collectionId, null);

    const actorId =
      claims.principal.kind === 'anonymous' ? null : claims.principal.userId;

    try {
      const seq = await appendUpdate(
        deps.pool,
        pageId,
        Y.encodeStateAsUpdate(doc),
        actorId,
      );
      await withTransaction(deps.pool, (client) =>
        materializeYDoc(client, pageId, doc, {
          throughSeq: seq,
          workspaceId,
          actorId,
        }),
      );
      await deps.pool.query(`UPDATE pages SET created_by = $2 WHERE id = $1`, [
        pageId,
        actorId,
      ]);
    } finally {
      doc.destroy();
    }

    ctx.send(201, { id: pageId, idx, parentPageId, title, kind });
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
