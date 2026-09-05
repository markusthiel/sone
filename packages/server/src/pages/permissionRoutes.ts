/**
 * SONE server — setting who may reach a page.
 *
 * Reading and changing the rules ADR-0026 describes. Every route here requires
 * `admin` on the page itself, which somebody has by workspace role or by being
 * granted it — so a section can be handed to somebody who then manages access
 * to it without being an administrator of the workspace.
 */

import type { Pool } from 'pg';

import { randomUUID } from 'node:crypto';

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

    const groupGrants = await queryRows<{
      group_id: string;
      name: string;
      role: PageAccess;
      inherited_from: string | null;
    }>(
      deps.pool,
      `SELECT gp.group_id, g.name, gp.role,
              CASE WHEN gp.page_id = $1 THEN NULL ELSE anc.title END AS inherited_from
         FROM pages target
         JOIN page_group_permissions gp
           ON gp.page_id = target.id
           OR (gp.include_subtree AND gp.page_id = ANY(target.ancestor_ids))
         JOIN groups g ON g.id = gp.group_id
         LEFT JOIN pages anc ON anc.id = gp.page_id
        WHERE target.id = $1
        ORDER BY inherited_from NULLS FIRST, g.name`,
      [pageId],
    );

    /*
     * The cap set *here*, and the lowest one inherited from above.
     *
     * Both, because they answer different questions and the screen asks both:
     * the control shows what this page's own rule is, and the note beside it
     * explains a ceiling somebody set on a section further up — which is
     * otherwise invisible on the page it actually limits.
     */
    const caps = await queryRows<{
      page_id: string;
      max_level: PageAccess;
      include_subtree: boolean;
      title: string;
    }>(
      deps.pool,
      `SELECT c.page_id, c.max_level, c.include_subtree, anc.title
         FROM pages target
         JOIN page_caps c
           ON c.page_id = target.id
           OR (c.include_subtree AND c.page_id = ANY(target.ancestor_ids))
         JOIN pages anc ON anc.id = c.page_id
        WHERE target.id = $1
        ORDER BY
          CASE c.max_level
            WHEN 'admin' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1
          END ASC`,
      [pageId],
    );
    const own = caps.find((one) => one.page_id === pageId) ?? null;
    const inherited = caps.find((one) => one.page_id !== pageId) ?? null;

    ctx.send(200, {
      restricted: page?.restricted ?? false,
      cap: own ? { maxLevel: own.max_level, includeSubtree: own.include_subtree } : null,
      /** The strictest ceiling from above, so the page can say where it comes from. */
      inheritedCap: inherited
        ? { maxLevel: inherited.max_level, from: inherited.title }
        : null,
      groups: groupGrants.map((row) => ({
        groupId: row.group_id,
        name: row.name,
        access: row.role,
        inheritedFrom: row.inherited_from,
      })),
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

  /**
   * The ceiling on this page, or none (ADR-0087).
   *
   * The third layer of the precedence rule, and the only one that lowers: a
   * role gives, grants widen, a cap lowers. It is attached to the **page**
   * rather than to a person or a group, which is what lets it lower without
   * reopening ADR-0026's rule that joining a group must never cost anybody
   * anything — a cap cannot travel with a membership.
   *
   * Needs `admin` on the page, like every other rule set here. That is also
   * the exemption: a cap does not apply to somebody whose workspace role makes
   * them a page admin, or the first cap set on a workspace root could never be
   * lifted again by anybody.
   */
  router.put('/api/pages/:pageId/cap', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const pageId = ctx.params['pageId'] ?? '';
    const resolved = await resolvePageAccess(deps.pool, { pageId, userId: session.userId });
    if (!atLeast(resolved.access, 'admin')) {
      ctx.fail(resolved.access === null ? 404 : 403,
        resolved.access === null ? 'not_found' : 'forbidden');
      return;
    }

    let body: { maxLevel?: unknown; includeSubtree?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    /*
     * Null lifts it. One route rather than a PUT and a DELETE, because "no
     * ceiling" is a value the control offers alongside the four — it is the
     * top of the same list, not a different operation.
     */
    if (body.maxLevel === null || body.maxLevel === undefined || body.maxLevel === '') {
      await deps.pool.query(`DELETE FROM page_caps WHERE page_id = $1`, [pageId]);
      ctx.send(200, { cap: null });
      return;
    }

    const level = LEVELS.find((one) => one === body.maxLevel);
    if (!level) {
      ctx.fail(422, 'invalid_level');
      return;
    }

    const includeSubtree = body.includeSubtree !== false;
    await deps.pool.query(
      `INSERT INTO page_caps (page_id, max_level, include_subtree, set_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (page_id) DO UPDATE SET
         max_level = EXCLUDED.max_level,
         include_subtree = EXCLUDED.include_subtree,
         set_by = EXCLUDED.set_by,
         set_at = now()`,
      [pageId, level, includeSubtree, session.userId],
    );
    ctx.send(200, { cap: { maxLevel: level, includeSubtree } });
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

  /**
   * Create a protected container inside a page.
   *
   * Its own document, embedded by reference, because a permission on part of a
   * document cannot be enforced: a client receives the whole document to merge
   * changes, so a block the interface declines to draw is still in the
   * browser's memory (ADR-0026).
   *
   * Restricted from the moment it exists. The alternative is a window between
   * creating one and setting its rules, during which it is an ordinary part of
   * the page — and whoever created it has every reason to believe otherwise.
   */
  router.post('/api/pages/:pageId/containers', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const pageId = ctx.params['pageId'] ?? '';
    const resolved = await resolvePageAccess(deps.pool, { pageId, userId: session.userId });
    // Editing the page is enough to add a protected section to it; managing it
    // is not required. Somebody writing a page should be able to keep part of
    // it to themselves without being its administrator.
    if (!atLeast(resolved.access, 'editor')) {
      ctx.fail(resolved.access === null ? 404 : 403,
        resolved.access === null ? 'not_found' : 'forbidden');
      return;
    }

    const parent = await queryOne<{ workspace_id: string; ancestor_ids: string[] }>(
      deps.pool,
      `SELECT workspace_id, ancestor_ids FROM pages WHERE id = $1`,
      [pageId],
    );
    if (!parent) {
      ctx.fail(404, 'not_found');
      return;
    }

    const containerId = randomUUID();
    await deps.pool.query(
      `INSERT INTO pages
         (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids,
          restricted, created_by)
       VALUES ($1,$2,$3,$4,'0','container',$5,true,$6)`,
      [
        containerId,
        parent.workspace_id,
        pageId,
        'Protected section',
        [...parent.ancestor_ids, pageId],
        session.userId,
      ],
    );

    // Whoever made it can read it. Without this a container is created that
    // nobody can open, including the person who just created it — technically
    // correct and useless.
    await deps.pool.query(
      `INSERT INTO page_permissions (page_id, user_id, role, granted_by)
       VALUES ($1,$2,'admin',$2)`,
      [containerId, session.userId],
    );

    ctx.send(201, { containerId });
  });

  /** The same, for a group. */
  router.put('/api/pages/:pageId/groups/:groupId', async (ctx) => {
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

    // The group has to belong to the page's workspace. A group from elsewhere
    // would carry people who are not members here, which is the side door page
    // grants already refuse.
    const group = await queryOne<{ id: string }>(
      deps.pool,
      `SELECT g.id FROM groups g
         JOIN pages p ON p.workspace_id = g.workspace_id
        WHERE p.id = $1 AND g.id = $2`,
      [pageId, ctx.params['groupId'] ?? ''],
    );
    if (!group) {
      ctx.fail(422, 'not_a_group');
      return;
    }

    await deps.pool.query(
      `INSERT INTO page_group_permissions
         (page_id, group_id, role, include_subtree, granted_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (page_id, group_id) DO UPDATE SET
         role = EXCLUDED.role,
         include_subtree = EXCLUDED.include_subtree,
         granted_by = EXCLUDED.granted_by,
         granted_at = now()`,
      [pageId, group.id, access, body.includeSubtree !== false, session.userId],
    );

    ctx.send(200, { ok: true });
  });

  router.delete('/api/pages/:pageId/groups/:groupId', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const pageId = ctx.params['pageId'] ?? '';
    const resolved = await resolvePageAccess(deps.pool, { pageId, userId: session.userId });
    if (!atLeast(resolved.access, 'admin')) {
      ctx.fail(resolved.access === null ? 404 : 403,
        resolved.access === null ? 'not_found' : 'forbidden');
      return;
    }

    await deps.pool.query(
      `DELETE FROM page_group_permissions WHERE page_id = $1 AND group_id = $2`,
      [pageId, ctx.params['groupId'] ?? ''],
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
