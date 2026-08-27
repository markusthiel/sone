/**
 * SONE — sessions and login.
 *
 * Sessions are rows, not signed tokens. ADR-0006 rejected stateless tokens
 * for share links because revocation must be immediate; the same reasoning
 * applies here, and one mechanism is better than two.
 */

import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import {
  AuthError,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from './password.js';

export const SESSION_TTL_DAYS = 30;
/** Sessions idle longer than this are treated as expired even if not past TTL. */
export const SESSION_IDLE_DAYS = 14;

/** Login attempts allowed per identifier within the window. */
export const LOGIN_ATTEMPT_LIMIT = 10;
export const LOGIN_ATTEMPT_WINDOW_MINUTES = 15;

export interface SessionUser {
  userId: string;
  email: string | null;
  displayName: string;
  isGuest: boolean;
}

export interface CreatedSession {
  /** Return to the client once; never stored in plaintext. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  password_hash: string | null;
  is_guest: boolean;
  disabled_at: Date | null;
}

// --- rate limiting ---------------------------------------------------------

/**
 * Count recent failures for a key.
 *
 * Counted in Postgres rather than in memory so the limit survives a restart
 * and holds across instances. An in-memory counter is defeated by restarting
 * the container, which an attacker cannot do — but a crash-looping instance
 * can, accidentally.
 */
async function recentFailures(db: Pool | PoolClient, key: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    db,
    `SELECT count(*)::text AS n
       FROM auth_attempts
      WHERE key = $1
        AND succeeded = false
        AND attempted_at > now() - ($2 || ' minutes')::interval`,
    [key, String(LOGIN_ATTEMPT_WINDOW_MINUTES)],
  );
  return row ? Number(row.n) : 0;
}

async function recordAttempt(
  db: Pool | PoolClient,
  key: string,
  succeeded: boolean,
  ipPrefix: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO auth_attempts (key, succeeded, ip_prefix) VALUES ($1, $2, $3)`,
    [key, succeeded, ipPrefix],
  );
}

/** Clear the failure ledger for a key after a success. */
async function clearAttempts(db: Pool | PoolClient, key: string): Promise<void> {
  await db.query(`DELETE FROM auth_attempts WHERE key = $1 AND succeeded = false`, [key]);
}

// --- login -----------------------------------------------------------------

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string | null;
  ipPrefix?: string | null;
}

/**
 * Authenticate and create a session.
 *
 * Always performs a password hash comparison, even when the email is unknown,
 * so response timing does not reveal which accounts exist. The dummy hash is
 * a real scrypt verification against a fixed value.
 */
export async function login(pool: Pool, input: LoginInput): Promise<CreatedSession> {
  const email = input.email.trim().toLowerCase();
  const rateKey = `login:${email}`;

  if ((await recentFailures(pool, rateKey)) >= LOGIN_ATTEMPT_LIMIT) {
    throw new AuthError(
      `too many failed attempts; try again in ${LOGIN_ATTEMPT_WINDOW_MINUTES} minutes`,
      'rate_limited',
    );
  }

  const user = await queryOne<UserRow>(
    pool,
    `SELECT id, email, display_name, password_hash, is_guest, disabled_at
       FROM users WHERE lower(email) = $1`,
    [email],
  );

  // Same work regardless of whether the account exists.
  const storedHash = user?.password_hash ?? DUMMY_HASH;
  const { valid, needsRehash } = await verifyPassword(input.password, storedHash);

  if (!user || !valid || user.disabled_at !== null) {
    await recordAttempt(pool, rateKey, false, input.ipPrefix ?? null);
    throw new AuthError('invalid email or password', 'invalid_credentials');
  }

  if (needsRehash) {
    // Transparent upgrade: the user never notices, and the next login is
    // protected by the current parameters.
    const upgraded = await hashPassword(input.password);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      upgraded,
      user.id,
    ]);
  }

  await clearAttempts(pool, rateKey);
  await recordAttempt(pool, rateKey, true, input.ipPrefix ?? null);

  return createSession(pool, user.id, {
    userAgent: input.userAgent ?? null,
    ipPrefix: input.ipPrefix ?? null,
  });
}

/**
 * A valid scrypt hash of a value nobody knows, used to equalise timing for
 * unknown accounts. Generated once at module load.
 */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

// --- sessions --------------------------------------------------------------

export async function createSession(
  db: Pool | PoolClient,
  userId: string,
  meta: { userAgent?: string | null; ipPrefix?: string | null } = {},
): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  const row = await queryOne<{ id: string }>(
    db,
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_prefix, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      userId,
      hashToken(token),
      meta.userAgent?.slice(0, 256) ?? null,
      meta.ipPrefix ?? null,
      expiresAt,
    ],
  );
  if (!row) throw new Error('failed to create session');

  return { token, sessionId: row.id, expiresAt };
}

/**
 * Resolve a session token to its user.
 *
 * Returns null for anything unusable — expired, revoked, idle too long,
 * unknown, or belonging to a disabled account — without distinguishing the
 * cases to the caller. The distinction is only useful to an attacker.
 */
export async function resolveSession(
  db: Pool | PoolClient,
  token: string,
): Promise<{ user: SessionUser; sessionId: string } | null> {
  const row = await queryOne<{
    session_id: string;
    user_id: string;
    email: string | null;
    display_name: string;
    is_guest: boolean;
  }>(
    db,
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name, u.is_guest
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND s.last_seen_at > now() - ($2 || ' days')::interval
        AND u.disabled_at IS NULL`,
    [hashToken(token), String(SESSION_IDLE_DAYS)],
  );

  if (!row) return null;

  // Touch last_seen_at, but not on every request: a write per request turns
  // every page load into a database write for no benefit.
  await db.query(
    `UPDATE sessions SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [row.session_id],
  );

  return {
    sessionId: row.session_id,
    user: {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      isGuest: row.is_guest,
    },
  };
}

export async function revokeSession(db: Pool | PoolClient, sessionId: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

/** Revoke every session for a user. Used on password change. */
export async function revokeAllSessions(
  db: Pool | PoolClient,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const result = await db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptSessionId ?? null],
  );
  return result.rowCount ?? 0;
}

export interface ActiveSession {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  isCurrent: boolean;
}

/** Sessions list for the account settings screen. */
export async function listSessions(
  db: Pool | PoolClient,
  userId: string,
  currentSessionId: string,
): Promise<ActiveSession[]> {
  const rows = await queryRows<{
    id: string;
    user_agent: string | null;
    created_at: Date;
    last_seen_at: Date;
  }>(
    db,
    `SELECT id, user_agent, created_at, last_seen_at
       FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_seen_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    isCurrent: r.id === currentSessionId,
  }));
}

/**
 * Change a password and invalidate other sessions.
 *
 * Revoking siblings is the point: a password change after a suspected
 * compromise is worthless if the attacker's session survives it.
 */
export async function changePassword(
  pool: Pool,
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<void> {
  const user = await queryOne<{ password_hash: string | null }>(
    pool,
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId],
  );
  if (!user?.password_hash) throw new AuthError('user not found', 'not_found');

  const { valid } = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) throw new AuthError('current password is incorrect', 'invalid_credentials');

  const hash = await hashPassword(newPassword);

  await withTransaction(pool, async (client) => {
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
    await revokeAllSessions(client, userId, keepSessionId);
  });
}

/** Delete expired sessions and stale rate-limit rows. Run by the maintenance job. */
export async function pruneAuthTables(db: Pool): Promise<{ sessions: number; attempts: number }> {
  const sessions = await db.query(
    `DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`,
  );
  const attempts = await db.query(
    `DELETE FROM auth_attempts WHERE attempted_at < now() - interval '24 hours'`,
  );
  return {
    sessions: sessions.rowCount ?? 0,
    attempts: attempts.rowCount ?? 0,
  };
}
