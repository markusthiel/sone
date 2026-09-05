/**
 * SONE server — groups.
 *
 * A group is a list of people in one workspace. Managing it is a workspace
 * matter — owners and admins — because a group is a name for a set of people
 * and naming sets of people is how a workspace is organised, not something a
 * page's manager should be doing from a sharing dialog.
 *
 * Granting a group access to a page lives with the other page grants
 * (permissionRoutes.ts); this is only who is in it.
 */

import type { Pool } from 'pg';

import { requireRight } from '../auth/rights.js';
import { queryOne, queryRows } from '../db/pool.js';
import { requireSession } from '../http/auth.js';
import type { RequestContext, Router } from '../http/router.js';

export interface GroupDeps {
  pool: Pool;
}

/**
 * Whoever may manage groups here, or nothing.
 *
 * `groups.manage` rather than "owner or admin" (ADR-0087). The old comparison
 * answered eight different questions with one word, so the only way to let
 * somebody make a group was to let them change everybody's role as well.
 *
 * Not found rather than forbidden for a workspace somebody is not in: "you may
 * not manage groups here" confirms the workspace exists. That distinction now
 * lives in `requireRight`, with the rest of the routes that make it.
 */
async function requireWorkspaceAdmin(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
): Promise<string | null> {
  return requireRight(pool, ctx, workspaceId, 'groups.manage');
}

export function registerGroupRoutes(router: Router, deps: GroupDeps): void {
  router.get('/api/workspaces/:workspaceId/groups', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const admin = await requireWorkspaceAdmin(deps.pool, ctx, workspaceId);
    if (!admin) return;

    const groups = await queryRows<{
      id: string;
      name: string;
      members: number;
      role_id: string | null;
      role_name: string | null;
    }>(
      deps.pool,
      // The count comes with the list. A group's size is the first thing
      // somebody wants when deciding whether to grant it access, and fetching
      // it per group would be a request per row for a number.
      //
      // The role too, for the same reason and a stronger one: a group carrying
      // a role gives it to everybody in it (ADR-0087), so a list of groups that
      // does not say which role each carries is a list that hides the thing
      // worth knowing about them.
      `SELECT g.id, g.name, count(gm.user_id)::int AS members,
              g.role_id, r.name AS role_name
         FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.id
         LEFT JOIN roles r ON r.id = g.role_id
        WHERE g.workspace_id = $1
        GROUP BY g.id, r.name
        ORDER BY lower(g.name)`,
      [workspaceId],
    );

    ctx.send(200, {
      groups: groups.map((one) => ({
        id: one.id,
        name: one.name,
        members: one.members,
        roleId: one.role_id,
        roleName: one.role_name,
      })),
    });
  });

  router.post('/api/workspaces/:workspaceId/groups', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const admin = await requireWorkspaceAdmin(deps.pool, ctx, workspaceId);
    if (!admin) return;

    let body: { name?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
    if (name === '') {
      ctx.fail(422, 'missing_fields');
      return;
    }

    const created = await queryOne<{ id: string }>(
      deps.pool,
      `INSERT INTO groups (workspace_id, name, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (workspace_id, lower(name)) DO NOTHING
       RETURNING id`,
      [workspaceId, name, admin],
    );

    if (!created) {
      // Two groups called "Editors" are two things nobody can tell apart in a
      // list of who has access.
      ctx.fail(409, 'name_taken');
      return;
    }

    ctx.send(201, { id: created.id, name, members: 0 });
  });

  router.get('/api/groups/:groupId/members', async (ctx) => {
    const groupId = ctx.params['groupId'] ?? '';
    const group = await queryOne<{ workspace_id: string }>(
      deps.pool,
      `SELECT workspace_id FROM groups WHERE id = $1`,
      [groupId],
    );
    if (!group) {
      ctx.fail(404, 'not_found');
      return;
    }
    const admin = await requireWorkspaceAdmin(deps.pool, ctx, group.workspace_id);
    if (!admin) return;

    const members = await queryRows<{ user_id: string; display_name: string }>(
      deps.pool,
      `SELECT gm.user_id, u.display_name
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1
        ORDER BY u.display_name`,
      [groupId],
    );

    ctx.send(200, {
      members: members.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
      })),
    });
  });

  router.put('/api/groups/:groupId/members/:userId', async (ctx) => {
    const groupId = ctx.params['groupId'] ?? '';
    const group = await queryOne<{ workspace_id: string }>(
      deps.pool,
      `SELECT workspace_id FROM groups WHERE id = $1`,
      [groupId],
    );
    if (!group) {
      ctx.fail(404, 'not_found');
      return;
    }
    const admin = await requireWorkspaceAdmin(deps.pool, ctx, group.workspace_id);
    if (!admin) return;

    // Only people already in the workspace. A group holding somebody who is not
    // a member would give them access through a page grant while they appear in
    // no list of who is here — a member by the side door, which is the same
    // thing page grants already refuse.
    const member = await queryOne<{ user_id: string }>(
      deps.pool,
      `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [group.workspace_id, ctx.params['userId'] ?? ''],
    );
    if (!member) {
      ctx.fail(422, 'not_a_member');
      return;
    }

    await deps.pool.query(
      `INSERT INTO group_members (group_id, user_id, added_by) VALUES ($1,$2,$3)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, member.user_id, admin],
    );
    ctx.send(200, { ok: true });
  });

  router.delete('/api/groups/:groupId/members/:userId', async (ctx) => {
    const groupId = ctx.params['groupId'] ?? '';
    const group = await queryOne<{ workspace_id: string }>(
      deps.pool,
      `SELECT workspace_id FROM groups WHERE id = $1`,
      [groupId],
    );
    if (!group) {
      ctx.fail(404, 'not_found');
      return;
    }
    const admin = await requireWorkspaceAdmin(deps.pool, ctx, group.workspace_id);
    if (!admin) return;

    await deps.pool.query(
      `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, ctx.params['userId'] ?? ''],
    );
    ctx.send(200, { ok: true });
  });

  router.delete('/api/groups/:groupId', async (ctx) => {
    const groupId = ctx.params['groupId'] ?? '';
    const group = await queryOne<{ workspace_id: string }>(
      deps.pool,
      `SELECT workspace_id FROM groups WHERE id = $1`,
      [groupId],
    );
    if (!group) {
      ctx.fail(404, 'not_found');
      return;
    }
    const admin = await requireWorkspaceAdmin(deps.pool, ctx, group.workspace_id);
    if (!admin) return;

    // How many pages lose access with it, so the answer is known before the
    // question is answered rather than discovered afterwards.
    const affected = await queryOne<{ pages: number }>(
      deps.pool,
      `SELECT count(*)::int AS pages FROM page_group_permissions WHERE group_id = $1`,
      [groupId],
    );

    if (ctx.url.searchParams.get('confirm') !== 'true' && (affected?.pages ?? 0) > 0) {
      ctx.fail(409, 'grants_exist');
      return;
    }

    await deps.pool.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    ctx.send(200, { ok: true, revokedFrom: affected?.pages ?? 0 });
  });
}
