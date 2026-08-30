/**
 * SONE server — setting who may reach a page.
 *
 * Reading and changing the rules ADR-0026 describes. Every route here requires
 * `admin` on the page itself, which somebody has by workspace role or by being
 * granted it — so a section can be handed to somebody who then manages access
 * to it without being an administrator of the workspace.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows } from '../db/pool.js';
import { requireSession } from '../http/auth.js';
import type { Router } from '../http/router.js';
import { atLeast, resolvePageAccess, type PageAccess } from './access.js';

export interface PermissionDeps {
  pool: Pool;
}

const LEVELS: readonly PageAccess[] = ['viewer', 'commenter', 'editor', 'admin'];

export function registerPagePermissionRoutes(router: Router, deps: PermissionDeps): void {
  /** Everything needed to draw the sharing panel. */
  router.get('/api/pages/:pageId/permissions', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const pageId = ctx.params['pageId'] ?? '';
    const resolved = await resolvePageAccess(deps.pool, {
      pageId,
      userId: session.userId,
    });
    if (!atLeast(resolved.access, 'admin')) {
      // Not found rather than forbidden for a page somebody cannot see at all.
      // "You may not manage this" confirms the page exists.
      ctx.fail(resolved.access === null ? 404 : 403, 
        resolved.access === null ? 'not_found' : 'forbidden');
      return;
    }

    const page = await queryOne<{ restricted: boolean; parent_page_id: string | null }>(
      deps.pool,
      `SELECT restricted, parent_page_id FROM pages WHERE id = $1`,
      [pageId],
    );

    const grants = await queryRows<{
      user_id: string;
      display_name: string;
      email: string;
      role: PageAccess;
      include_subtree: boolean;
      inherited_from: string | null;
    }>(
      deps.pool,
      // Grants on this page and on its ancestors, so the panel can show what is
      // inherited rather than only what was set here. A panel that shows an
      // empty list for a page somebody clearly reaches is a panel that makes
      // people set the rule again, one level down.
      `SELECT pp.user_id, u.display_name, u.email, pp.role, pp.include_subtree,
              CASE WHEN pp.page_id = $1 THEN NULL ELSE anc.title END AS inherited_from
         FROM pages target
         JOIN page_permissions pp
           ON pp.page_id = target.id
           OR (pp.include_subtree AND pp.page_id = ANY(target.ancestor_ids))
         JOIN users u ON u.id = pp.user_id
         LEFT JOIN pages anc ON anc.id = pp.page_id
        WHERE target.id = $1
        ORDER BY inherited_from NULLS FIRST, u.display_name`,
      [pageId],
    );

    ctx.send(200, {
      restricted: page?.restricted ?? false,
      grants: grants.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        access: row.role,
        includeSubtree: row.include_subtree,
        /** The ancestor it was set on, or null when it was set here. */
        inheritedFrom: row.inherited_from,
      })),
    });
  });

  /** Withhold the workspace default, or give it back. */
  router.put('/api/pages/:pageId/restricted', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const pageId = ctx.params['pageId'] ?? '';
    const resolved = await resolvePageAccess(deps.pool, { pageId, userId: session.userId });
    if (!atLeast(resolved.access, 'admin')) {
      ctx.fail(resolved.access === null ? 404 : 403,
        resolved.access === null ? 'not_found' : 'forbidden');
      return;
    }

    let body: { restricted?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    await deps.pool.query(`UPDATE pages SET restricted = $2 WHERE id = $1`, [
      pageId,
      body.restricted === true,
    ]);
    ctx.send(200, { restricted: body.restricted === true });
  });

  /** Grant somebody access, or change what they have. */
  router.put('/api/pages/:pageId/permissions/:userId', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const pageId = ctx.params['pageId'] ?? '';
    const resolved = await resolvePageAccess(deps.pool, { pageId, userId: session.userId });
    if (!atLeast(resolved.access, 'admin')) {
      ctx.fail(resolved.access === null ? 404 : 403,
        resolved.access === null ? 'not_found' : 'forbidden');
      return;
    }

    let body: { access?: unknown; includeSubtree?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const access = LEVELS.includes(body.access as PageAccess)
      ? (body.access as PageAccess)
      : null;
    if (!access) {
      ctx.fail(422, 'invalid_access');
      return;
    }

    // The person must be in the workspace. Granting access to somebody outside
    // it would create a member by the side door — they would reach the page and
    // appear in no list of who is in the workspace.
    const target = ctx.params['userId'] ?? '';
    const member = await queryOne<{ user_id: string }>(
      deps.pool,
      `SELECT wm.user_id FROM workspace_members wm
         JOIN pages p ON p.workspace_id = wm.workspace_id
        WHERE p.id = $1 AND wm.user_id = $2`,
      [pageId, target],
    );
    if (!member) {
      ctx.fail(422, 'not_a_member');
      return;
    }

    await deps.pool.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (page_id, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         include_subtree = EXCLUDED.include_subtree,
         granted_by = EXCLUDED.granted_by,
         granted_at = now()`,
      [pageId, target, access, body.includeSubtree !== false, session.userId],
    );

    ctx.send(200, { ok: true });
  });

  router.delete('/api/pages/:pageId/permissions/:userId', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const pageId = ctx.params['pageId'] ?? '';
    const resolved = await resolvePageAccess(deps.pool, { pageId, userId: session.userId });
    if (!atLeast(resolved.access, 'admin')) {
      ctx.fail(resolved.access === null ? 404 : 403,
        resolved.access === null ? 'not_found' : 'forbidden');
      return;
    }

    // Only a grant made *here* can be removed here. An inherited one belongs to
    // the page it was set on, and deleting it from a descendant would silently
    // change access to everything else under that ancestor.
    await deps.pool.query(
      `DELETE FROM page_permissions WHERE page_id = $1 AND user_id = $2`,
      [pageId, ctx.params['userId'] ?? ''],
    );
    ctx.send(200, { ok: true });
  });
}
