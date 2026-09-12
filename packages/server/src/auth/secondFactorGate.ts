/**
 * SONE — the second-factor gate, as a slot two layers can read.
 *
 * The requirement (ADR-0065) is enforced by a function the server installs at
 * startup, so the check can reach the settings store without half the codebase
 * depending on it. It lived in `http/auth.ts` and was called only by
 * `requireSession` — which is one door of many (ADR-0183). The claims resolver
 * in `auth/claims.ts` is the door every other authenticated path goes through
 * (search, files, comments, export, sync), and it could not call a gate that
 * lived above it without `auth/` importing `http/`.
 *
 * So the slot lives here, below both, and both import it. The installed
 * function is unchanged; only where the reference is kept has moved.
 *
 * The path argument is the request path, used only to let the enrolment,
 * session and logout routes through while an account is blocked
 * (`reachableWhileBlocked`). A caller with no path — the claims resolver — has
 * no such exception to make and passes the empty string, which matches none of
 * them and so is refused like everything else.
 */

import type { Pool, PoolClient } from 'pg';

export type SecondFactorGate = (
  db: Pool | PoolClient,
  userId: string,
  path: string,
) => Promise<string | null>;

let gate: SecondFactorGate | null = null;

export function installSecondFactorGate(fn: SecondFactorGate): void {
  gate = fn;
}

/**
 * The installed gate, or null.
 *
 * Null is the behaviour of an instance that requires nothing — which is what a
 * test that registers routes by hand gets, and what a deployment with the
 * requirement switched off pays for (the installed gate itself returns null
 * fast in that case).
 */
export function secondFactorGate(): SecondFactorGate | null {
  return gate;
}
