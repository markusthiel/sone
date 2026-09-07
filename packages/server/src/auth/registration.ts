/**
 * SONE — registration and invitations.
 *
 * Three signup modes (`SONE_SIGNUP_MODE`): open, invite, closed. The default
 * is invite, because an open instance on the public internet accumulates
 * strangers and there is no seat limit to slow that down (ADR-0007) — the
 * absence of a paywall makes a sane default more important, not less.
 */

import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import { AuthError, generateToken, hashPassword, hashToken } from './password.js';
import { createSession, type CreatedSession } from './session.js';

export const INVITATION_TTL_DAYS = 14;

/**
 * The most people one link may let in (ADR-0147).
 *
 * A bound rather than an opinion: a link is a credential that can be forwarded,
 * and a number nobody can read back — a typo of one digit — would be a link for
 * a crowd on a screen that says nothing is wrong.
 */
export const MAX_LINK_USES = 1000;

/**
 * Whether a value is a number of uses.
 *
 * One predicate, two callers: the route refuses a request with it, and the
 * function below refuses a call. It was `Math.max(1, input.maxUses ?? 25)`,
 * which turned nonsense into one, a typo into a link for a thousand people,
 * and silence into twenty-five — three answers to a question nobody asked.
 */
export const isUseCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_LINK_USES;

export type SignupMode = 'open' | 'invite' | 'closed';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export interface CreatedInvitation {
  /** Show once. The URL is built by the caller from SONE_PUBLIC_URL. */
  token: string;
  invitationId: string;
  expiresAt: Date;
}

/**
 * Create an invitation.
 *
 * With an email, it is single-use and bound to that address. Without one, it
 * is a link anybody holding the URL may use, up to `maxUses` — which is how
 * "invite the whole club" works without typing thirty addresses.
 *
 * **`maxUses` defaults to one, and is a decision when it is anything else**
 * (ADR-0147). It defaulted to twenty-five, which was a number nobody chose,
 * printed on the row as though somebody had.
 */
export async function createInvitation(
  db: Pool | PoolClient,
  input: {
    /**
     * The workspace to join, or null to invite somebody to the instance alone.
     *
     * The second is an administrator saying "have an account here" without
     * also saying "and belong to this team" — two decisions, and often only
     * the first is wanted (ADR-0025).
     */
    workspaceId: string | null;
    invitedBy: string;
    email?: string | null;
    role?: WorkspaceRole;
    maxUses?: number;
    ttlDays?: number;
  },
): Promise<CreatedInvitation> {
  const email = input.email?.trim().toLowerCase() || null;
  if (input.maxUses !== undefined && !isUseCount(input.maxUses)) {
    throw new AuthError('not a number of uses', 'invalid_credentials');
  }
  // An addressed invitation is for that person, whatever was asked for: a
  // second use would be somebody else using a link addressed to a colleague.
  const maxUses = email ? 1 : input.maxUses ?? 1;

  if (input.role === 'owner') {
    // Ownership is transferred explicitly, never granted by a link that might
    // be forwarded.
    throw new AuthError('cannot invite as owner', 'invalid_credentials');
  }

  const token = generateToken();
  const expiresAt = new Date(
    Date.now() + (input.ttlDays ?? INVITATION_TTL_DAYS) * 86_400_000,
  );

  const row = await queryOne<{ id: string }>(
    db,
    `INSERT INTO invitations
       (workspace_id, email, role, token_hash, max_uses, invited_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      input.workspaceId,
      email,
      input.role ?? 'member',
      hashToken(token),
      maxUses,
      input.invitedBy,
      expiresAt,
    ],
  );
  if (!row) throw new Error('failed to create invitation');

  return { token, invitationId: row.id, expiresAt };
}

export interface InvitationInfo {
  id: string;
  /** Null for an invitation to the instance alone (ADR-0025). */
  workspaceId: string | null;
  workspaceName: string | null;
  email: string | null;
  role: WorkspaceRole;
  remainingUses: number;
}

/**
 * Look up an invitation without consuming it, for the signup screen.
 *
 * A used-up one is not found, because it is not a way in. `spent: 'allow'`
 * asks for it anyway (ADR-0147) — there is one caller who needs to tell *this
 * invitation is spent* apart from *there is no such invitation*, and refusing
 * to look is how that caller came to answer „ungültig oder abgelaufen" to
 * somebody clicking their own link a second time.
 */
export async function inspectInvitation(
  db: Pool | PoolClient,
  token: string,
  options: { spent?: 'refuse' | 'allow' } = {},
): Promise<InvitationInfo | null> {
  const row = await queryOne<{
    id: string;
    workspace_id: string | null;
    workspace_name: string | null;
    email: string | null;
    role: WorkspaceRole;
    max_uses: number;
    uses: number;
  }>(
    db,
    `SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.role,
            i.max_uses, i.uses
       FROM invitations i
       -- Left, because an invitation to the instance names no workspace and an
       -- inner join silently made those tokens invalid rather than workspaceless.
       LEFT JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1
        AND i.revoked_at IS NULL
        AND i.expires_at > now()
        AND ($2 OR i.uses < i.max_uses)`,
    [hashToken(token), options.spent === 'allow'],
  );
  if (!row) return null;

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    email: row.email,
    role: row.role,
    remainingUses: row.max_uses - row.uses,
  };
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  /** Required unless signupMode is 'open'. */
  invitationToken?: string | null;
  userAgent?: string | null;
  ipPrefix?: string | null;
}

export interface RegisterResult {
  userId: string;
  session: CreatedSession;
  workspaceId: string | null;
}

/**
 * Register a user, consuming an invitation when one applies.
 *
 * The whole flow is one transaction. A half-registered user — account created,
 * membership missing — is a support ticket that cannot be self-serviced.
 */
export async function register(
  pool: Pool,
  mode: SignupMode,
  input: RegisterInput,
): Promise<RegisterResult> {
  if (mode === 'closed') {
    throw new AuthError('registration is disabled on this instance', 'invalid_credentials');
  }

  const email = input.email.trim().toLowerCase();
  if (!email.includes('@') || email.length > 320) {
    throw new AuthError('invalid email address', 'invalid_credentials');
  }

  const displayName = input.displayName.trim().slice(0, 128) || email.split('@')[0]!;
  // Hash before opening the transaction: scrypt takes ~100 ms and holding a
  // connection for that is wasteful under load.
  const passwordHash = await hashPassword(input.password);

  return withTransaction(pool, async (client) => {
    let invitation: InvitationInfo | null = null;

    if (mode === 'invite') {
      if (!input.invitationToken) {
        throw new AuthError('an invitation is required', 'invalid_credentials');
      }
      // Lock the row so two people cannot consume the last use of the same
      // link concurrently.
      await client.query(
        `SELECT 1 FROM invitations WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(input.invitationToken)],
      );
      invitation = await inspectInvitation(client, input.invitationToken);
      if (!invitation) {
        throw new AuthError('invitation is invalid or has expired', 'expired');
      }
      if (invitation.email !== null && invitation.email !== email) {
        throw new AuthError('this invitation is for a different address', 'invalid_credentials');
      }
    } else if (input.invitationToken) {
      invitation = await inspectInvitation(client, input.invitationToken);
    }

    const existing = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM users WHERE lower(email) = $1`,
      [email],
    );
    if (existing) {
      // Deliberately explicit. Hiding it here achieves nothing: an attacker
      // learns the same thing from the password reset form, and the ambiguity
      // only confuses the legitimate user who forgot they had an account.
      throw new AuthError('an account with this address already exists', 'invalid_credentials');
    }

    // Instance administrator for the first account only.
    //
    // This said `true` unconditionally, so every account created through
    // sign-up became an instance administrator. The comment below explains why
    // the promotion exists and the condition it describes was simply missing —
    // with open sign-up, anybody who registered could administer the instance.
    const anybodyYet = await queryOne<{ present: boolean }>(
      client,
      `SELECT EXISTS (SELECT 1 FROM users) AS present`,
    );
    const isFirstAccount = anybodyYet?.present !== true;

    const created = await queryOne<{ id: string }>(
      client,
      // Instance administrator, here and not in a migration.
      //
      // Migration 0010 promotes whoever created the first workspace, which
      // repairs an existing deployment and does nothing for a new one: on an
      // empty database there is no workspace yet, so nobody is promoted and the
      // account created a moment later has no administrative rights at all.
      // The administration area would then be invisible to everyone with no way
      // to appoint anybody except by editing the database — which is exactly
      // the situation that migration's comment claims to prevent.
      //
      // Whoever sets an instance up administers it, and this is where that
      // happens.
      `INSERT INTO users (email, display_name, password_hash, is_instance_admin)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [email, displayName, passwordHash, isFirstAccount],
    );
    if (!created) throw new Error('failed to create user');

    // A workspace of their own, always (ADR-0025).
    //
    // Before an invitation is considered, so that being invited somewhere is
    // never a reason to have nowhere of one's own. An ordinary workspace whose
    // only member is its owner — nothing else in the application knows it is
    // special.
    const personal = await queryOne<{ id: string }>(
      client,
      `INSERT INTO workspaces (name, personal_for, created_by)
       VALUES ($1, $2, $2) RETURNING id`,
      [displayName, created.id],
    );
    if (!personal) throw new Error('failed to create personal workspace');

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
       VALUES ($1,$2,(SELECT id FROM roles WHERE key = 'owner'),true)`,
      [personal.id, created.id],
    );

    // Where to land. The invited workspace when there is one, because that is
    // what somebody just accepted; their own otherwise.
    let workspaceId: string | null = personal.id;
    // An invitation with no workspace was an invitation to the instance. The
    // account exists and its own workspace exists, which is the whole of it.
    if (invitation?.workspaceId) {
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
         VALUES ($1,$2,(SELECT id FROM roles WHERE key = $3),$3 = 'owner')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [invitation.workspaceId, created.id, invitation.role],
      );
      await client.query(
        `UPDATE invitations SET uses = uses + 1 WHERE id = $1`,
        [invitation.id],
      );
      workspaceId = invitation.workspaceId;
    } else if (invitation) {
      // Still counted: a single-use instance invitation must not be usable
      // twice merely because it named no workspace.
      await client.query(`UPDATE invitations SET uses = uses + 1 WHERE id = $1`, [
        invitation.id,
      ]);
    }

    const session = await createSession(client, created.id, {
      userAgent: input.userAgent ?? null,
      ipPrefix: input.ipPrefix ?? null,
    });

    return { userId: created.id, session, workspaceId };
  });
}

/**
 * Create the first workspace and its owner.
 *
 * Used by the first-run setup screen. Refuses once any workspace exists, so
 * the endpoint cannot be used to bootstrap a second owner on a live instance.
 */
export async function bootstrapInstance(
  pool: Pool,
  input: { email: string; password: string; displayName: string; workspaceName: string },
): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);
  const email = input.email.trim().toLowerCase();

  return withTransaction(pool, async (client) => {
    // Serialise concurrent first-run attempts.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('sone:bootstrap'))`);

    const any = await queryOne<{ n: string }>(
      client,
      `SELECT count(*)::text AS n FROM workspaces`,
    );
    if (any && Number(any.n) > 0) {
      throw new AuthError('this instance is already set up', 'invalid_credentials');
    }

    const user = await queryOne<{ id: string }>(
      client,
      // Instance administrator, here and not in a migration.
      //
      // Migration 0010 promotes whoever created the first workspace, which
      // repairs an existing deployment and does nothing for a new one: on an
      // empty database there is no workspace yet, so nobody is promoted and the
      // account created a moment later has no administrative rights at all.
      // The administration area would then be invisible to everyone with no way
      // to appoint anybody except by editing the database — which is exactly
      // the situation that migration's comment claims to prevent.
      //
      // Whoever sets an instance up administers it, and this is where that
      // happens.
      `INSERT INTO users (email, display_name, password_hash, is_instance_admin)
       VALUES ($1,$2,$3,true) RETURNING id`,
      [email, input.displayName.trim().slice(0, 128), passwordHash],
    );
    if (!user) throw new Error('failed to create user');

    const workspace = await queryOne<{ id: string }>(
      client,
      `INSERT INTO workspaces (name, created_by) VALUES ($1,$2) RETURNING id`,
      [input.workspaceName.trim().slice(0, 256), user.id],
    );
    if (!workspace) throw new Error('failed to create workspace');

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
       VALUES ($1,$2,(SELECT id FROM roles WHERE key = 'owner'),true)`,
      [workspace.id, user.id],
    );

    const session = await createSession(client, user.id);
    return { userId: user.id, session, workspaceId: workspace.id };
  });
}

export async function revokeInvitation(
  db: Pool | PoolClient,
  invitationId: string,
): Promise<void> {
  await db.query(
    `UPDATE invitations SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [invitationId],
  );
}

/**
 * Outstanding invitations, for one workspace or for the instance.
 *
 * A null workspace means the invitations that name no workspace — an account and
 * a workspace of their own (ADR-0025). Same shape and one query, because two
 * functions differing by one `IS NULL` is two places to forget the revoked and
 * expired conditions.
 *
 * Revoked, expired and **used-up** ones are left out: this is a list of what
 * somebody can still act on, and a withdrawn invitation shown greyed out is a
 * row that invites the question of whether it still works.
 *
 * The third condition arrived late (ADR-0147) and the sentence above was
 * already making the promise. `inspectInvitation` has refused a spent
 * invitation since it was written, so a listed one was never a way in — it was
 * a row saying otherwise, and „macht das Sinn?" is what that looks like from
 * the other side of the screen.
 */
export async function listInvitations(
  db: Pool | PoolClient,
  workspaceId: string | null,
): Promise<Array<{ id: string; email: string | null; role: WorkspaceRole; uses: number; maxUses: number; expiresAt: Date }>> {
  const rows = await queryRows<{
    id: string;
    email: string | null;
    role: WorkspaceRole;
    uses: number;
    max_uses: number;
    expires_at: Date;
  }>(
    db,
    `SELECT id, email, role, uses, max_uses, expires_at
       FROM invitations
      WHERE workspace_id IS NOT DISTINCT FROM $1
        AND revoked_at IS NULL AND expires_at > now()
        AND uses < max_uses
      ORDER BY created_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    uses: r.uses,
    maxUses: r.max_uses,
    expiresAt: r.expires_at,
  }));
}

/**
 * Accept an invitation as somebody who already has an account.
 *
 * The other half of a two-step invitation (ADR-0025). Registration handles the
 * case where the person is new; this handles the far more common one where they
 * are not, and previously had no path at all — an existing account could only be
 * added to a workspace by somebody with database access.
 *
 * Returns the workspace joined, or null for an invitation to the instance,
 * which somebody who already has an account has nothing left to accept.
 */
export async function acceptInvitation(
  db: Pool,
  input: { token: string; userId: string },
): Promise<{ workspaceId: string | null; alreadyMember: boolean }> {
  return withTransaction(db, async (client) => {
    /*
     * Spent ones are looked up too, and then refused on purpose (ADR-0147).
     *
     * The branch below — *„somebody clicking a link twice should arrive rather
     * than be refused"* — could not be reached on a single-use link, because
     * the lookup that guards it does not find one. It only ever worked because
     * every link invitation was silently made for twenty-five people, and the
     * test for it passed for that reason. **Accidentally right is not right.**
     */
    const invitation = await inspectInvitation(client, input.token, { spent: 'allow' });
    if (!invitation) {
      throw new AuthError('invitation is invalid or has expired', 'expired');
    }
    const spent = invitation.remainingUses <= 0;

    if (!invitation.workspaceId) {
      // An instance invitation gives an account, and somebody accepting one
      // has an account already. Spent, there is nothing here for anybody —
      // the screen says it has been used, which is the true sentence.
      if (spent) {
        throw new AuthError('invitation is invalid or has expired', 'expired');
      }
      await client.query(`UPDATE invitations SET uses = uses + 1 WHERE id = $1`, [
        invitation.id,
      ]);
      return { workspaceId: null, alreadyMember: false };
    }

    // An address-bound invitation belongs to that address.
    //
    // Without this, a link intended for one person is a link that adds whoever
    // opens it while signed in as somebody else — which is a plausible accident
    // as well as a deliberate one.
    if (invitation.email) {
      const user = await queryOne<{ email: string }>(
        client,
        `SELECT email FROM users WHERE id = $1`,
        [input.userId],
      );
      if (user?.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new AuthError(
          'this invitation is for a different address',
          'invalid_credentials',
        );
      }
    }

    /*
     * A spent link is not a way in, and is still an answer for somebody who is
     * already inside. So: no insert, and membership decides.
     *
     * The order matters — asking the membership first and inserting second
     * would be the same statement with a hole in it, where a link with no uses
     * left admits whoever opens it.
     */
    if (spent) {
      const member = await queryOne<{ user_id: string }>(
        client,
        `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [invitation.workspaceId, input.userId],
      );
      if (!member) {
        throw new AuthError('invitation is invalid or has expired', 'expired');
      }
      return { workspaceId: invitation.workspaceId, alreadyMember: true };
    }

    const inserted = await queryOne<{ user_id: string }>(
      client,
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
         VALUES ($1,$2,(SELECT id FROM roles WHERE key = $3),$3 = 'owner')
       ON CONFLICT (workspace_id, user_id) DO NOTHING
       RETURNING user_id`,
      [invitation.workspaceId, input.userId, invitation.role],
    );

    // Already a member: not an error, and the invitation is not spent for it.
    //
    // Somebody clicking a link twice, or a link they were already added
    // through, should arrive at the workspace rather than at a refusal — and
    // burning a use for a membership that did not change would let a
    // double-click consume somebody else's place.
    if (!inserted) {
      return { workspaceId: invitation.workspaceId, alreadyMember: true };
    }

    await client.query(`UPDATE invitations SET uses = uses + 1 WHERE id = $1`, [
      invitation.id,
    ]);
    return { workspaceId: invitation.workspaceId, alreadyMember: false };
  });
}
