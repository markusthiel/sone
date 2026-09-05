/**
 * SONE server — invitations over HTTP.
 *
 * The domain layer has had invitations since the authentication work and
 * nothing ever exposed them: they could be created and accepted only from
 * inside the process, so in practice the only way into a workspace was to be
 * there when it was made.
 *
 * Two kinds, per ADR-0025. An invitation naming a workspace adds somebody to
 * it; one naming none creates an account and nothing else.
 */

import type { Pool } from 'pg';

import type { Router } from '../http/router.js';
import { roleIn } from './claims.js';
import { queryOne } from '../db/pool.js';
import { requireSession } from '../http/auth.js';
import { holdsRight } from './rights.js';
import { AuthError } from './password.js';
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitations,
  revokeInvitation,
} from './registration.js';
import type { WorkspaceRole } from './registration.js';

export interface InvitationDeps {
  pool: Pool;
}

const ROLES: readonly string[] = ['admin', 'member', 'guest'];

/**
 * May this person administer this workspace?
 *
 * Two ways to be able to: owner or admin *of it*, or holding the instance-wide
 * right to manage workspaces (ADR-0027). Asked in one place, because the second
 * way arrived after the first and every route that forgot it would be a route
 * where the right silently does not work.
 */
async function mayAdminister(
  pool: Pool,
  ctx: Parameters<typeof requireSession>[1],
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  // `people.manage` rather than "owner or admin" (ADR-0087). Both ways of
  // holding it — the role, and the instance-wide right — are asked inside
  // `holdsRight`, which is where ADR-0027's consolidation now lives.
  const { member, held } = await holdsRight(pool, workspaceId, userId, 'people.manage');
  if (held) return true;

  // Not found rather than forbidden for a workspace somebody is not in: "you
  // may not invite here" confirms the workspace exists.
  ctx.fail(member ? 403 : 404, member ? 'forbidden' : 'not_found');
  return false;
}

export function registerInvitationRoutes(router: Router, deps: InvitationDeps): void {
  /**
   * What a token is for, before anybody commits to it.
   *
   * Unauthenticated, because it is read on the sign-up page by somebody who has
   * no account yet. It says the workspace's name and whether an address is
   * required — never who invited whom, and never the address itself, which
   * would make a guessed token a way to harvest one.
   */
  router.get('/api/invitations/:token', async (ctx) => {
    const invitation = await inspectInvitation(deps.pool, ctx.params['token'] ?? '');
    if (!invitation) {
      ctx.fail(404, 'invalid_invitation');
      return;
    }

    ctx.send(200, {
      workspaceName: invitation.workspaceName,
      /** An invitation to the instance alone has no workspace to name. */
      instanceOnly: invitation.workspaceId === null,
      needsAddress: invitation.email !== null,
    });
  });

  /** Accept it as somebody who already has an account. */
  router.post('/api/invitations/:token/accept', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    try {
      const result = await acceptInvitation(deps.pool, {
        token: ctx.params['token'] ?? '',
        userId: user.userId,
      });
      ctx.send(200, result);
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        ctx.fail(400, error.code);
        return;
      }
      throw error;
    }
  });

  /**
   * Give an account that already exists access to a workspace (ADR-0073).
   *
   * This replaces inviting somebody to a workspace, and the two were being
   * confused because one form did both jobs. They are different jobs. An
   * invitation makes an *account* — a person who is not on this server yet — and
   * that belongs to whoever runs the server. Access says which of the people
   * already here may work in this workspace, and that belongs to whoever owns
   * the workspace.
   *
   * By address rather than from a list of everybody. An owner adding a
   * colleague knows their address; a picker of every account on the server
   * would turn every workspace owner into a reader of the instance's directory,
   * which is a right the administration keeps on purpose (ADR-0032).
   *
   * Owners and admins only, like every other change to who is here: a member
   * who could add people could add somebody with more rights than themselves,
   * and a workspace where anybody can widen the membership is not one whose
   * membership means anything.
   */
  router.post('/api/workspaces/:workspaceId/members', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    let body: { email?: unknown; role?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email === '') {
      ctx.fail(422, 'invalid_email');
      return;
    }
    const role = typeof body.role === 'string' && ROLES.includes(body.role)
      ? (body.role as WorkspaceRole)
      : 'member';

    /*
     * A real account, in use.
     *
     * `is_guest` marks somebody who arrived through a share link and has no
     * account of their own; a disabled one is an account that has been turned
     * off, and turning it off must not be undone by adding it somewhere.
     */
    const account = await queryOne<{ id: string }>(
      deps.pool,
      `SELECT id FROM users
        WHERE lower(email) = $1 AND NOT is_guest AND disabled_at IS NULL`,
      [email],
    );
    if (!account) {
      // Said plainly rather than hidden. The alternative — the same answer for
      // "no such account" and "added" — would leave an owner unable to tell a
      // typo from a success, and the people who can ask this question are the
      // ones already trusted with who is in the workspace.
      ctx.fail(404, 'no_such_account');
      return;
    }

    const already = await roleIn(deps.pool, workspaceId, account.id);
    if (already) {
      // Not a silent role change: "add" and "promote" are different acts, and
      // the second one has a control of its own in the same table.
      ctx.fail(409, 'already_member');
      return;
    }

    await deps.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, role_id, is_owner)
       -- The role named twice: as the enum the old column wants, and as the
       -- text the role row is found by.
       VALUES ($1,$2,$3,(SELECT id FROM roles WHERE key = $4),$4 = 'owner')`,
      [workspaceId, account.id, role, role],
    );
    ctx.send(201, { userId: account.id, role });
  });

  /**
   * Outstanding invitations to the instance.
   *
   * The counterpart of the workspace listing above, and the reason it exists: an
   * invitation that cannot be seen cannot be withdrawn, so a link sent to the
   * wrong address stayed valid for as long as it lived and nobody could tell.
   */
  router.get('/api/admin/invitations', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const admin = await queryOne<{ is_instance_admin: boolean }>(
      deps.pool,
      `SELECT is_instance_admin FROM users WHERE id = $1`,
      [user.userId],
    );
    if (admin?.is_instance_admin !== true) {
      ctx.fail(403, 'forbidden');
      return;
    }

    // Null: the invitations that name no workspace.
    ctx.send(200, { invitations: await listInvitations(deps.pool, null) });
  });

  /**
   * Invite somebody to the instance and nowhere else.
   *
   * The thing that could not be expressed before: an account, and their own
   * workspace, without a decision about which team they belong to.
   */
  router.post('/api/admin/invitations', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const admin = await queryOne<{ is_instance_admin: boolean }>(
      deps.pool,
      `SELECT is_instance_admin FROM users WHERE id = $1`,
      [user.userId],
    );
    if (admin?.is_instance_admin !== true) {
      ctx.fail(403, 'forbidden');
      return;
    }

    let body: { email?: unknown; maxUses?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const invitation = await createInvitation(deps.pool, {
      workspaceId: null,
      invitedBy: user.userId,
      email: typeof body.email === 'string' ? body.email : null,
      ...(typeof body.maxUses === 'number' ? { maxUses: body.maxUses } : {}),
    });

    ctx.send(201, {
      token: invitation.token,
      invitationId: invitation.invitationId,
      expiresAt: invitation.expiresAt,
    });
  });

  /** What is outstanding, so an administrator can see and withdraw them. */
  router.get('/api/workspaces/:workspaceId/invitations', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    ctx.send(200, { invitations: await listInvitations(deps.pool, workspaceId) });
  });

  /**
   * Change what somebody may do in a workspace.
   *
   * Here rather than in workspaces.ts because it is the same question those
   * routes ask — who may administer this workspace — and answering it in two
   * files is how the instance-wide right ends up working in one and not the
   * other.
   */
  router.put('/api/workspaces/:workspaceId/members/:userId', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    let body: { role?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const target = ctx.params['userId'] ?? '';
    const role = typeof body.role === 'string' ? body.role : '';
    if (!['owner', 'admin', 'member', 'guest'].includes(role)) {
      ctx.fail(422, 'invalid_role');
      return;
    }

    const current = await roleIn(deps.pool, workspaceId, target);
    if (!current) {
      ctx.fail(404, 'not_found');
      return;
    }

    // A workspace keeps an owner.
    //
    // Demoting the last one leaves a workspace nobody can transfer or delete,
    // and the person who did it is usually the person who then cannot undo it.
    //
    // Counted over `is_owner`, the column, rather than over the role word:
    // ownership is not a right and does not travel with a role, precisely so
    // that this rule stays one query instead of "the last person holding a
    // role that includes deletion" (ADR-0087).
    if (current === 'owner' && role !== 'owner') {
      const others = await queryOne<{ n: number }>(
        deps.pool,
        `SELECT count(*)::int AS n FROM workspace_members
          WHERE workspace_id = $1 AND is_owner AND user_id <> $2`,
        [workspaceId, target],
      );
      if ((others?.n ?? 0) === 0) {
        ctx.fail(409, 'last_owner');
        return;
      }
    }

    await deps.pool.query(
      // The role row as well as the word (ADR-0087): the word is what the
      // request names and the row is what everything reads. Ownership is its
      // own column, because it is not a right.
      `UPDATE workspace_members
          SET role = $3,
              role_id = (SELECT id FROM roles WHERE key = $4),
              is_owner = ($4 = 'owner')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, target, role, role],
    );
    ctx.send(200, { ok: true });
  });

  /** Remove somebody from a workspace. */
  router.delete('/api/workspaces/:workspaceId/members/:userId', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    const target = ctx.params['userId'] ?? '';
    const current = await roleIn(deps.pool, workspaceId, target);
    if (!current) {
      ctx.fail(404, 'not_found');
      return;
    }

    if (current === 'owner') {
      // Over the column, for the reason above.
      const others = await queryOne<{ n: number }>(
        deps.pool,
        `SELECT count(*)::int AS n FROM workspace_members
          WHERE workspace_id = $1 AND is_owner AND user_id <> $2`,
        [workspaceId, target],
      );
      if ((others?.n ?? 0) === 0) {
        ctx.fail(409, 'last_owner');
        return;
      }
    }

    // Somebody's own workspace is not one they can be removed from. It exists
    // because they do (ADR-0025), and a personal workspace with no members is
    // a document store nobody can open.
    const personal = await queryOne<{ id: string }>(
      deps.pool,
      `SELECT id FROM workspaces WHERE id = $1 AND personal_for = $2`,
      [workspaceId, target],
    );
    if (personal) {
      ctx.fail(409, 'personal_workspace');
      return;
    }

    await deps.pool.query(
      `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, target],
    );

    // Page grants go with the membership. Left behind they would give access to
    // somebody who is no longer here — and reinstate it silently if they ever
    // rejoin.
    await deps.pool.query(
      `DELETE FROM page_permissions pp
        USING pages p
        WHERE pp.page_id = p.id AND p.workspace_id = $1 AND pp.user_id = $2`,
      [workspaceId, target],
    );
    await deps.pool.query(
      `DELETE FROM group_members gm
        USING groups g
        WHERE gm.group_id = g.id AND g.workspace_id = $1 AND gm.user_id = $2`,
      [workspaceId, target],
    );

    ctx.send(200, { ok: true });
  });

  router.delete('/api/invitations/:invitationId', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    // Withdrawable by whoever could have created it: an admin of the workspace
    // it names, or an instance administrator for one that names none.
    const invitation = await queryOne<{ workspace_id: string | null }>(
      deps.pool,
      `SELECT workspace_id FROM invitations WHERE id = $1`,
      [ctx.params['invitationId'] ?? ''],
    );
    if (!invitation) {
      ctx.fail(404, 'not_found');
      return;
    }

    const allowed = invitation.workspace_id
      ? await queryOne<{ role: WorkspaceRole }>(
          deps.pool,
          // Left as its own statement, not `roleIn`: this asks whether
          // somebody is one of two roles, which is a different question from
          // which role they are — and it answers it in the database rather than
          // fetching a value to compare in JavaScript.
          `SELECT role FROM workspace_members
            WHERE workspace_id = $1 AND user_id = $2 AND role IN ('owner','admin')`,
          [invitation.workspace_id, user.userId],
        )
      : await queryOne<{ is_instance_admin: boolean }>(
          deps.pool,
          `SELECT is_instance_admin FROM users
            WHERE id = $1 AND is_instance_admin = true`,
          [user.userId],
        );

    if (!allowed) {
      ctx.fail(403, 'forbidden');
      return;
    }

    await revokeInvitation(deps.pool, ctx.params['invitationId'] ?? '');
    ctx.send(200, { ok: true });
  });
}
