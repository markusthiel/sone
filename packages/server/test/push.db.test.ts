/**
 * Waking a device that is not looking (ADR-0180).
 *
 * The parts worth a database: the keypair is made once and never twice, a
 * subscription belongs to one device, and what a push service answers decides
 * whether a row survives.
 *
 * The last of those is the one with teeth. A push service answers 410 for a
 * subscription that is gone and 500 for an afternoon it is having, and treating
 * the second like the first switches somebody's notifications off without
 * telling them.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { pushKeys, wake } from '../src/push/send.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase, seedWorkspace, type Fixture } from './support/db.js';

describe(
  'notifications on a device (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;

    before(async () => {
      db = await getTestPool();
    });
    after(async () => {
      await closeTestPool();
    });
    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);
    });

    const subscribe = async (endpoint: string, userId = fx.userId): Promise<void> => {
      await db.query(
        `INSERT INTO push_subscriptions (endpoint, user_id) VALUES ($1, $2)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id`,
        [endpoint, userId],
      );
    };

    const answering = (status: number): typeof fetch =>
      (async () => new Response(null, { status })) as unknown as typeof fetch;

    test('the keypair is made once and kept', async () => {
      /*
       * A key that changes invalidates every subscription ever made against it,
       * which looks to everybody like notifications silently stopping. So two
       * asks are one key, including the two a pair of workers make at once.
       */
      const first = await pushKeys(db);
      const second = await pushKeys(db);
      assert.equal(first.publicKey, second.publicKey);

      const both = await Promise.all([pushKeys(db), pushKeys(db)]);
      assert.equal(both[0].publicKey, both[1].publicKey);
      assert.equal(both[0].publicKey, first.publicKey);
    });

    test('and there is only ever one row to hold it', async () => {
      await pushKeys(db);
      const count = await db.query(`SELECT count(*)::int AS n FROM push_identity`);
      assert.equal(count.rows[0].n, 1);
    });

    test('a wake goes to every device this person switched on', async () => {
      await subscribe('https://push.example/a');
      await subscribe('https://push.example/b');
      const result = await wake(db, [fx.userId], 'https://sone.example', answering(201));
      assert.deepEqual(result, { sent: 2, gone: 0, failed: 0 });
    });

    test('and to nobody else', async () => {
      const other = await seedWorkspace(db, 'Elsewhere');
      await subscribe('https://push.example/mine');
      await subscribe('https://push.example/theirs', other.userId);
      const result = await wake(db, [fx.userId], 'https://sone.example', answering(201));
      assert.equal(result.sent, 1);
    });

    test('an endpoint the service says is gone is deleted', async () => {
      await subscribe('https://push.example/stale');
      const result = await wake(db, [fx.userId], 'https://sone.example', answering(410));
      assert.equal(result.gone, 1);
      const left = await db.query(`SELECT count(*)::int AS n FROM push_subscriptions`);
      assert.equal(left.rows[0].n, 0);
    });

    test('but an endpoint having a bad afternoon is kept', async () => {
      /*
       * The distinction that matters. Deleting on a 500 would switch somebody's
       * notifications off because a push service was briefly unwell — and they
       * would find out by never being told anything again.
       */
      await subscribe('https://push.example/fine');
      const result = await wake(db, [fx.userId], 'https://sone.example', answering(500));
      assert.deepEqual(result, { sent: 0, gone: 0, failed: 1 });
      const left = await db.query(`SELECT count(*)::int AS n, max(failures) AS f FROM push_subscriptions`);
      assert.equal(left.rows[0].n, 1);
      assert.equal(Number(left.rows[0].f), 1);
    });

    test('and neither is one that could not be reached at all', async () => {
      await subscribe('https://push.example/offline');
      const refuses = (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;
      const result = await wake(db, [fx.userId], 'https://sone.example', refuses);
      assert.equal(result.failed, 1);
      const left = await db.query(`SELECT count(*)::int AS n FROM push_subscriptions`);
      assert.equal(left.rows[0].n, 1);
    });

    test('a run that works clears the count it had built up', async () => {
      await subscribe('https://push.example/back');
      await wake(db, [fx.userId], 'https://sone.example', answering(500));
      await wake(db, [fx.userId], 'https://sone.example', answering(201));
      const row = await db.query(
        `SELECT failures, last_ok_at FROM push_subscriptions WHERE endpoint = $1`,
        ['https://push.example/back'],
      );
      assert.equal(row.rows[0].failures, 0);
      assert.notEqual(row.rows[0].last_ok_at, null);
    });

    test('one device failing does not clear the other, and vice versa', async () => {
      /*
       * A phone that answered and a laptop that did not, in one run.
       *
       * This is the test the others could not have caught: they answer one
       * status for every endpoint, so an outcome written by *person* rather
       * than by row agrees with all of them. Written that way, the laptop's
       * failure count was cleared because the phone was fine — and a count
       * that never climbs is a count nothing can ever be decided on.
       */
      await subscribe('https://push.example/phone');
      await subscribe('https://push.example/laptop');
      const mixed = (async (url: string) =>
        new Response(null, {
          status: url.endsWith('/phone') ? 201 : 500,
        })) as unknown as typeof fetch;

      const result = await wake(db, [fx.userId], 'https://sone.example', mixed);
      assert.deepEqual(result, { sent: 1, gone: 0, failed: 1 });

      const rows = await db.query<{ endpoint: string; failures: number; last_ok_at: Date | null }>(
        `SELECT endpoint, failures, last_ok_at FROM push_subscriptions ORDER BY endpoint`,
      );
      const by = new Map(rows.rows.map((row) => [row.endpoint, row]));
      const laptop = by.get('https://push.example/laptop');
      const phone = by.get('https://push.example/phone');
      assert.equal(laptop?.failures, 1, 'the one that failed counted it');
      assert.equal(laptop?.last_ok_at, null);
      assert.equal(phone?.failures, 0);
      assert.notEqual(phone?.last_ok_at, null);
    });

    test('nobody to wake sends nothing and asks nothing', async () => {
      // Including the keypair: an instance where nobody switched this on never
      // generates one, and a `wake` with an empty list must not be what does.
      const result = await wake(db, [], 'https://sone.example', answering(201));
      assert.deepEqual(result, { sent: 0, gone: 0, failed: 0 });
      const keys = await db.query(`SELECT count(*)::int AS n FROM push_identity`);
      assert.equal(keys.rows[0].n, 0);
    });

    test('a device that changes hands belongs to whoever is at it now', async () => {
      /*
       * The same browser, a second person signed in. One endpoint is one row,
       * so it moves rather than multiplying — two rows would be two pushes, and
       * the wrong one would be to somebody who has signed out.
       */
      const other = await seedWorkspace(db, 'Second person');
      await subscribe('https://push.example/shared');
      await subscribe('https://push.example/shared', other.userId);

      const mine = await wake(db, [fx.userId], 'https://sone.example', answering(201));
      assert.equal(mine.sent, 0, 'no longer theirs');
      const theirs = await wake(db, [other.userId], 'https://sone.example', answering(201));
      assert.equal(theirs.sent, 1);
    });

    test('the push carries no body at all', async () => {
      /*
       * The decision the whole design rests on: nothing about a page, a comment
       * or a person passes through Apple's or Google's push service, because
       * there is nothing in the request to pass.
       */
      await subscribe('https://push.example/silent');
      let seen: RequestInit | undefined;
      const watching = (async (_url: string, init?: RequestInit) => {
        seen = init;
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch;

      await wake(db, [fx.userId], 'https://sone.example', watching);
      assert.equal(seen?.body, undefined);
      const headers = seen?.headers as Record<string, string>;
      assert.match(headers['Authorization'] ?? '', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    });

    test('a wake will not follow a redirect and carries a timeout (ADR-0187)', async () => {
      // A push endpoint is a URL the subscriber chose: the server must not chase
      // a 3xx to wherever it points, and must not hang on one that never
      // answers.
      await subscribe('https://push.example/redirecting');
      let seen: RequestInit | undefined;
      const watching = (async (_url: string, init?: RequestInit) => {
        seen = init;
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch;

      await wake(db, [fx.userId], 'https://sone.example', watching);
      assert.equal(seen?.redirect, 'error', 'a redirect is refused, not followed');
      assert.ok(seen?.signal instanceof AbortSignal, 'and the request can time out');
    });

    test('a slow endpoint does not hold up the others (ADR-0187)', async () => {
      // One endpoint that never answers must not stall the whole fan-out: the
      // timeout aborts it and the rest are counted.
      await subscribe('https://push.example/fast');
      await subscribe('https://push.example/hangs');
      const mixed = (async (url: string, init?: RequestInit) => {
        if (url.endsWith('/hangs')) {
          // Reject the moment the wake's own signal fires, as a real abort would.
          return await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch;

      // The wake's own 10s timeout would fire eventually; force it here so the
      // test does not wait, by aborting through a short-lived override is not
      // possible, so instead assert the fan-out resolves with the fast one sent
      // and the hanging one counted as failed once aborted.
      const result = await Promise.race([
        wake(db, [fx.userId], 'https://sone.example', mixed),
        new Promise<never>((_r, reject) =>
          setTimeout(() => reject(new Error('fan-out did not settle')), 15_000),
        ),
      ]);
      assert.equal(result.sent, 1, 'the reachable endpoint was pushed');
      assert.equal(result.failed, 1, 'the hanging one was counted, not awaited forever');
    });
  },
);
