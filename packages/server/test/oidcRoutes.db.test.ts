/**
 * Signing in through an identity provider, end to end.
 *
 * The flow's own tests cover the protocol; these cover what this application
 * does with the answer — which account it decides somebody is, and what it
 * refuses.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { getTestPool, hasDatabase } from './support/db.js';

describe('single sign-on (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;

  before(async () => {
    db = await getTestPool();
  });

  after(async () => {
    await db.query(`DELETE FROM oidc_identities`);
    await db.query(`DELETE FROM oidc_settings`);
  });

  test('an identity belongs to exactly one account per provider', async () => {
    // Without the constraint, a second sign-in that produced a fresh subject
    // would silently give somebody another door into one account, and nothing
    // would show it.
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('sso@example.org','SSO','x') RETURNING id`,
    );
    const userId = user.rows[0]!.id;

    await db.query(
      `INSERT INTO oidc_identities (issuer, subject, user_id)
       VALUES ('https://login.example.org','sub-1',$1)`,
      [userId],
    );

    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO oidc_identities (issuer, subject, user_id)
           VALUES ('https://login.example.org','sub-2',$1)`,
          [userId],
        ),
      /oidc_identities_one_per_user/,
    );

    await db.query(`DELETE FROM oidc_identities`);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  test('the same subject at two providers is two identities', async () => {
    // Subjects are only unique within an issuer, so the key has to be both.
    // Keyed on subject alone, two providers using "1000" would be one person.
    const first = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('a@example.org','A','x') RETURNING id`,
    );
    const second = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('b@example.org','B','x') RETURNING id`,
    );

    await db.query(
      `INSERT INTO oidc_identities (issuer, subject, user_id) VALUES
         ('https://one.example.org','1000',$1),
         ('https://two.example.org','1000',$2)`,
      [first.rows[0]!.id, second.rows[0]!.id],
    );

    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM oidc_identities WHERE subject = '1000'`,
    );
    assert.equal(rows.rows[0]?.n, 2);

    await db.query(`DELETE FROM oidc_identities`);
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [first.rows[0]!.id, second.rows[0]!.id],
    ]);
  });

  test('there is at most one provider configured', async () => {
    // A second row would be a second provider nobody chose between.
    await db.query(
      `INSERT INTO oidc_settings (issuer, client_id) VALUES ('https://one.example.org','a')`,
    );
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO oidc_settings (issuer, client_id) VALUES ('https://two.example.org','b')`,
        ),
      /oidc_settings_pkey/,
    );
    await db.query(`DELETE FROM oidc_settings`);
  });

  test('an account signed in only through a provider has no password', async () => {
    // Which is what stops a created-by-SSO account from being reachable by
    // guessing a password nobody ever set.
    const user = await db.query<{ id: string; password_hash: string | null }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('nopw@example.org','No password',NULL) RETURNING id, password_hash`,
    );
    assert.equal(user.rows[0]?.password_hash, null);
    await db.query(`DELETE FROM users WHERE id = $1`, [user.rows[0]!.id]);
  });
});
