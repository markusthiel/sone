/**
 * SONE — workspace routes.
 *
 * A workspace is the unit of membership and of search (ADR-0006, ADR-0011).
 * Everything in the data model already supported several of them — the session
 * endpoint has always returned a list — but there was no way to create a second
 * one, so an instance was effectively single-workspace.
 *
 * No seat limits, no workspace limits, no tier that unlocks a second one
 * (ADR-0007). If that ever needs saying out loud in code, this is the file.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import { createDefaultFolder } from '../pages/createEntry.js';
import { requireSession } from './auth.js';
import { BodyError, type RequestContext, type Router } from './router.js';

export interface WorkspaceDeps {
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

/** The caller's role in a workspace, or null if they are not a member. */
async function roleIn(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const row = await queryOne<{ role: string }>(
    pool,
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  return row?.role ?? null;
}

export function registerWorkspaceRoutes(router: Router, deps: WorkspaceDeps): void {
  /** Workspaces the caller belongs to, with counts for the switcher. */
  router.get('/api/workspaces', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const rows = await queryRows<{
      id: string;
      name: string;
      role: string;
      default_locale: string;
      page_count: string;
      member_count: string;
    }>(
      deps.pool,
      `SELECT w.id, w.name, m.role, w.default_locale,
              (SELECT count(*) FROM pages p
                WHERE p.workspace_id = w.id AND p.archived_at IS NULL)::text AS page_count,
              (SELECT count(*) FROM workspace_members mm
                WHERE mm.workspace_id = w.id)::text AS member_count
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = $1
        -- ICU collation for a user-visible sort: the database itself is C so
        -- that fractional indices compare byte-wise (ADR-0011).
        ORDER BY w.name COLLATE "und-x-icu"`,
      [auth.userId],
    );

    ctx.send(200, {
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        defaultLocale: row.default_locale,
        pageCount: Number(row.page_count),
        memberCount: Number(row.member_count),
      })),
    });
  });

  /**
   * Create a workspace.
   *
   * Any signed-in member may create one. That is a deliberate consequence of
   * ADR-0007: gating it would be a seat limit wearing a different hat. An
   * instance that wants to restrict this restricts who can sign up.
   *
   * The creator becomes owner, and the workspace starts with a folder — without
   * one it cannot hold a page at all (ADR-0019), so a new workspace would open
   * onto a "new page" button that refuses.
   */
  router.post('/api/workspaces', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    // A guest is a share-link participant, not a member; it has no workspace of
    // its own and must not be able to create one.
    if (auth.isGuest) {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const body = await readBody<{ name?: string }>(ctx);
    if (!body) return;

    const name = (body.name ?? '').trim().slice(0, 256);
    if (name.length === 0) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    // The workspace and its membership go in together: a workspace nobody
    // belongs to is invisible and unreachable, including to the person who
    // just made it.
    const workspaceId = await withTransaction(deps.pool, async (client) => {
      const workspace = await queryOne<{ id: string }>(
        client,
        `INSERT INTO workspaces (name, created_by) VALUES ($1,$2) RETURNING id`,
        [name, auth.userId],
      );
      if (!workspace) throw new Error('failed to create workspace');

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`,
        [workspace.id, auth.userId],
      );
      return workspace.id;
    });

    // Outside the transaction: creating the folder writes a CRDT document, and
    // a failure there must not undo the workspace. A workspace with no folder
    // is recoverable by hand; one that half-exists is not.
    let defaultFolderId: string | null = null;
    try {
      const folder = await createDefaultFolder(deps.pool, workspaceId, auth.userId);
      defaultFolderId = folder.id;
    } catch (err) {
      console.error('[workspaces] could not create the default folder', err);
    }

    ctx.send(201, { id: workspaceId, name, role: 'owner', defaultFolderId });
  });

  /** Rename a workspace. Owners and admins only. */
  router.patch('/api/workspaces/:workspaceId', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    const role = await roleIn(deps.pool, workspaceId, auth.userId);
    if (role === null) {
      // Same answer as a workspace that does not exist: the difference would
      // reveal which workspaces are on this instance.
      ctx.fail(404, 'not_found');
      return;
    }
    if (role !== 'owner' && role !== 'admin') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const body = await readBody<{ name?: string }>(ctx);
    if (!body) return;
    const name = (body.name ?? '').trim().slice(0, 256);
    if (name.length === 0) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    await deps.pool.query(`UPDATE workspaces SET name = $2 WHERE id = $1`, [
      workspaceId,
      name,
    ]);
    ctx.send(200, { id: workspaceId, name });
  });

  /**
   * Members of a workspace.
   *
   * Read-only for now, and the beginning of the user management an admin area
   * needs. Kept here rather than under /api/admin because membership is a
   * property of a workspace, and a member of one workspace has no business
   * reading another's.
   */
  router.get('/api/workspaces/:workspaceId/members', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    const role = await roleIn(deps.pool, workspaceId, auth.userId);
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }

    const rows = await queryRows<{
      user_id: string;
      display_name: string;
      email: string | null;
      role: string;
      is_guest: boolean;
      joined_at: Date;
    }>(
      deps.pool,
      `SELECT m.user_id, u.display_name, u.email, m.role, u.is_guest, m.joined_at
         FROM workspace_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1
        ORDER BY u.display_name COLLATE "und-x-icu"`,
      [workspaceId],
    );

    ctx.send(200, {
      members: rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        // An address is shown only to those who administer the workspace.
        // Everyone else gets the name, which is what they need to know who
        // edited a page.
        email: role === 'owner' || role === 'admin' ? row.email : null,
        role: row.role,
        isGuest: row.is_guest,
        joinedAt: row.joined_at,
      })),
      viewerRole: role,
    });
  });
}
