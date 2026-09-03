/**
 * SONE — instance administration.
 *
 * Everything here is behind one guard, and the guard is the point: an instance
 * administrator runs the server, which is a different thing from a workspace
 * owner running their workspace. Anyone may create a workspace (ADR-0007), so
 * conflating the two would make everyone an administrator.
 *
 * The routes are deliberately read-heavy. An administrator's first need is to
 * see what is going on — how many accounts, how much storage, what the
 * maintenance job is complaining about — and the writes are the few things that
 * otherwise require editing a compose file and restarting.
 *
 * What is *not* here, and why: nothing reads or exports page content. An
 * instance administrator can see that a workspace exists and how large it is,
 * and cannot read what is in it. They could grant themselves membership through
 * the database, and that is a different thing from the application handing it
 * over — the first leaves a trace and takes a decision, the second is a button.
 */

import type { Pool } from 'pg';

import { MAX_PROJECTION_ATTEMPTS } from '../maintenance/job.js';

import { queryOne, queryRows } from '../db/pool.js';
import { requireWorkspaceAdministrator } from './rights.js';
import { requireSession } from '../http/auth.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { SETTING_KEYS, SettingError, type SettingKey, type SettingsStore } from './settings.js';
import type { RequestContext, Router } from '../http/router.js';

export interface AdminDeps {
  pool: Pool;
  /**
   * Whether a client secret is configured, not the secret itself.
   *
   * The administration area needs to explain why single sign-on is off; it does
   * not need the credential to do that (ADR-0024).
   */
  oidcClientSecret: string | null;
  /**
   * Re-checks whether uploads can be written.
   *
   * Probed on request rather than reported from startup, because the fix is a
   * change on the host — an administrator who has just corrected a volume's
   * ownership should be able to confirm it here instead of restarting the
   * container to find out.
   */
  checkStorage?: () => Promise<string | null>;
  /**
   * Runs a maintenance pass on demand.
   *
   * Injected rather than constructed here, so the button triggers the *same*
   * job the timer runs. A second implementation would drift, and the difference
   * would only show up when somebody pressed the button expecting the scheduled
   * behaviour.
   */
  runMaintenance?: () => Promise<Record<string, unknown>>;
  settings: SettingsStore;
  /** Reported so an administrator can check what is deployed. */
  version: string;
  commit: string;
}

/**
 * Resolve the caller and refuse anyone who does not administer the instance.
 *
 * 404 rather than 403 for a non-administrator, so the existence of an admin API
 * is not something an ordinary account can confirm. There is nothing secret
 * about it, but a probe that gets a different answer for "not allowed" and "not
 * there" is how somebody maps a system.
 */
async function requireAdmin(
  pool: Pool,
  ctx: RequestContext,
): Promise<{ userId: string } | null> {
  const auth = await requireSession(pool, ctx);
  if (!auth) return null;

  const row = await queryOne<{ is_instance_admin: boolean; deactivated_at: Date | null }>(
    pool,
    `SELECT is_instance_admin, deactivated_at FROM users WHERE id = $1`,
    [auth.userId],
  );

  if (!row?.is_instance_admin || row.deactivated_at !== null) {
    ctx.fail(404, 'not_found');
    return null;
  }
  return { userId: auth.userId };
}

export function registerAdminRoutes(router: Router, deps: AdminDeps): void {
  /** What is on this instance, in numbers. */
  /**
   * How this instance talks to its identity provider.
   *
   * The client secret is never here, in either direction: it comes from the
   * environment (ADR-0024), and the response says only whether one is present
   * so the administration area can explain why single sign-on is off.
   */
  router.get('/api/admin/oidc', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    const row = await queryOne<{
      issuer: string;
      client_id: string;
      button_label: string;
      allow_signup: boolean;
      enabled: boolean;
    }>(
      deps.pool,
      `SELECT issuer, client_id, button_label, allow_signup, enabled FROM oidc_settings`,
    );

    ctx.send(200, {
      settings: row
        ? {
            issuer: row.issuer,
            clientId: row.client_id,
            buttonLabel: row.button_label,
            allowSignup: row.allow_signup,
            enabled: row.enabled,
          }
        : null,
      hasClientSecret: deps.oidcClientSecret !== null,
    });
  });

  router.put('/api/admin/oidc', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    let body: {
      issuer?: unknown;
      clientId?: unknown;
      buttonLabel?: unknown;
      allowSignup?: unknown;
      enabled?: unknown;
    };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const issuer = typeof body.issuer === 'string' ? body.issuer.trim().replace(/\/+$/, '') : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';

    // Checked here as well as at sign-in. A form that accepts an http issuer
    // and then refuses to use it is a form that lies about what it stored.
    if (!/^https:\/\//.test(issuer) && !issuer.startsWith('http://localhost')) {
      ctx.fail(422, 'issuer_not_https');
      return;
    }
    if (clientId === '') {
      ctx.fail(422, 'missing_fields');
      return;
    }

    // Enabling without a secret would mean a button that cannot work. Refused
    // with a reason rather than stored and quietly ignored.
    if (body.enabled === true && deps.oidcClientSecret === null) {
      ctx.fail(422, 'no_client_secret');
      return;
    }

    const label =
      typeof body.buttonLabel === 'string' && body.buttonLabel.trim() !== ''
        ? body.buttonLabel.trim().slice(0, 64)
        : 'Single sign-on';

    await deps.pool.query(
      `INSERT INTO oidc_settings
         (id, issuer, client_id, button_label, allow_signup, enabled, updated_by)
       VALUES (true, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         issuer = EXCLUDED.issuer,
         client_id = EXCLUDED.client_id,
         button_label = EXCLUDED.button_label,
         allow_signup = EXCLUDED.allow_signup,
         enabled = EXCLUDED.enabled,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [issuer, clientId, label, body.allowSignup === true, body.enabled === true, admin.userId],
    );

    ctx.send(200, { ok: true });
  });

  router.get('/api/admin/overview', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    const counts = await queryOne<{
      users: string;
      admins: string;
      deactivated: string;
      workspaces: string;
      pages: string;
      folders: string;
      files: string;
      file_bytes: string;
    }>(
      deps.pool,
      `SELECT
         (SELECT count(*) FROM users WHERE NOT is_guest)::text AS users,
         (SELECT count(*) FROM users WHERE is_instance_admin)::text AS admins,
         (SELECT count(*) FROM users WHERE deactivated_at IS NOT NULL)::text AS deactivated,
         (SELECT count(*) FROM workspaces)::text AS workspaces,
         (SELECT count(*) FROM pages WHERE kind = 'page' AND archived_at IS NULL)::text AS pages,
         (SELECT count(*) FROM pages WHERE kind = 'folder' AND archived_at IS NULL)::text AS folders,
         (SELECT count(*) FROM files)::text AS files,
         -- Distinct storage keys, not rows: storage is content-addressed, so
         -- the same image on five pages is five rows and one file. Summing rows
         -- would report several times the disk actually used.
         (SELECT coalesce(sum(size_bytes), 0) FROM (
            SELECT DISTINCT ON (storage_key) size_bytes FROM files
          ) unique_files)::text AS file_bytes`,
    );

    const settings = await deps.settings.resolve();

    ctx.send(200, {
      version: deps.version,
      commit: deps.commit,
      counts: {
        users: Number(counts?.users ?? 0),
        admins: Number(counts?.admins ?? 0),
        deactivated: Number(counts?.deactivated ?? 0),
        workspaces: Number(counts?.workspaces ?? 0),
        pages: Number(counts?.pages ?? 0),
        folders: Number(counts?.folders ?? 0),
        files: Number(counts?.files ?? 0),
        fileBytes: Number(counts?.file_bytes ?? 0),
      },
      settings: settings.values,
      settingSources: settings.sources,
    });
  });

  /** Every account. */
  router.get('/api/admin/users', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    const rows = await queryRows<{
      id: string;
      email: string | null;
      display_name: string;
      is_instance_admin: boolean;
      can_manage_workspaces: boolean;
      is_guest: boolean;
      deactivated_at: Date | null;
      created_at: Date;
      workspace_count: string;
    }>(
      deps.pool,
      `SELECT u.id, u.email, u.display_name, u.is_instance_admin, u.can_manage_workspaces, u.is_guest,
              u.deactivated_at, u.created_at,
              (SELECT count(*) FROM workspace_members m WHERE m.user_id = u.id)::text
                AS workspace_count
         FROM users u
        ORDER BY u.is_guest, u.display_name COLLATE "und-x-icu"`,
    );

    ctx.send(200, {
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        isInstanceAdmin: row.is_instance_admin,
        canManageWorkspaces: row.can_manage_workspaces,
        isGuest: row.is_guest,
        deactivatedAt: row.deactivated_at,
        createdAt: row.created_at,
        workspaceCount: Number(row.workspace_count),
        isSelf: row.id === admin.userId,
      })),
    });
  });

  /**
   * Change an account: promote, demote, deactivate, reactivate.
   *
   * Two safeguards, both about not locking everyone out:
   *
   *   - The last instance administrator cannot be demoted or deactivated. An
   *     instance with no administrator has no way back except editing the
   *     database by hand, and the person who does it is usually the one who
   *     just lost access.
   *   - An administrator cannot deactivate themselves. Demoting yourself is a
   *     deliberate handover and is allowed while another admin exists;
   *     deactivating yourself is never what was meant.
   */
  router.patch('/api/admin/users/:userId', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    const userId = ctx.params['userId'] ?? '';
    const target = await queryOne<{
      id: string;
      is_instance_admin: boolean;
      deactivated_at: Date | null;
    }>(
      deps.pool,
      `SELECT id, is_instance_admin, deactivated_at FROM users WHERE id = $1`,
      [userId],
    );
    if (!target) {
      ctx.fail(404, 'not_found');
      return;
    }

    let body: {
      isInstanceAdmin?: boolean;
      canManageWorkspaces?: boolean;
      deactivated?: boolean;
    };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const losingAdmin =
      (body.isInstanceAdmin === false && target.is_instance_admin) ||
      (body.deactivated === true && target.is_instance_admin);

    if (losingAdmin) {
      const remaining = await queryOne<{ n: string }>(
        deps.pool,
        `SELECT count(*)::text AS n FROM users
          WHERE is_instance_admin AND deactivated_at IS NULL AND id <> $1`,
        [userId],
      );
      if (Number(remaining?.n ?? 0) === 0) {
        ctx.fail(409, 'last_administrator');
        return;
      }
    }

    if (body.deactivated === true && userId === admin.userId) {
      ctx.fail(409, 'cannot_deactivate_yourself');
      return;
    }

    if (typeof body.isInstanceAdmin === 'boolean') {
      await deps.pool.query(`UPDATE users SET is_instance_admin = $2 WHERE id = $1`, [
        userId,
        body.isInstanceAdmin,
      ]);
    }

    if (typeof body.canManageWorkspaces === 'boolean') {
      // Stored even for an instance administrator, who holds it implicitly
      // anyway (ADR-0027). Clearing it on promotion would silently take the
      // right away again when somebody is later demoted, which is a change
      // nobody made.
      await deps.pool.query(`UPDATE users SET can_manage_workspaces = $2 WHERE id = $1`, [
        userId,
        body.canManageWorkspaces,
      ]);
    }

    if (typeof body.deactivated === 'boolean') {
      await deps.pool.query(
        `UPDATE users SET deactivated_at = $2 WHERE id = $1`,
        [userId, body.deactivated ? new Date() : null],
      );
      if (body.deactivated) {
        // Sessions are revoked immediately. Leaving them alive would mean a
        // deactivated account keeps working until its cookie expires, which is
        // not what anybody means by deactivating it.
        await deps.pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      }
    }

    ctx.send(200, { id: userId });
  });

  /** Workspaces on the instance, with size. Not their contents. */
  router.get('/api/admin/workspaces', async (ctx) => {
    // The workspace right, not the instance one: the point of granting it
    // separately is that somebody holding it can do this without being an
    // instance administrator (ADR-0027).
    const admin = await requireWorkspaceAdministrator(deps.pool, ctx);
    if (!admin) return;

    const rows = await queryRows<{
      id: string;
      name: string;
      created_at: Date;
      member_count: string;
      page_count: string;
      owner: string | null;
      personal: boolean;
      last_edited_at: Date | null;
      icon: unknown;
      deleted_at: Date | null;
    }>(
      deps.pool,
      `SELECT w.id, w.name, w.created_at, w.icon, w.personal_for IS NOT NULL AS personal,
              (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id)::text
                AS member_count,
              (SELECT count(*) FROM pages p
                WHERE p.workspace_id = w.id AND p.archived_at IS NULL
                  AND p.kind NOT IN ('row','container'))::text AS page_count,
              (SELECT max(p.last_edited_at) FROM pages p WHERE p.workspace_id = w.id)
                AS last_edited_at,
              (SELECT u.display_name FROM users u WHERE u.id = w.created_by) AS owner,
              w.deleted_at
         FROM workspaces w
        -- Shared first, then personal. Everybody has a personal workspace now
        -- (ADR-0025), so an instance of forty people has forty of them, and a
        -- list sorted only by name reads as forty teams (ADR-0027).
        ORDER BY (w.personal_for IS NOT NULL), w.name COLLATE "und-x-icu"`,
    );

    ctx.send(200, {
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        memberCount: Number(row.member_count),
        pageCount: Number(row.page_count),
        owner: row.owner,
        /** Somebody's own, rather than a team's (ADR-0025). */
        personal: row.personal,
        /** How it is recognised in a list (ADR-0030). */
        icon: row.icon ?? null,
        // Says which workspaces are alive without opening any of them, which is
        // the question somebody scanning this list actually has.
        lastEditedAt: row.last_edited_at,
        /** Marked for deletion, and still restorable. */
        deletedAt: row.deleted_at,
      })),
    });
  });

  /**
   * Mark a workspace for deletion, or take the mark off again.
   *
   * Nothing is removed here. It stops appearing to its members and can be
   * restored until it is purged — because somebody who deletes the wrong
   * workspace needs a way back, and the way back has to exist before the button
   * does (ADR-0027).
   */
  router.post('/api/admin/workspaces/:workspaceId/deletion', async (ctx) => {
    const admin = await requireWorkspaceAdministrator(deps.pool, ctx);
    if (!admin) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    const workspace = await queryOne<{
      name: string;
      personal_for: string | null;
      deleted_at: Date | null;
    }>(
      deps.pool,
      `SELECT name, personal_for, deleted_at FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (!workspace) {
      ctx.fail(404, 'not_found');
      return;
    }

    let body: { confirmName?: unknown; restore?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    if (body.restore === true) {
      await deps.pool.query(
        `UPDATE workspaces SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`,
        [workspaceId],
      );
      ctx.send(200, { deletedAt: null });
      return;
    }

    // A personal workspace goes with its account, not on its own. Removing it
    // would leave somebody signed in with nowhere to write — and the account
    // itself is deactivated elsewhere, where that decision belongs.
    if (workspace.personal_for) {
      ctx.fail(409, 'personal_workspace');
      return;
    }

    // The name, typed. Not a confirmation dialog: those are dismissed by the
    // same reflex that opened them, and this takes everybody's pages with it.
    if (typeof body.confirmName !== 'string' || body.confirmName.trim() !== workspace.name) {
      ctx.fail(422, 'name_mismatch');
      return;
    }

    await deps.pool.query(
      `UPDATE workspaces SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
      [workspaceId, admin.userId],
    );
    ctx.send(200, { deletedAt: new Date() });
  });

  /** Change an instance setting, or clear it back to the environment. */
  router.patch('/api/admin/settings', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    let body: Record<string, unknown>;
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const unknown = Object.keys(body).filter((key) => !(key in SETTING_KEYS));
    if (unknown.length > 0) {
      // Rejected rather than ignored: a typo silently stored is a setting
      // somebody believes they changed.
      ctx.fail(422, 'unknown_setting');
      return;
    }

    try {
      for (const [key, value] of Object.entries(body)) {
        await deps.settings.set(key as SettingKey, value, admin.userId);
      }
    } catch (err) {
      if (err instanceof SettingError) {
        ctx.fail(422, err.code);
        return;
      }
      throw err;
    }

    const resolved = await deps.settings.resolve();
    ctx.send(200, { settings: resolved.values, settingSources: resolved.sources });
  });

  /**
   * What the maintenance job is complaining about.
   *
   * These are the views migrations 0002, 0003, 0005 and 0007 created for
   * anomalies a constraint cannot express, because CRDT updates arrive out of
   * order and a constraint would reject data that is merely early.
   */
  router.get('/api/admin/maintenance', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    const counts = await queryOne<{
      orphaned: string;
      stale_search: string;
      inside_pages: string;
      failed: string;
      pending: string;
    }>(
      deps.pool,
      `SELECT
         (SELECT count(*) FROM orphaned_pages)::text AS orphaned,
         (SELECT count(*) FROM stale_search_rows)::text AS stale_search,
         (SELECT count(*) FROM pages_inside_pages)::text AS inside_pages,
         -- Given up on: failed and past the retry limit, which is what the
         -- operator has to act on.
         (SELECT count(*) FROM materialization_state
           WHERE status = 'failed' AND attempts >= ${MAX_PROJECTION_ATTEMPTS})::text AS failed,
         -- Retryable failures, not "stale".
         --
         -- This counted a "stale" status, which nothing has written since the
         -- rebuild path was replaced by failure-and-retry: markStale was its
         -- only writer and had no callers, so the operator was shown a number
         -- that was structurally always zero and told it was "normal while
         -- people are editing".
         (SELECT count(*) FROM materialization_state
           WHERE status = 'failed' AND attempts < ${MAX_PROJECTION_ATTEMPTS})::text AS pending`,
    );

    // The failing pages themselves, capped: a list of thousands helps nobody,
    // and the first few are usually the same problem.
    const failures = await queryRows<{ page_id: string; last_error: string | null }>(
      deps.pool,
      `SELECT page_id, last_error FROM materialization_state
        WHERE status = 'failed' ORDER BY materialized_at DESC LIMIT 20`,
    );

    // Storage first, because it is the only thing in this report that is
    // certainly broken rather than possibly transient — and it was previously
    // visible only in the container log, which is not where anybody looks when
    // an upload fails.
    const storageProblem = deps.checkStorage ? await deps.checkStorage() : null;

    ctx.send(200, {
      storage: {
        writable: storageProblem === null,
        problem: storageProblem,
      },
      counts: {
        orphanedPages: Number(counts?.orphaned ?? 0),
        staleSearchRows: Number(counts?.stale_search ?? 0),
        entriesInsidePages: Number(counts?.inside_pages ?? 0),
        failedMaterialisations: Number(counts?.failed ?? 0),
        pendingMaterialisations: Number(counts?.pending ?? 0),
      },
      failures: failures.map((row) => ({
        pageId: row.page_id,
        error: row.last_error,
      })),
    });
  });

  /**
   * Run maintenance now.
   *
   * The panel reported problems it could not act on, which is a screen that
   * makes somebody feel worse without helping. This is the same pass the timer
   * runs every few minutes; pressing it is for when waiting is not acceptable —
   * after fixing whatever caused a projection to fail, typically.
   */
  router.post('/api/admin/maintenance/run', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    if (!deps.runMaintenance) {
      ctx.fail(503, 'maintenance_not_available');
      return;
    }

    const report = await deps.runMaintenance();
    ctx.send(200, { report });
  });

  /**
   * Retry one page's projection, ignoring its attempt count.
   *
   * The automatic retry gives up after a few attempts, on the reasoning that a
   * document which cannot be read is a bug rather than a hiccup. This is the way
   * back: having fixed the cause, an administrator says try again, and the
   * attempt counter is cleared so the automatic retries resume too.
   */
  router.post('/api/admin/maintenance/retry/:pageId', async (ctx) => {
    const admin = await requireAdmin(deps.pool, ctx);
    if (!admin) return;

    const pageId = ctx.params['pageId'] ?? '';
    const page = await queryOne<{ workspace_id: string }>(
      deps.pool,
      `SELECT workspace_id FROM pages WHERE id = $1`,
      [pageId],
    );
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }

    await deps.pool.query(
      `UPDATE materialization_state SET attempts = 0 WHERE page_id = $1`,
      [pageId],
    );

    try {
      await rematerialize(deps.pool, pageId, page.workspace_id);
    } catch (err) {
      // Reported rather than thrown: the administrator asked whether it works
      // now, and "no, and here is why" is the answer they need.
      ctx.send(200, {
        pageId,
        recovered: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const after = await queryOne<{ status: string }>(
      deps.pool,
      `SELECT status FROM materialization_state WHERE page_id = $1`,
      [pageId],
    );
    ctx.send(200, { pageId, recovered: after?.status === 'ok' });
  });
}

/** Is this account an instance administrator? Used outside the admin routes. */
export async function isInstanceAdmin(pool: Pool, userId: string): Promise<boolean> {
  const row = await queryOne<{ is_instance_admin: boolean }>(
    pool,
    `SELECT is_instance_admin FROM users WHERE id = $1 AND deactivated_at IS NULL`,
    [userId],
  );
  return row?.is_instance_admin === true;
}
