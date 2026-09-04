/**
 * SONE server — whether the instance is still waiting for somebody's second
 * factor (ADR-0065).
 *
 * One function, called on every authenticated request, so it takes facts the
 * caller already has rather than going looking. The three questions ADR-0063
 * said were the actual feature are all answered here:
 *
 * - **Who is exempt**: an account with no password of its own, because it
 *   authenticates at a provider that has its own second factor. Requiring TOTP
 *   there would be a second factor on top of somebody else's first one.
 * - **How long**: fourteen days from the moment it was switched on.
 * - **What then**: everything except enrolment is refused, reading included.
 */

import { queryOne } from '../db/pool.js';
import type { Pool, PoolClient } from 'pg';

/** How long somebody has after the requirement appears. */
export const GRACE_DAYS = 14;

/** When the last warning goes out, before the deadline. */
export const WARN_DAYS_BEFORE = 3;

export interface RequirementState {
  required: boolean;
  /** ISO timestamp, or empty when it has never been switched on. */
  since: string;
}

export interface AccountFacts {
  hasSecondFactor: boolean;
  /** False for a single sign-on account, which is exempt (ADR-0065). */
  hasPassword: boolean;
}

export type Standing =
  /** Nothing is being asked of this account. */
  | { kind: 'fine' }
  /** Asked, with time left. Everything still works. */
  | { kind: 'grace'; deadline: Date }
  /** Time is up: enrolment is the only reachable screen. */
  | { kind: 'blocked' };

/**
 * Where an account stands.
 *
 * A missing or unparseable `since` is treated as **now** rather than as long
 * ago: a broken timestamp must not lock an instance out, and the worst this
 * costs is fourteen more days of grace.
 */
export function standingOf(
  requirement: RequirementState,
  account: AccountFacts,
  now: Date = new Date(),
): Standing {
  if (!requirement.required) return { kind: 'fine' };
  if (account.hasSecondFactor) return { kind: 'fine' };

  // The exemption, and the whole reason it exists: this account's first factor
  // is somebody else's business.
  if (!account.hasPassword) return { kind: 'fine' };

  const since = Date.parse(requirement.since);
  const from = Number.isFinite(since) ? since : now.getTime();
  const deadline = new Date(from + GRACE_DAYS * 86_400_000);

  return now.getTime() < deadline.getTime() ? { kind: 'grace', deadline } : { kind: 'blocked' };
}

/**
 * The paths that stay reachable when an account is blocked.
 *
 * Enrolment, signing out, and the session lookup the interface needs to know
 * what to draw. Everything else — including reading — is refused: the point of
 * a second factor is that a stolen password grants nothing, and a stolen
 * password with read access to a company's notes has granted the thing that
 * mattered.
 *
 * Listed by prefix and by name rather than by pattern, so adding to it is a
 * decision somebody makes on purpose.
 */
const ALLOWED_WHILE_BLOCKED = [
  '/api/auth/second-factor/start',
  '/api/auth/second-factor/confirm',
  '/api/auth/session',
  '/api/auth/logout',
  '/api/instance',
];

export const reachableWhileBlocked = (path: string): boolean =>
  ALLOWED_WHILE_BLOCKED.includes(path);

/**
 * The two facts the rule needs, from one query.
 *
 * Here rather than at each caller because there were two callers with the same
 * query 39 lines apart — the gate and the session's standing — which is a
 * second answer to one question waiting to drift. Whether an account is exempt
 * is a decision this module owns, and so is the SQL that establishes it.
 */
export async function factsFor(
  db: Pool | PoolClient,
  userId: string,
): Promise<AccountFacts | null> {
  const row = await queryOne<{ has_password: boolean; has_factor: boolean }>(
    db,
    `SELECT u.password_hash IS NOT NULL AS has_password,
            EXISTS (
              SELECT 1 FROM second_factors f
               WHERE f.user_id = u.id AND f.confirmed_at IS NOT NULL
            ) AS has_factor
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!row) return null;
  return { hasSecondFactor: row.has_factor, hasPassword: row.has_password };
}
