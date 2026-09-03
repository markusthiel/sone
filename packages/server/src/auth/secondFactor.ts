/**
 * SONE server — enrolling, proving and removing a second factor (ADR-0063).
 *
 * The rules that are not in the arithmetic live here:
 *
 * - Enrolment is **pending** until a code is proved against it. A secret that
 *   was mis-scanned must not lock somebody out of their own account.
 * - A code cannot be used twice inside its window, which is what `last_step`
 *   is for.
 * - A recovery code is single use, and using one does not disarm the factor —
 *   it gets somebody in so they can enrol their new phone.
 * - Removing one needs the password, not just an open session.
 */

import { queryOne, queryRows } from '../db/pool.js';
import {
  checkCode,
  hashRecoveryCode,
  newRecoveryCodes,
  newSecret,
  openSecret,
  otpauthUri,
  sealSecret,
  toBase32,
} from './totp.js';
import type { Pool, PoolClient } from 'pg';

export interface StartedEnrolment {
  /** For the QR code. */
  uri: string;
  /** For somebody typing it into an app by hand. */
  secret: string;
}

/**
 * Begin enrolling, replacing any unconfirmed attempt.
 *
 * Replacing rather than refusing: somebody who closed the page half way through
 * and came back is the ordinary case, and telling them "you already started"
 * with no way to start again would be a dead end.
 *
 * A *confirmed* factor is not replaced — that is the one thing this must not do
 * silently, because it would disarm the account for anybody with a session.
 */
export async function startEnrolment(
  db: Pool,
  userId: string,
  account: string,
  issuer: string,
  secretKey: string,
): Promise<StartedEnrolment | null> {
  const existing = await queryOne<{ confirmed: boolean }>(
    db,
    `SELECT confirmed_at IS NOT NULL AS confirmed FROM second_factors WHERE user_id = $1`,
    [userId],
  );
  if (existing?.confirmed) return null;

  const secret = newSecret();
  await db.query(
    `INSERT INTO second_factors (user_id, secret, confirmed_at, last_step)
     VALUES ($1, $2, NULL, NULL)
     ON CONFLICT (user_id) DO UPDATE
        SET secret = excluded.secret, created_at = now(),
            confirmed_at = NULL, last_step = NULL`,
    [userId, sealSecret(secret, secretKey)],
  );

  return {
    uri: otpauthUri(secret, account, issuer),
    secret: toBase32(secret),
  };
}

/**
 * Finish enrolling by proving a code, and hand back the recovery codes.
 *
 * The codes are returned once, here, and never again: they are stored hashed,
 * so the server cannot show them a second time even if somebody asks.
 */
export async function confirmEnrolment(
  db: PoolClient,
  userId: string,
  code: string,
  secretKey: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: 'no_enrolment' | 'wrong_code' }> {
  const row = await queryOne<{ secret: string; confirmed: boolean }>(
    db,
    `SELECT secret, confirmed_at IS NOT NULL AS confirmed
       FROM second_factors WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  if (!row || row.confirmed) return { ok: false, reason: 'no_enrolment' };

  const secret = openSecret(row.secret, secretKey);
  if (!secret) return { ok: false, reason: 'no_enrolment' };

  const found = checkCode(secret, code);
  if (!found.ok) return { ok: false, reason: 'wrong_code' };

  const { codes, hashes } = newRecoveryCodes();
  await db.query(
    `UPDATE second_factors SET confirmed_at = now(), last_step = $2 WHERE user_id = $1`,
    [userId, found.step],
  );
  // Any codes from a previous life of this account go: a set where some belong
  // to an old secret is a set nobody can reason about.
  await db.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
  for (const hash of hashes) {
    await db.query(`INSERT INTO recovery_codes (code_hash, user_id) VALUES ($1, $2)`, [
      hash,
      userId,
    ]);
  }

  return { ok: true, recoveryCodes: codes };
}

export type SecondFactorCheck =
  | { ok: true; usedRecovery: boolean }
  | { ok: false; reason: 'wrong_code' | 'replayed' };

/**
 * Check a code at sign-in, accepting a recovery code instead.
 *
 * A recovery code does **not** turn the factor off. It gets somebody in so they
 * can enrol their new phone — disarming the account because somebody lost a
 * device would be a second factor that a lost device removes.
 */
export async function checkSecondFactor(
  db: PoolClient,
  userId: string,
  code: string,
  secretKey: string,
): Promise<SecondFactorCheck> {
  const row = await queryOne<{ secret: string; last_step: string | null }>(
    db,
    `SELECT secret, last_step FROM second_factors
      WHERE user_id = $1 AND confirmed_at IS NOT NULL
      FOR UPDATE`,
    [userId],
  );
  if (!row) return { ok: false, reason: 'wrong_code' };

  const secret = openSecret(row.secret, secretKey);
  if (secret) {
    const found = checkCode(secret, code);
    if (found.ok) {
      /*
       * The same step twice is refused.
       *
       * A code is good for thirty seconds, and somebody who read it over a
       * shoulder — or off a screen share — has that long to use it too. Once
       * accepted it is spent.
       */
      if (row.last_step !== null && Number(row.last_step) >= found.step) {
        return { ok: false, reason: 'replayed' };
      }
      await db.query(`UPDATE second_factors SET last_step = $2 WHERE user_id = $1`, [
        userId,
        found.step,
      ]);
      return { ok: true, usedRecovery: false };
    }
  }

  // A recovery code, spent on use.
  const spent = await db.query(
    `UPDATE recovery_codes SET used_at = now()
      WHERE code_hash = $1 AND user_id = $2 AND used_at IS NULL`,
    [hashRecoveryCode(code), userId],
  );
  // `usedRecovery` so the caller can tell somebody how many codes are left —
  // a person who has just used their ninth should hear about it.
  if (spent.rowCount === 1) return { ok: true, usedRecovery: true };

  return { ok: false, reason: 'wrong_code' };
}

/** Whether this account has a confirmed factor, which sign-in has to know. */
export async function hasSecondFactor(db: Pool | PoolClient, userId: string): Promise<boolean> {
  const row = await queryOne<{ present: boolean }>(
    db,
    `SELECT true AS present FROM second_factors
      WHERE user_id = $1 AND confirmed_at IS NOT NULL`,
    [userId],
  );
  return row?.present === true;
}

/** How many recovery codes are left, which the settings screen shows. */
export async function recoveryCodesLeft(db: Pool, userId: string): Promise<number> {
  const rows = await queryRows<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM recovery_codes
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Remove it, taking the recovery codes with it.
 *
 * The caller checks the password first (ADR-0063): an open laptop must not be
 * enough. An administrator removing somebody else's is the other caller, and is
 * the only way back for somebody who has lost both their phone and their codes.
 */
export async function removeSecondFactor(db: Pool | PoolClient, userId: string): Promise<void> {
  await db.query(`DELETE FROM second_factors WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
}
