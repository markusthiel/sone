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
 */
export async function createInvitation(
  db: Pool | PoolClient,
  input: {
    workspaceId: string;
    invitedBy: string;
    email?: string | null;
    role?: WorkspaceRole;
    maxUses?: number;
    ttlDays?: number;
  },
): Promise<CreatedInvitation> {
  const email = input.email?.trim().toLowerCase() || null;
  const maxUses = email ? 1 : Math.max(1, input.maxUses ?? 25);

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
  workspaceId: string;
  workspaceName: string;
  email: string | null;
  role: WorkspaceRole;
  remainingUses: number;
}

/** Look up an invitation without consuming it, for the signup screen. */
export async function inspectInvitation(
  db: Pool | PoolClient,
  token: string,
): Promise<InvitationInfo | null> {
  const row = await queryOne<{
    id: string;
    workspace_id: string;
    workspace_name: string;
    email: string | null;
    role: WorkspaceRole;
    max_uses: number;
    uses: number;
  }>(
    db,
    `SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.role,
            i.max_uses, i.uses
       FROM invitations i
       JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1
        AND i.revoked_at IS NULL
        AND i.expires_at > now()
        AND i.uses < i.max_uses`,
    [hashToken(token)],
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

    const created = await queryOne<{ id: string }>(
      client,
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id`,
      [email, displayName, passwordHash],
    );
    if (!created) throw new Error('failed to create user');

    let workspaceId: string | null = null;
    if (invitation) {
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [invitation.workspaceId, created.id, invitation.role],
      );
      await client.query(
        `UPDATE invitations SET uses = uses + 1 WHERE id = $1`,
        [invitation.id],
      );
      workspaceId = invitation.workspaceId;
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
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id`,
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
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`,
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

export async function listInvitations(
  db: Pool | PoolClient,
  workspaceId: string,
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
      WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > now()
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
