/**
 * The key that opens first-run setup.
 *
 * `/api/auth/setup` was unauthenticated and gated on one condition: no
 * workspace exists yet. That condition is correct and it is not enough, because
 * it is true for a window that somebody else can be inside.
 *
 * **The window.** A container starts. The proxy in front of it is already
 * answering on a public name — that is the point of the proxy, and it does not
 * wait for the operator to be ready. Between the first successful start and the
 * moment the operator opens the page, whoever reaches the URL becomes the
 * instance administrator of that deployment, with a personal workspace, and
 * every account created afterwards has no administrative rights (see
 * `registration.ts`). The operator's own attempt then answers "this instance is
 * already set up", and the only way back is a database edit.
 *
 * That is not exotic. It is the ordinary first minute of a self-hosted
 * deployment, and nothing about it looks wrong while it happens.
 *
 * **The second window** is narrower and worse. `count(*) FROM workspaces`
 * becomes zero again if every account is gone, because a personal workspace goes
 * with its account — so an instance that lost its accounts re-opens setup, and
 * the team workspaces still in the database get a new owner who was never
 * invited.
 *
 * So: a random value, printed to the log at startup while setup is still
 * needed, and required by the route. A glance at `docker compose logs` instead
 * of a command with four lines — the screen stays as easy as it was — and both
 * windows close, because reaching the URL first is no longer enough.
 *
 * **The key lives in memory**, not in the database: there it would be a secret
 * in every backup (ADR-0058). It expires on restart and is spent with the first
 * account. Whoever missed it restarts and gets a new one.
 *
 * A single process holds it, which is the shape of a SONE deployment today. Two
 * replicas would each print a different key and only one would work — which is
 * why the database check stays where it is and is checked *first*: the key
 * narrows the window, the database closes it.
 */

import { randomBytes } from 'node:crypto';

import type { Pool } from 'pg';

import { queryOne } from '../db/pool.js';

/** Whether this instance still needs its first workspace. */
export async function needsSetup(pool: Pool): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM workspaces`,
  );
  return Number(row?.n ?? 0) === 0;
}

export class SetupKey {
  private key: string | null = null;

  /**
   * Mint a key, but only while setup is actually needed.
   *
   * Returns `null` on an instance that is already set up — nothing to print,
   * and nothing to guess at.
   */
  async openIfNeeded(pool: Pool): Promise<string | null> {
    if (!(await needsSetup(pool))) {
      this.key = null;
      return null;
    }
    this.key = randomBytes(24).toString('base64url');
    return this.key;
  }

  get open(): boolean {
    return this.key !== null;
  }

  /**
   * Compare in constant time.
   *
   * Not because a 192-bit value is guessable from timing, but because the
   * alternative is a comparison whose duration depends on the secret, and that
   * is a habit rather than a calculation.
   */
  matches(given: string): boolean {
    const mine = this.key;
    if (mine === null || given.length !== mine.length) return false;
    let diff = 0;
    for (let i = 0; i < mine.length; i += 1) {
      diff |= mine.charCodeAt(i) ^ given.charCodeAt(i);
    }
    return diff === 0;
  }

  /** Spent. Called once the first account exists, whoever created it. */
  close(): void {
    this.key = null;
  }
}

/**
 * What the log says while setup is open.
 *
 * A block rather than a line, because a line between migration messages is not
 * something anybody sees. Returned as a string rather than printed, so a test
 * can read it without capturing stdout.
 */
export function setupBanner(key: string): string {
  return [
    '',
    '  ┌─ Setup ──────────────────────────────────────────────────',
    '  │  This instance has no workspace yet. Open SONE and enter',
    '  │  this setup key:',
    '  │',
    `  │      ${key}`,
    '  │',
    '  │  It is good for one account and expires on restart.',
    '  └──────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}
