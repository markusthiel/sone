/**
 * SONE — favourites.
 *
 * A person's shortcuts to pages. Stored in Postgres only, and that is a
 * deliberate departure from how folders work (ADR-0019).
 *
 * A folder is a property of the workspace: everyone sees the same tree, so it
 * lives in the CRDT and must be rebuildable from the log. A favourite is a
 * property of one person's relationship to a page. In the document it would
 * mean every collaborator's shortcuts are stored in, and synced with, a page
 * they share — a privacy leak, since what someone finds important is not the
 * page's business, and an editing conflict for no gain.
 *
 * So favourites are instance data, like sessions. ADR-0002's guarantee is
 * untouched: the projection is still derivable from the CRDTs, and favourites
 * are simply not part of the projection.
 */

import { generateKeyBetween } from '@sone/core';
import type { Pool } from 'pg';

import { effectiveRole, loadPageLocation, resolveSessionClaims } from '../auth/claims.js';
import { queryRows } from '../db/pool.js';
import { requireSession, sessionTokenFrom } from './auth.js';
import type { Router } from './router.js';
import { visiblePagesCondition } from '../pages/access.js';

export interface FavouriteDeps {
  pool: Pool;
}

export function registerFavouriteRoutes(router: Router, deps: FavouriteDeps): void {
  /**
   * The caller's favourites, in one workspace.
   *
   * Joined against pages so a favourite for a page that has been archived or
   * removed does not appear as a broken row. Filtered rather than deleted: a
   * page can come back from the archive, and the shortcut should still be there
   * when it does.
   *
   * `?workspace=<id>` is what the sidebar asks with, and it matters.
   *
   * The list is one person's and spans every workspace they belong to, which is
   * right for the data and wrong for the sidebar: a sidebar is a view of *one*
   * workspace, so a shortcut from another appeared in it and could not be
   * opened — the page is in a workspace this session is not looking at, and the
   * refusal read as "you no longer have access", which is not what happened.
   *
   * Unscoped remains valid, because the list itself is instance-wide and
   * something may yet want all of it. The caller says which it means.
   */
  router.get('/api/favourites', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const scope = ctx.url.searchParams.get('workspace');

    const rows = await queryRows<{
      page_id: string;
      title: string;
      kind: string;
      icon: unknown;
      workspace_id: string;
      idx: string;
    }>(
      deps.pool,
      `SELECT f.page_id, p.title, p.kind, p.icon, p.workspace_id, f.idx
         FROM favourites f
         JOIN pages p ON p.id = f.page_id
        WHERE f.user_id = $1
          AND p.archived_at IS NULL
          -- The same condition the tree uses (ADR-0026).
          --
          -- A favourite outlives the access that created it: somebody who
          -- starred a page and was later removed from it would otherwise keep
          -- its title in their sidebar, which is the quietest kind of leak —
          -- nobody looks at a list they have had for months.
          --
          -- No admin shortcut here: this is one person's own list, so the
          -- workspace role is looked up per row rather than passed in.
          AND ${visiblePagesCondition('p', '$1', `EXISTS (
            SELECT 1 FROM workspace_members wm
             WHERE wm.workspace_id = p.workspace_id
               AND wm.user_id = $1
               AND wm.role IN ('owner','admin')
          )`)}
          AND ($2::uuid IS NULL OR p.workspace_id = $2)
        ORDER BY f.idx, f.page_id`,
      [auth.userId, scope],
    );

    // Membership is re-checked rather than assumed: someone removed from a
    // workspace keeps their favourite rows, and those pages must stop
    // appearing.
    const visible = await queryRows<{ workspace_id: string }>(
      deps.pool,
      `SELECT workspace_id FROM workspace_members WHERE user_id = $1`,
      [auth.userId],
    );
    const allowed = new Set(visible.map((row) => row.workspace_id));

    ctx.send(200, {
      favourites: rows
        .filter((row) => allowed.has(row.workspace_id))
        .map((row) => ({
          pageId: row.page_id,
          title: row.title,
          /*
           * The entry's own kind, and its own icon.
           *
           * This narrowed every kind to "folder or else page", so a canvas in
           * the favourites was a document — the same mistake `entryKind()` was
           * written to stop, made again in a route rather than a component. And
           * the icon was simply not selected, so the sidebar drew a default one:
           * a page called "Zugangsdaten" with a key on it in the tree appeared
           * in the favourites as a blank document.
           */
          kind: row.kind,
          icon: row.icon,
          workspaceId: row.workspace_id,
          idx: row.idx,
        })),
    });
  });

  /** Add a favourite. Idempotent: favouriting twice is not an error. */
  router.put('/api/pages/:pageId/favourite', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const page = await loadPageLocation(deps.pool, pageId);
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }

    const token = sessionTokenFrom(ctx);
    if (!token) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await resolveSessionClaims(deps.pool, token, page.workspaceId);
    const role = claims ? effectiveRole(claims, page) : null;
    if (role === null) {
      // The same answer as a missing page: the difference would confirm that a
      // page exists somewhere the caller cannot see.
      ctx.fail(404, 'not_found');
      return;
    }
    if (claims!.principal.kind === 'anonymous') {
      // A share-link visitor has no account to hang a favourite on.
      ctx.fail(403, 'not_authorized');
      return;
    }

    // Viewing is enough. A favourite is a bookmark, not an edit — requiring
    // write access would mean someone given read-only access to a page they
    // consult daily could not keep a shortcut to it.
    const userId = claims!.principal.userId;

    const last = await queryRows<{ idx: string }>(
      deps.pool,
      `SELECT idx FROM favourites WHERE user_id = $1 ORDER BY idx DESC, page_id DESC LIMIT 1`,
      [userId],
    );
    const idx = generateKeyBetween(last[0]?.idx ?? null, null);

    await deps.pool.query(
      `INSERT INTO favourites (user_id, page_id, idx) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, page_id) DO NOTHING`,
      [userId, pageId, idx],
    );

    ctx.send(200, { pageId, favourite: true });
  });

  /** Remove a favourite. Also idempotent. */
  router.delete('/api/pages/:pageId/favourite', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    // No page lookup and no permission check: removing a favourite is removing
    // one of the caller's own rows. Requiring access to the page would strand a
    // shortcut to something they can no longer open, which is exactly when
    // someone wants to remove it.
    await deps.pool.query(
      `DELETE FROM favourites WHERE user_id = $1 AND page_id = $2`,
      [auth.userId, ctx.params['pageId'] ?? ''],
    );

    ctx.send(200, { pageId: ctx.params['pageId'] ?? '', favourite: false });
  });

  /**
   * Reorder a favourite.
   *
   * Placed between two others by fractional index, so no other row is touched
   * and two people reordering their own lists never interact.
   */
  router.post('/api/favourites/reorder', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    let body: { pageId?: string; afterPageId?: string | null };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const pageId = body.pageId ?? '';
    if (!pageId) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    const rows = await queryRows<{ page_id: string; idx: string }>(
      deps.pool,
      `SELECT page_id, idx FROM favourites WHERE user_id = $1 ORDER BY idx, page_id`,
      [auth.userId],
    );

    const others = rows.filter((row) => row.page_id !== pageId);
    if (others.length === rows.length) {
      ctx.fail(404, 'not_found');
      return;
    }

    const afterIndex = body.afterPageId
      ? others.findIndex((row) => row.page_id === body.afterPageId)
      : -1;
    const before = afterIndex >= 0 ? others[afterIndex]!.idx : null;
    const after = others[afterIndex + 1]?.idx ?? null;

    const idx = generateKeyBetween(before, after);
    await deps.pool.query(
      `UPDATE favourites SET idx = $3 WHERE user_id = $1 AND page_id = $2`,
      [auth.userId, pageId, idx],
    );

    ctx.send(200, { pageId, idx });
  });
}

/** Which of these pages the caller has favourited. */
export async function favouritedPageIds(
  pool: Pool,
  userId: string,
): Promise<Set<string>> {
  const rows = await queryRows<{ page_id: string }>(
    pool,
    `SELECT page_id FROM favourites WHERE user_id = $1`,
    [userId],
  );
  return new Set(rows.map((row) => row.page_id));
}
