/**
 * Enrolling, proving and removing a second factor (ADR-0063).
 *
 * The rules that are not arithmetic: an enrolment that has not been proved does
 * not count, a code cannot be used twice, and a recovery code gets somebody in
 * without disarming the account.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import {
  checkSecondFactor,
  confirmEnrolment,
  hasSecondFactor,
  recoveryCodesLeft,
  removeSecondFactor,
  startEnrolment,
} from '../src/auth/secondFactor.js';
import { STEP_SECONDS, codeAt, fromBase32 } from '../src/auth/totp.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';

const SECRET_KEY = 'an-instance-secret-key-long-enough-to-be-one';

describe(
  'second factor',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let person: string;

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ('zwei@example.org', 'Zwei')
         RETURNING id::text AS id`,
      );
      person = rows[0]!.id;
    });

    after(async () => {
      await closeTestPool();
    });

    const now = (): number => Math.floor(Date.now() / 1000 / STEP_SECONDS);

    async function enrol(): Promise<{ secret: Uint8Array; codes: string[] }> {
      /*
       * From nothing each time.
       *
       * These tests share one account and run in order, and `startEnrolment`
       * correctly refuses while a confirmed factor exists — so without this,
       * every test after the first got null and failed for a reason that was
       * the code being right.
       */
      await removeSecondFactor(db, person);
      const started = await startEnrolment(db, person, 'zwei@example.org', 'SONE', SECRET_KEY);
      assert.ok(started);
      const secret = fromBase32(started.secret);

      const client = await db.connect();
      try {
        const done = await confirmEnrolment(client, person, codeAt(secret, now()), SECRET_KEY);
        assert.ok(done.ok);
        return { secret, codes: done.recoveryCodes };
      } finally {
        client.release();
      }
    }

    test('an unproved enrolment does not count', async () => {
      /*
       * The decision this exists for: a secret that was mis-scanned, or scanned
       * onto a phone with a wrong clock, must not lock somebody out of their own
       * account. It is real only once a code has been proved against it
       * (ADR-0063).
       */
      const started = await startEnrolment(db, person, 'zwei@example.org', 'SONE', SECRET_KEY);
      assert.ok(started);
      assert.match(started.uri, /^otpauth:\/\/totp\//);
      assert.equal(await hasSecondFactor(db, person), false, 'not yet');

      // And a wrong code leaves it not counting, rather than half-on.
      const client = await db.connect();
      try {
        const wrong = await confirmEnrolment(client, person, '000000', SECRET_KEY);
        assert.deepEqual(wrong, { ok: false, reason: 'wrong_code' });
      } finally {
        client.release();
      }
      assert.equal(await hasSecondFactor(db, person), false, 'still not');
    });

    test('proving a code turns it on and hands over ten recovery codes', async () => {
      const { codes } = await enrol();
      assert.equal(await hasSecondFactor(db, person), true);
      assert.equal(codes.length, 10);
      assert.equal(await recoveryCodesLeft(db, person), 10);
    });

    test('a code cannot be used twice inside its window', async () => {
      // Somebody who read it over a shoulder, or off a screen share, has thirty
      // seconds — and gets nothing.
      const { secret } = await enrol();
      /*
       * The *next* step, not this one.
       *
       * My first version signed in with the same code it enrolled with, and got
       * `replayed` on the first attempt — which is the feature working: the
       * confirmation spends that step too. Worth its own assertion below rather
       * than a footnote, because "the code you just enrolled with does not also
       * sign you in" is a thing somebody will meet.
       */
      const code = codeAt(secret, now() + 1);

      const first = await db.connect();
      try {
        assert.deepEqual(await checkSecondFactor(first, person, code, SECRET_KEY), {
          ok: true,
          usedRecovery: false,
        });
      } finally {
        first.release();
      }

      const second = await db.connect();
      try {
        assert.deepEqual(await checkSecondFactor(second, person, code, SECRET_KEY), {
          ok: false,
          reason: 'replayed',
        });
      } finally {
        second.release();
      }
    });

    test('the code used to enrol cannot then sign somebody in', async () => {
      // The confirmation spends its step, like any other use.
      const { secret } = await enrol();
      const client = await db.connect();
      try {
        const same = await checkSecondFactor(client, person, codeAt(secret, now()), SECRET_KEY);
        assert.deepEqual(same, { ok: false, reason: 'replayed' });
      } finally {
        client.release();
      }
    });

    test('a recovery code gets somebody in without disarming the account', async () => {
      /*
       * Losing a phone must not remove the factor: that would be a second
       * factor that a lost device turns off. It gets them in so they can enrol
       * the new one.
       */
      const { codes } = await enrol();
      const client = await db.connect();
      try {
        const used = await checkSecondFactor(client, person, codes[0]!, SECRET_KEY);
        assert.deepEqual(used, { ok: true, usedRecovery: true });
      } finally {
        client.release();
      }

      assert.equal(await hasSecondFactor(db, person), true, 'still armed');
      assert.equal(await recoveryCodesLeft(db, person), 9, 'and one is spent');

      // The same code again is nothing.
      const again = await db.connect();
      try {
        const twice = await checkSecondFactor(again, person, codes[0]!, SECRET_KEY);
        assert.deepEqual(twice, { ok: false, reason: 'wrong_code' });
      } finally {
        again.release();
      }
    });

    test('enrolling again is refused while one is confirmed', async () => {
      // The one thing this must never do silently: replacing a live secret
      // would disarm the account for anybody holding a session.
      await enrol();
      assert.equal(
        await startEnrolment(db, person, 'zwei@example.org', 'SONE', SECRET_KEY),
        null,
      );
    });

    test('removing takes the recovery codes with it', async () => {
      await enrol();
      await removeSecondFactor(db, person);
      assert.equal(await hasSecondFactor(db, person), false);
      assert.equal(await recoveryCodesLeft(db, person), 0, 'no codes outlive the factor');
    });
  },
);
