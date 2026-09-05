/**
 * SONE server — defining roles (ADR-0087, step three).
 *
 * Until now a role was one of four words in the code, so "define a role" was
 * not a thing anybody could do without editing SONE. This is the screen behind
 * that. Defining a role needs `roles.manage` — the right that can hand out the
 * other three, and therefore the one worth naming rather than folding into
 * "owner or admin". Deciding *who holds* one needs `people.manage`, which is
 * the same line the route that changes a person's role already draws.
 *
 * ## What a role is, restated because it decides the shape of these routes
 *
 * A role is a **page level** and a **set of rights**. The page level is a
 * ladder — a page is a CRDT document the server serves or does not, so "may
 * edit but not view" is meaningless — and it may be absent, which is what
 * `guest` is: nothing at all without an explicit grant. The rights are a set,
 * because "may manage groups" and "may rename the workspace" have no order
 * between them.
 *
 * ## The system roles are not editable, and that is the safety floor
 *
 * `owner`, `admin`, `member`, `guest` are rows with no workspace, present
 * everywhere. They cannot be renamed, changed or deleted here.
 *
 * Not tidiness: a workspace always has an owner, an owner always holds every
 * right, and both of those have to stay true through any amount of role
 * editing. Somebody can otherwise build a workspace nobody can administer —
 * and the person who does it is usually the person who then cannot undo it.
 */

import { RIGHTS, ROLE_ORDER, type Right, type Role } from '@sone/core';
import type { Pool } from 'pg';

import { queryOne, queryRows } from '../db/pool.js';
import type { Router } from '../http/router.js';
import { requireAnyRight, requireRight } from './rights.js';

export interface RoleDeps {
  pool: Pool;
}

const KNOWN_RIGHTS = new Set<string>(RIGHTS);

/** The four levels, plus the absence of one. Anything else is refused. */
function readLevel(value: unknown): { ok: true; level: Role | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, level: null };
  if (typeof value === 'string' && (ROLE_ORDER as readonly string[]).includes(value)) {
    return { ok: true, level: value as Role };
  }
  return { ok: false };
}

/**
 * The rights in a request, or nothing.
 *
 * Unknown names are **refused** rather than dropped. That is the opposite of
 * what the loader does when it reads a row — there, an unrecognised name is
 * ignored, because a row can outlive the code that understood it. Here the name
 * is arriving from a client right now, and silently saving a role without the
 * right somebody just ticked is the exact failure this whole record is about:
 * a control that appears to work and does not.
 */
function readRights(value: unknown): { ok: true; rights: Right[] } | { ok: false } {
  if (value === undefined) return { ok: true, rights: [] };
  if (!Array.isArray(value)) return { ok: false };
  const out: Right[] = [];
  for (const one of value) {
    if (typeof one !== 'string' || !KNOWN_RIGHTS.has(one)) return { ok: false };
    if (!out.includes(one as Right)) out.push(one as Right);
  }
  return { ok: true, rights: out };
}

interface RoleRow {
  id: string;
  key: string | null;
  name: string;
  page_level: Role | null;
  rights: string[];
  members: number;
  groups: number;
}

const asJson = (row: RoleRow): Record<string, unknown> => ({
  id: row.id,
  /** Present only for a system role, and it is what makes it one. */
  key: row.key,
  name: row.name,
  pageLevel: row.page_level,
  rights: row.rights,
  /** Who holds it, so the screen can say what deleting would affect. */
  members: row.members,
  groups: row.groups,
});

export function registerRoleRoutes(router: Router, deps: RoleDeps): void {
  /**
   * Every role this workspace can use: the four system ones and its own.
   *
   * Both in one list, because the screen shows them together and the choice
   * somebody makes is between all of them. The system ones are marked by
   * carrying a `key`, which is also what the client uses to know they cannot be
   * edited — rather than a separate `editable` flag, which would be a second
   * way of saying the same thing.
   */
  router.get('/api/workspaces/:workspaceId/roles', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    // Either right reaches this: you need the list to define a role, and you
    // need it to give somebody one. See `requireAnyRight` for why that is one
    // route rather than two.
    const actor = await requireAnyRight(deps.pool, ctx, workspaceId, [
      'roles.manage',
      'people.manage',
    ]);
    if (!actor) return;

    const roles = await queryRows<RoleRow>(
      deps.pool,
      // The counts come with the list. "How many people hold this" is the first
      // thing somebody wants before changing what a role means, and fetching it
      // per row would be a request per role for a number.
      `SELECT r.id, r.key, r.name, r.page_level, r.rights,
              (SELECT count(*)::int FROM workspace_members m
                WHERE m.role_id = r.id AND m.workspace_id = $1) AS members,
              (SELECT count(*)::int FROM groups g
                WHERE g.role_id = r.id AND g.workspace_id = $1) AS groups
         FROM roles r
        WHERE r.workspace_id IS NULL OR r.workspace_id = $1
        ORDER BY r.workspace_id NULLS FIRST, lower(r.name)`,
      [workspaceId],
    );

    ctx.send(200, { roles: roles.map(asJson), rights: RIGHTS });
  });

  router.post('/api/workspaces/:workspaceId/roles', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const actor = await requireRight(deps.pool, ctx, workspaceId, 'roles.manage');
    if (!actor) return;

    let body: { name?: unknown; pageLevel?: unknown; rights?: unknown };
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

    const level = readLevel(body.pageLevel);
    if (!level.ok) {
      ctx.fail(422, 'invalid_level');
      return;
    }
    const rights = readRights(body.rights);
    if (!rights.ok) {
      ctx.fail(422, 'invalid_right');
      return;
    }

    const created = await queryOne<{ id: string }>(
      deps.pool,
      `INSERT INTO roles (workspace_id, name, page_level, rights, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id, lower(name)) WHERE workspace_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [workspaceId, name, level.level, rights.rights, actor],
    );
    if (!created) {
      // Two roles called "Redaktion" are two things nobody can tell apart in a
      // list of who may do what — the same rule groups have.
      ctx.fail(409, 'name_taken');
      return;
    }

    ctx.send(201, {
      id: created.id,
      key: null,
      name,
      pageLevel: level.level,
      rights: rights.rights,
      members: 0,
      groups: 0,
    });
  });

  router.patch('/api/workspaces/:workspaceId/roles/:roleId', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const actor = await requireRight(deps.pool, ctx, workspaceId, 'roles.manage');
    if (!actor) return;

    const roleId = ctx.params['roleId'] ?? '';
    const existing = await queryOne<{ id: string; workspace_id: string | null }>(
      deps.pool,
      `SELECT id, workspace_id FROM roles WHERE id = $1`,
      [roleId],
    );
    if (!existing || existing.workspace_id !== workspaceId) {
      // A role of another workspace is answered as absent, not as forbidden:
      // the difference would say which workspaces have which roles.
      ctx.fail(existing?.workspace_id === null ? 409 : 404,
        existing?.workspace_id === null ? 'system_role' : 'not_found');
      return;
    }

    let body: { name?: unknown; pageLevel?: unknown; rights?: unknown };
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
    const level = readLevel(body.pageLevel);
    if (!level.ok) {
      ctx.fail(422, 'invalid_level');
      return;
    }
    const rights = readRights(body.rights);
    if (!rights.ok) {
      ctx.fail(422, 'invalid_right');
      return;
    }

    /*
     * Everything at once, not field by field.
     *
     * A role is edited as a whole in the screen — a name, a level, a set of
     * ticks — and a partial update would mean the client deciding which fields
     * to send, so two people editing the same role would merge in a way
     * neither asked for. Sending all of it makes the last save win, which is
     * at least a rule somebody can predict.
     */
    const updated = await queryOne<{ id: string }>(
      deps.pool,
      `UPDATE roles
          SET name = $3, page_level = $4, rights = $5
        WHERE id = $1 AND workspace_id = $2
        RETURNING id`,
      [roleId, workspaceId, name, level.level, rights.rights],
    );
    if (!updated) {
      ctx.fail(409, 'name_taken');
      return;
    }

    ctx.send(200, { ok: true });
  });

  router.delete('/api/workspaces/:workspaceId/roles/:roleId', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const actor = await requireRight(deps.pool, ctx, workspaceId, 'roles.manage');
    if (!actor) return;

    const roleId = ctx.params['roleId'] ?? '';
    const role = await queryOne<{ workspace_id: string | null; members: number; groups: number }>(
      deps.pool,
      `SELECT r.workspace_id,
              (SELECT count(*)::int FROM workspace_members m WHERE m.role_id = r.id) AS members,
              (SELECT count(*)::int FROM groups g WHERE g.role_id = r.id) AS groups
         FROM roles r WHERE r.id = $1`,
      [roleId],
    );
    if (!role) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (role.workspace_id === null) {
      ctx.fail(409, 'system_role');
      return;
    }
    if (role.workspace_id !== workspaceId) {
      ctx.fail(404, 'not_found');
      return;
    }

    /*
     * A role somebody holds is not deleted out from under them.
     *
     * The alternative is to move everybody to `member` and delete it, which
     * changes what several people may do without saying so — and "several"
     * could be everybody. Refusing and naming the number puts the decision
     * where it belongs: whoever is deleting has to move those people first, and
     * can see how many that is.
     */
    if (role.members > 0 || role.groups > 0) {
      ctx.send(409, { error: 'role_in_use', members: role.members, groups: role.groups });
      return;
    }

    await deps.pool.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
    ctx.send(200, { ok: true });
  });

  /**
   * What role a group carries, or none.
   *
   * A group holding a role is how "assign a role to a group" works: somebody's
   * standing is the union of the rights and the maximum of the page levels over
   * their own role and their groups' (ADR-0087). Never a subtraction, so
   * joining a group cannot take anything away (ADR-0026).
   *
   * Needs `people.manage`, not `roles.manage`, and the line between them is
   * worth stating once: **defining what a role means is `roles.manage`;
   * deciding who holds one is `people.manage`.** That holds whether the holder
   * is a person or a group, so this route and the one that changes a person's
   * role ask the same thing — and somebody who may set a person's role can
   * already hand out every right by making them an admin, so requiring more
   * here would be a rule that only looks stricter.
   */
  router.put('/api/workspaces/:workspaceId/groups/:groupId/role', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    const actor = await requireRight(deps.pool, ctx, workspaceId, 'people.manage');
    if (!actor) return;

    let body: { roleId?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const groupId = ctx.params['groupId'] ?? '';
    const group = await queryOne<{ id: string }>(
      deps.pool,
      `SELECT id FROM groups WHERE id = $1 AND workspace_id = $2`,
      [groupId, workspaceId],
    );
    if (!group) {
      ctx.fail(404, 'not_found');
      return;
    }

    const roleId = typeof body.roleId === 'string' && body.roleId !== '' ? body.roleId : null;
    if (roleId !== null) {
      const usable = await queryOne<{ id: string }>(
        deps.pool,
        // A system role or one of this workspace's own. Anything else would be
        // another workspace's rule reaching in here.
        `SELECT id FROM roles
          WHERE id = $1 AND (workspace_id IS NULL OR workspace_id = $2)`,
        [roleId, workspaceId],
      );
      if (!usable) {
        ctx.fail(422, 'invalid_role');
        return;
      }
    }

    await deps.pool.query(`UPDATE groups SET role_id = $2 WHERE id = $1`, [groupId, roleId]);
    ctx.send(200, { ok: true });
  });
}
