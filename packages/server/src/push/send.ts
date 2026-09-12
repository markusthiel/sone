/**
 * SONE — waking somebody's devices (ADR-0180).
 *
 * ## The push carries nothing
 *
 * The body is empty and the service worker asks this server what happened, over
 * the session the browser already has. So **nothing about a page, a comment or
 * a person passes through Apple's or Google's push service** — they learn that
 * an instance woke a device, which they know anyway because they carried it.
 *
 * It is also much less code: RFC 8291's payload encryption is not implemented
 * at all, only RFC 8292's signature.
 *
 * ## The keypair is made on first use
 *
 * Not an environment variable: a self-hosted upgrade is "pull and restart,
 * nothing else" (ADR-0013), and a feature that needs an operator to generate a
 * keypair before it works is a feature most instances never switch on.
 *
 * Stored in its own table rather than `instance_settings`, whose own comment
 * scopes that to administrator-changeable settings. A private key is not a
 * setting.
 */

import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows } from '../db/pool.js';
import { authorisation, generateKeys, isGone, type PushKeys, type PushJwk } from './vapid.js';

type Db = Pool | PoolClient;

/**
 * This instance's keypair, made if it does not exist yet.
 *
 * `ON CONFLICT DO NOTHING` and then a read: two workers starting at once would
 * otherwise each generate one and the second would overwrite the first — and a
 * key that changes invalidates every subscription ever made against it, which
 * looks to everybody like notifications silently stopping.
 */
export async function pushKeys(db: Db): Promise<PushKeys> {
  const read = async (): Promise<PushKeys | null> => {
    const row = await queryOne<{ public_key: string; private_key: PushJwk }>(
      db,
      `SELECT public_key, private_key FROM push_identity WHERE only_row`,
    );
    return row ? { publicKey: row.public_key, privateKey: row.private_key } : null;
  };

  const existing = await read();
  if (existing) return existing;

  const made = await generateKeys();
  await db.query(
    `INSERT INTO push_identity (public_key, private_key) VALUES ($1, $2)
     ON CONFLICT (only_row) DO NOTHING`,
    [made.publicKey, JSON.stringify(made.privateKey)],
  );
  const settled = await read();
  // The row is there either way now: ours, or the one that won the race.
  return settled ?? made;
}

export interface PushResult {
  sent: number;
  /** Endpoints that are gone for good, and were deleted. */
  gone: number;
  failed: number;
}

/**
 * Wake every device these people have switched on.
 *
 * One request per subscription, in parallel — they are to several different
 * services and a slow one must not hold up the rest. Nothing is retried here:
 * the job that calls this is retried as a whole, and a push is a nudge whose
 * worth expires quickly.
 */
/** How long to wait on a push endpoint before giving up (ADR-0187). */
const PUSH_TIMEOUT_MS = 10_000;

export async function wake(
  db: Db,
  userIds: readonly string[],
  contact: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  if (userIds.length === 0) return { sent: 0, gone: 0, failed: 0 };

  const rows = await queryRows<{ endpoint: string }>(
    db,
    `SELECT endpoint FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
    [[...userIds]],
  );
  if (rows.length === 0) return { sent: 0, gone: 0, failed: 0 };

  const keys = await pushKeys(db);
  /*
   * Three lists of endpoints rather than three counts.
   *
   * One person can have a phone that answered and a laptop that did not, and
   * writing the outcome by *person* would clear the laptop's failure count
   * because the phone was fine. The row that failed is the row that is marked.
   */
  const dead: string[] = [];
  const worked: string[] = [];
  const broke: string[] = [];

  await Promise.all(
    rows.map(async (row) => {
      try {
        const answer = await fetchImpl(row.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await authorisation({ endpoint: row.endpoint, keys, contact }),
            /*
             * Empty, and said out loud. A push service refuses a body-less
             * request that does not declare its length, and `aes128gcm` is what
             * a browser expects to be told even when there is nothing to
             * decrypt.
             */
            'Content-Length': '0',
            'Content-Encoding': 'aes128gcm',
            // Long enough to survive a phone that is asleep, short enough that
            // a notification never arrives about something from yesterday.
            TTL: '3600',
          },
          /*
           * A push endpoint is a URL the subscriber chose (ADR-0187). Two
           * limits on what the server will do with it:
           *
           * - A hard timeout, so one slow or hanging endpoint cannot tie up a
           *   request for undici's 300-second header default while the others
           *   in this `Promise.all` wait on nothing.
           * - No redirects. A push service answers directly; a 3xx would send
           *   this POST somewhere the subscriber did not register, which is the
           *   move an SSRF wants. `error` rejects it instead of following.
           */
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
          redirect: 'error',
        });
        if (answer.ok) {
          worked.push(row.endpoint);
          return;
        }
        if (isGone(answer.status)) {
          dead.push(row.endpoint);
          return;
        }
        broke.push(row.endpoint);
      } catch {
        // A push service that cannot be reached is not a subscription that is
        // gone. Counted, never deleted.
        broke.push(row.endpoint);
      }
    }),
  );

  if (dead.length > 0) {
    await db.query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])`, [dead]);
  }
  if (broke.length > 0) {
    await db.query(
      `UPDATE push_subscriptions SET failures = failures + 1
        WHERE endpoint = ANY($1::text[])`,
      [broke],
    );
  }
  if (worked.length > 0) {
    await db.query(
      `UPDATE push_subscriptions SET last_ok_at = now(), failures = 0
        WHERE endpoint = ANY($1::text[])`,
      [worked],
    );
  }

  return { sent: worked.length, gone: dead.length, failed: broke.length };
}
