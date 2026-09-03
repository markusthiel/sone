/**
 * Resetting a forgotten password (ADR-0059).
 *
 * The tests are about the refusals, because that is where every decision in the
 * record lives: what the server declines to tell somebody, and what it declines
 * to burn.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import { hashPassword } from '../src/auth/password.js';
import { issueReset, redeemReset } from '../src/auth/reset.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';

describe(
  'password reset',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);
    });

    after(async () => {
      await closeTestPool();
    });

    async function person(email: string, withPassword = true): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1, 'Wer', $2) RETURNING id::text AS id`,
        [email, withPassword ? await hashPassword('ein gutes Passwort') : null],
      );
      return rows[0]!.id;
    }

    test('an address with no account yields nothing, and says nothing', async () => {
      // The caller answers the same either way; this is the half that has to be
      // silent. An honest "no such account" turns a list of addresses into a
      // list of this instance's members.
      assert.equal(await issueReset(db, 'niemand@example.org'), null);
    });

    test('a single sign-on account yields nothing either', async () => {
      // No password hash means signing in happens at the provider, and a reset
      // mail would be a mail that cannot help.
      await person('sso@example.org', false);
      assert.equal(await issueReset(db, 'sso@example.org'), null);
    });

    test('the token is never stored, only its hash', async () => {
      const userId = await person('reset@example.org');
      const issued = await issueReset(db, 'reset@example.org');
      assert.ok(issued);

      const { rows } = await db.query<{ token_hash: string; user_id: string }>(
        `SELECT token_hash, user_id::text AS user_id FROM password_reset_tokens`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.user_id, userId);
      // A stolen backup must contain no working links.
      assert.notEqual(rows[0]?.token_hash, issued.token);
      assert.doesNotMatch(rows[0]?.token_hash ?? '', /[^0-9a-f]/, 'a hex digest');
    });

    test('a rejected password does not burn the link', async () => {
      // The decision this test exists for: somebody who mistypes a new password
      // must not have to go back to their mail.
      await person('mistype@example.org');
      const issued = await issueReset(db, 'mistype@example.org');
      assert.ok(issued);

      const client = await db.connect();
      try {
        const tooShort = await redeemReset(client, issued.token, 'kurz');
        assert.deepEqual(tooShort, { ok: false, reason: 'weak_password' });

        // And the same link still works.
        const second = await redeemReset(client, issued.token, 'ein anderes gutes Passwort');
        assert.equal(second.ok, true);
      } finally {
        client.release();
      }
    });

    test('a link works once', async () => {
      await person('once@example.org');
      const issued = await issueReset(db, 'once@example.org');
      assert.ok(issued);

      const client = await db.connect();
      try {
        assert.equal((await redeemReset(client, issued.token, 'erstes gutes Passwort')).ok, true);
        const again = await redeemReset(client, issued.token, 'zweites gutes Passwort');
        assert.deepEqual(again, { ok: false, reason: 'unknown_link' });
      } finally {
        client.release();
      }
    });

    test('an expired link is refused, and says which kind of no it is', async () => {
      // Distinguished from an unknown link on purpose: somebody who waited a
      // day should be told to ask again rather than doubt they clicked the
      // right thing.
      const userId = await person('slow@example.org');
      const issued = await issueReset(db, 'slow@example.org');
      assert.ok(issued);
      await db.query(
        `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'
          WHERE user_id = $1`,
        [userId],
      );

      const client = await db.connect();
      try {
        const late = await redeemReset(client, issued.token, 'ein gutes Passwort hier');
        assert.deepEqual(late, { ok: false, reason: 'expired_link' });
      } finally {
        client.release();
      }
    });

    test('a reset signs out everywhere else, and voids other links', async () => {
      // Somebody resetting either forgot the password or fears somebody has it,
      // and in the second case leaving the intruder signed in makes the reset
      // theatre.
      const userId = await person('compromised@example.org');
      await db.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, '\\x00'::bytea, now() + interval '1 day')`,
        [userId],
      );
      const first = await issueReset(db, 'compromised@example.org');
      const second = await issueReset(db, 'compromised@example.org');
      assert.ok(first && second);

      const client = await db.connect();
      try {
        assert.equal((await redeemReset(client, second.token, 'ein gutes neues Passwort')).ok, true);
      } finally {
        client.release();
      }

      const sessions = await db.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [userId]);
      assert.equal(sessions.rowCount, 0, 'no session survives');

      const client2 = await db.connect();
      try {
        // The other link in the inbox is void too: two keys, one used, is one
        // key too many.
        const stale = await redeemReset(client2, first.token, 'noch ein gutes Passwort');
        assert.deepEqual(stale, { ok: false, reason: 'unknown_link' });
      } finally {
        client2.release();
      }
    });
  },
);
