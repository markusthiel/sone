/**
 * SONE server — a link that lets somebody set a new password (ADR-0059).
 *
 * The rules that matter are all about what this refuses to tell anybody:
 *
 * - Requesting is the same answer whether the address exists. An honest "no
 *   such account" turns a list of email addresses into a list of members of
 *   this instance, which for a self-hosted wiki can be a list of who works
 *   somewhere.
 * - The token is stored hashed, so a stolen backup holds no working links.
 * - Redeeming consumes it on **success only**: a rejected new password must not
 *   burn the link, or somebody who mistypes starts again from the mail.
 * - And a successful reset revokes every other session, because somebody
 *   resetting either forgot the password or fears somebody has it — and in the
 *   second case leaving the intruder signed in makes the reset theatre.
 */

import { queryOne } from '../db/pool.js';
/*
 * The token primitives that already exist, rather than new ones.
 *
 * I wrote a `hashToken` here — plain SHA-256, with the same reasoning about
 * why a KDF would be pointless for a random token — and `password.ts` has had
 * exactly that, plus `generateToken` and `tokensMatch`, all along. Two answers
 * to one question is the thing I keep taking out of this codebase; writing a
 * third would have been worse for having been explained well.
 */
import {
  AuthError,
  assertPasswordAcceptable,
  generateToken,
  hashPassword,
  hashToken,
  tokensMatch,
} from './password.js';
import type { Pool, PoolClient } from 'pg';

/** How long a link works. Short, because the window is the whole risk. */
export const RESET_MINUTES = 60;

/** The stored form: hex, because the column is text and a lookup is a string. */
const stored = (token: string): string => hashToken(token).toString('hex');

export interface IssuedReset {
  /** The token, which exists here and in the mail and nowhere else. */
  token: string;
  email: string;
  expiresAt: Date;
}

/**
 * Make a link for an address, or nothing at all — and say nothing either way.
 *
 * Returns null when there is no account, when it is deactivated, and when it has
 * no password to reset (a single sign-on account). The caller answers the same
 * in every case, which is the point.
 */
export async function issueReset(db: Pool, email: string): Promise<IssuedReset | null> {
  const account = await queryOne<{ id: string; email: string }>(
    db,
    `SELECT id, email FROM users
      WHERE lower(email) = lower($1)
        AND deactivated_at IS NULL
        -- An account with no password hash signs in through the provider, and a
        -- reset mail would be a mail that cannot help (ADR-0059).
        AND password_hash IS NOT NULL`,
    [email.trim()],
  );
  if (!account) return null;

  const token = generateToken();
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);

  await db.query(
    `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [stored(token), account.id, expiresAt],
  );

  return { token, email: account.email, expiresAt };
}

export type RedeemResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'unknown_link' | 'expired_link' | 'weak_password' };

/**
 * Set a new password with a token, once.
 *
 * The order is deliberate: the password is checked *before* the token is
 * consumed, so a rejected password leaves the link usable. Everything happens
 * in one transaction, so a failure after the update cannot leave a consumed
 * token beside an unchanged password.
 */
export async function redeemReset(
  db: PoolClient,
  token: string,
  newPassword: string,
): Promise<RedeemResult> {
  const found = await queryOne<{ token_hash: string; user_id: string; expired: boolean }>(
    db,
    `SELECT token_hash, user_id, expires_at < now() AS expired
       FROM password_reset_tokens
      WHERE token_hash = $1 AND used_at IS NULL
      FOR UPDATE`,
    [stored(token)],
  );

  /*
   * Compared in constant time even though it was just looked up by primary key.
   *
   * The lookup already leaks nothing — a hash either matches a row or does not —
   * so this is belt and braces rather than a fix for something. Kept because the
   * alternative is a reader wondering whether it was forgotten.
   */
  if (!found) return { ok: false, reason: 'unknown_link' };
  if (!tokensMatch(Buffer.from(stored(token), 'hex'), Buffer.from(found.token_hash, 'hex'))) {
    return { ok: false, reason: 'unknown_link' };
  }

  if (found.expired) return { ok: false, reason: 'expired_link' };

  // Before consuming anything: a link burnt by a too-short password is a link
  // somebody has to go back to their mail for. The existing policy, which
  // throws — caught here rather than reimplemented, so the sign-up form and
  // this screen cannot disagree about what a password must be.
  try {
    assertPasswordAcceptable(newPassword);
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, reason: 'weak_password' };
    throw err;
  }

  const hash = await hashPassword(newPassword);
  await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [found.user_id, hash]);
  await db.query(`UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1`, [
    found.token_hash,
  ]);

  /*
   * Every session, including any this person is holding elsewhere.
   *
   * Somebody resetting a password either forgot it or fears somebody else has
   * it. In the second case, leaving the other side signed in makes the whole
   * exercise theatre — and they are about to sign in again anyway, which is one
   * password entry against an intruder keeping access indefinitely.
   */
  await db.query(`DELETE FROM sessions WHERE user_id = $1`, [found.user_id]);

  // And the person's other outstanding links: two mails in an inbox, one used,
  // is one key too many.
  await db.query(
    `UPDATE password_reset_tokens SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [found.user_id],
  );

  return { ok: true, userId: found.user_id };
}

/** Drop what has expired. Called from the maintenance sweep. */
export async function forgetExpiredResets(db: Pool): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'`,
  );
  return rowCount ?? 0;
}
