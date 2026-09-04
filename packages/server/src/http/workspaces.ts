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

import { sanitiseTheme } from '@sone/core';
import { roleIn } from '../auth/claims.js';
import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import { createDefaultFolder } from '../pages/createEntry.js';
import { requireSession } from './auth.js';
import { WORKSPACE_ORDER_SQL, placeWorkspace } from '../workspaces/order.js';
import { BodyError, type RequestContext, type Router } from './router.js';
import { administratorRights } from '../admin/rights.js';

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
// `roleIn` now comes from `claims.ts`, which is the module about who somebody
// is. The private copy that was here was one of five.
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
      icon: unknown;
    }>(
      deps.pool,
      `SELECT w.id, w.name, m.role, w.default_locale, w.icon,
              (SELECT count(*) FROM pages p
                WHERE p.workspace_id = w.id AND p.archived_at IS NULL)::text AS page_count,
              (SELECT count(*) FROM workspace_members mm
                WHERE mm.workspace_id = w.id)::text AS member_count
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = $1
          -- The same exclusion the session endpoint has always made: a
          -- workspace marked for deletion stops appearing to its members
          -- (ADR-0027). It was missing here, so the switcher offered somewhere
          -- to write that the rest of the interface had already taken away.
          AND w.deleted_at IS NULL
        -- The person's own order (ADR-0031), from the one clause both listings
        -- read — this and /api/auth/session must agree, because the first entry
        -- is where a browser with nothing remembered opens.
        ${WORKSPACE_ORDER_SQL}`,
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
        /** How it is recognised in a list (ADR-0030). */
        icon: row.icon ?? null,
      })),
    });
  });

  /**
   * Reorder the caller's own switcher (ADR-0031).
   *
   * No permission check beyond having a session, and that is the point: this
   * writes the caller's own membership rows and says nothing about the
   * workspaces themselves. A viewer of a workspace may still arrange their own
   * list, because the list is not part of any workspace.
   *
   * `afterWorkspaceId: null` means first. Absent is refused rather than read as
   * "last": every caller is a drag that landed somewhere, so a missing field is
   * a client bug, and answering it with a guess would hide it.
   */
  router.post('/api/workspaces/reorder', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const body = await readBody<{
      workspaceId?: string;
      afterWorkspaceId?: string | null;
    }>(ctx);
    if (!body) return;

    const workspaceId = body.workspaceId ?? '';
    if (!workspaceId || !('afterWorkspaceId' in body)) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    const result = await placeWorkspace(
      deps.pool,
      auth.userId,
      workspaceId,
      body.afterWorkspaceId ?? null,
    );
    if (!result.ok) {
      ctx.fail(result.status, result.code);
      return;
    }

    ctx.send(200, { workspaceId, idx: result.idx });
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
    // Or the instance-wide right, which is how somebody administers a workspace
    // they are not in (ADR-0027). Naming and decorating are the same act, so
    // the same people may do both (ADR-0030).
    /*
     * Asked whatever the role is, which it was not.
     *
     * The rights were fetched only when the role was null, so somebody who
     * manages workspaces **and happens to be an ordinary member of one** was
     * refused — while the same person could have edited it by leaving the
     * workspace first. A right that a membership takes away is not a right.
     *
     * Found by loosening the interface to match this rule and noticing the rule
     * did not match itself (ADR-0067).
     */
    const rights = await administratorRights(deps.pool, auth.userId);
    if (role === null && !rights.workspaces) {
      // Same answer as a workspace that does not exist: the difference would
      // reveal which workspaces are on this instance.
      ctx.fail(404, 'not_found');
      return;
    }
    if (role !== null && role !== 'owner' && role !== 'admin' && !rights.workspaces) {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const body = await readBody<{
      name?: string;
      icon?: { icon?: string; iconColor?: string; titleColor?: string } | null;
    }>(ctx);
    if (!body) return;

    // The icon may be changed without the name and the name without the icon.
    // Requiring both would mean a picker that has to send a name it did not ask
    // anybody about, which is how a rename happens by accident.
    if ('icon' in body) {
      await deps.pool.query(`UPDATE workspaces SET icon = $2 WHERE id = $1`, [
        workspaceId,
        body.icon === null ? null : JSON.stringify(body.icon),
      ]);
    }

    if (body.name !== undefined) {
      const name = body.name.trim().slice(0, 256);
      if (name.length === 0) {
        ctx.fail(422, 'missing_fields');
        return;
      }
      await deps.pool.query(`UPDATE workspaces SET name = $2 WHERE id = $1`, [
        workspaceId,
        name,
      ]);
    }

    const row = await queryOne<{ name: string; icon: unknown }>(
      deps.pool,
      `SELECT name, icon FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    ctx.send(200, { id: workspaceId, name: row?.name ?? '', icon: row?.icon ?? null });
  });

  /**
   * Members of a workspace.
   *
   * Read-only for now, and the beginning of the user management an admin area
   * needs. Kept here rather than under /api/admin because membership is a
   * property of a workspace, and a member of one workspace has no business
   * reading another's.
   */
  /**
   * A workspace's theme.
   *
   * Readable by any member, because everybody sees what it does. A workspace
   * with no row answers with an empty theme rather than 404: having no theme is
   * the ordinary state, not a missing resource.
   */
  router.get('/api/workspaces/:workspaceId/theme', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    const role = await roleIn(deps.pool, workspaceId, auth.userId);
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }

    const row = await queryOne<{ settings: unknown }>(
      deps.pool,
      `SELECT settings FROM workspace_themes WHERE workspace_id = $1`,
      [workspaceId],
    );

    // Sanitised on the way out as well as in. A value written by a newer
    // version, or by hand, must not reach a client that would then render
    // something nothing here decided.
    ctx.send(200, { theme: sanitiseTheme(row?.settings ?? {}) });
  });

  /**
   * Set it. Owners and admins only.
   *
   * This changes what a workspace looks like for everybody in it, which is what
   * "defaults" means — so it is not a thing an ordinary member does by
   * accident.
   */
  router.put('/api/workspaces/:workspaceId/theme', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    const role = await roleIn(deps.pool, workspaceId, auth.userId);
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (role !== 'owner' && role !== 'admin') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    let body: { theme?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    // Unusable values are dropped rather than refused: a theme comes from a
    // form, and one stale field should not cost somebody the rest of their
    // settings. What comes back says what was actually stored.
    const theme = sanitiseTheme(body.theme);

    await deps.pool.query(
      `INSERT INTO workspace_themes (workspace_id, settings, updated_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (workspace_id) DO UPDATE
         SET settings = EXCLUDED.settings,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [workspaceId, JSON.stringify(theme), auth.userId],
    );

    ctx.send(200, { theme });
  });

  /**
   * Where this person lands in this workspace.
   *
   * Resolved on the server rather than by the client choosing between two
   * fields: the page a fixed landing names may have been deleted or put out of
   * reach since, and the fallback then has to be the same one the client would
   * have applied anyway. One answer, decided where the data is.
   */
  router.get('/api/workspaces/:workspaceId/landing', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if ((await roleIn(deps.pool, workspaceId, auth.userId)) === null) {
      ctx.fail(404, 'not_found');
      return;
    }

    const row = await queryOne<{
      mode: string;
      page_id: string | null;
      last_page_id: string | null;
    }>(
      deps.pool,
      `SELECT mode, page_id, last_page_id FROM workspace_landing
        WHERE user_id = $1 AND workspace_id = $2`,
      [auth.userId, workspaceId],
    );

    const wanted = row?.mode === 'fixed' ? row.page_id : (row?.last_page_id ?? null);

    // Checked before it is offered. A landing page that was deleted, archived
    // or restricted since it was chosen would otherwise send somebody to a
    // refusal every time they sign in — the one page they cannot avoid.
    const usable = wanted
      ? await queryOne<{ id: string }>(
          deps.pool,
          `SELECT id FROM pages
            WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
              AND kind NOT IN ('row','container')`,
          [wanted, workspaceId],
        )
      : null;

    ctx.send(200, {
      mode: row?.mode ?? 'last',
      pageId: row?.page_id ?? null,
      /** Where to go now, or null to let the interface decide. */
      landOn: usable?.id ?? null,
    });
  });

  /** Remember where somebody is, and what they want on arrival. */
  router.put('/api/workspaces/:workspaceId/landing', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if ((await roleIn(deps.pool, workspaceId, auth.userId)) === null) {
      ctx.fail(404, 'not_found');
      return;
    }

    let body: { mode?: unknown; pageId?: unknown; lastPageId?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const mode = body.mode === 'fixed' ? 'fixed' : body.mode === 'last' ? 'last' : null;
    const pageId = typeof body.pageId === 'string' ? body.pageId : null;
    const lastPageId = typeof body.lastPageId === 'string' ? body.lastPageId : null;

    await deps.pool.query(
      `INSERT INTO workspace_landing (user_id, workspace_id, mode, page_id, last_page_id)
       VALUES ($1,$2, COALESCE($3,'last'), $4, $5)
       ON CONFLICT (user_id, workspace_id) DO UPDATE SET
         -- Each field only when it was named. Recording where somebody is
         -- happens constantly and must not quietly reset the mode they chose.
         mode = COALESCE($3, workspace_landing.mode),
         page_id = CASE WHEN $3 IS NULL THEN workspace_landing.page_id ELSE $4 END,
         last_page_id = COALESCE($5, workspace_landing.last_page_id),
         updated_at = now()`,
      [auth.userId, workspaceId, mode, pageId, lastPageId],
    );

    ctx.send(200, { ok: true });
  });

  router.get('/api/workspaces/:workspaceId/members', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    const role = await roleIn(deps.pool, workspaceId, auth.userId);
    // Or the instance-wide right to administer workspaces, which is how
    // somebody manages a team they are not in (ADR-0027).
    const rights = role === null ? await administratorRights(deps.pool, auth.userId) : null;
    if (role === null && rights?.workspaces !== true) {
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
