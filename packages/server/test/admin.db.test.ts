/**
 * Instance administration.
 *
 * An instance administrator runs the server; a workspace owner runs their
 * workspace. Anyone may create a workspace (ADR-0007), so conflating the two
 * would make everyone an administrator — which is what most of these tests
 * check has not happened.
 *
 * The other half is about not locking an instance out of itself.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAdminRoutes } from '../src/admin/routes.js';
import { SettingsStore, validate } from '../src/admin/settings.js';
import { hashPassword } from '../src/auth/password.js';
import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'administration (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let settings: SettingsStore;
    /** What the storage check reports. Set per test. */
    let storageProblem: string | null = null;

    before(async () => {
      db = await getTestPool();
      settings = new SettingsStore(db, {
        signupMode: 'invite',
        instanceName: 'SONE',
        allowWorkspaceCreation: true,
        defaultLocale: 'en',
      addressForm: 'informal' as const,
      });

      const router = new Router();
      registerAuthRoutes(router, { pool: db, signupMode: () => Promise.resolve('open' as const), secureCookies: false });
      registerAdminRoutes(router, {
        pool: db,
        oidcClientSecret: null,
        settings,
        version: 'test',
        commit: 'abc1234',
        // Reports whatever storageProblem currently holds, so a test can decide
        // what the instance's storage looks like.
        checkStorage: () => Promise.resolve(storageProblem),
      });

      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
      settings.invalidate();
      storageProblem = null;
    });

    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header);
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    /** The bootstrap account, which administers the instance. */
    async function setup(): Promise<{ cookie: string; userId: string }> {
      const res = await fetch(
        `${base}/api/auth/setup`,
        json({
          email: 'admin@example.org',
          password: PASSWORD,
          displayName: 'Admin',
          workspaceName: 'W',
        }),
      );
      const body = await expectJson<{ userId: string }>(res, 201);
      // No promotion needed: setting an instance up makes that account its
      // administrator. This used to UPDATE the row by hand, which hid the fact
      // that a real fresh install had no administrator at all.
      return { cookie: cookieFrom(res), userId: body.userId };
    }

    async function ordinaryUser(
      email: string,
    ): Promise<{ cookie: string; userId: string }> {
      const hash = await hashPassword(PASSWORD);
      const row = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1,'Member',$2) RETURNING id`,
        [email, hash],
      );
      const login = await fetch(`${base}/api/auth/login`, json({ email, password: PASSWORD }));
      return { cookie: cookieFrom(login), userId: row.rows[0]!.id };
    }

    // --- the guard ---------------------------------------------------------

    test('setting up an instance makes that account its administrator', async () => {
      // Migration 0010 promotes whoever created the first workspace, which
      // repairs an existing deployment and does nothing for a new one: on an
      // empty database there is no workspace to look at. Without this, the
      // administration area was invisible to everyone on every fresh install,
      // with no way to appoint anybody except by editing the database.
      const admin = await setup();

      const row = await db.query<{ is_instance_admin: boolean }>(
        `SELECT is_instance_admin FROM users WHERE id = $1`,
        [admin.userId],
      );
      assert.equal(row.rows[0]!.is_instance_admin, true);

      const res = await fetch(`${base}/api/admin/overview`, {
        headers: { cookie: admin.cookie },
      });
      await expectStatus(res, 200);
    });

    test('an account created afterwards is not an administrator', async () => {
      // Only the person who set the instance up, not everybody who signs up.
      await setup();
      const member = await ordinaryUser('later@example.org');
      const row = await db.query<{ is_instance_admin: boolean }>(
        `SELECT is_instance_admin FROM users WHERE id = $1`,
        [member.userId],
      );
      assert.equal(row.rows[0]!.is_instance_admin, false);
    });

    test('an administrator can read the overview', async () => {
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/overview`, {
        headers: { cookie: admin.cookie },
      });
      const body = await expectJson<{ counts: { users: number } }>(res);
      assert.ok(body.counts.users >= 1);
    });

    test('an ordinary account gets 404, not 403', async () => {
      // A probe that gets a different answer for "not allowed" and "not there"
      // is how somebody maps a system.
      await setup();
      const member = await ordinaryUser('member@example.org');

      for (const path of ['overview', 'users', 'workspaces', 'maintenance']) {
        const res = await fetch(`${base}/api/admin/${path}`, {
          headers: { cookie: member.cookie },
        });
        assert.equal(res.status, 404, `/${path} should look absent`);
      }
    });

    test('an anonymous caller is refused', async () => {
      await setup();
      const res = await fetch(`${base}/api/admin/overview`);
      assert.equal(res.status, 401);
    });

    test('a deactivated administrator loses access', async () => {
      const admin = await setup();
      const second = await ordinaryUser('second@example.org');
      await db.query(`UPDATE users SET is_instance_admin = true WHERE id = $1`, [
        second.userId,
      ]);

      await db.query(`UPDATE users SET deactivated_at = now() WHERE id = $1`, [
        admin.userId,
      ]);
      const res = await fetch(`${base}/api/admin/overview`, {
        headers: { cookie: admin.cookie },
      });
      assert.equal(res.status, 404);
    });

    // --- accounts ----------------------------------------------------------

    test('accounts can be promoted and demoted', async () => {
      const admin = await setup();
      const member = await ordinaryUser('member@example.org');

      const promote = await fetch(`${base}/api/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ isInstanceAdmin: true }),
      });
      await expectStatus(promote, 200);

      const res = await fetch(`${base}/api/admin/overview`, {
        headers: { cookie: member.cookie },
      });
      assert.equal(res.status, 200, 'the promoted account administers now');
    });

    test('the last administrator cannot be demoted', async () => {
      // An instance with no administrator has no way back except editing the
      // database by hand, and the person who does it is usually the one who
      // just lost access.
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/users/${admin.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ isInstanceAdmin: false }),
      });
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: 'last_administrator' });
    });

    test('an administrator can step down once another exists', async () => {
      // Demoting yourself is a deliberate handover, and allowed.
      const admin = await setup();
      const second = await ordinaryUser('second@example.org');
      await fetch(`${base}/api/admin/users/${second.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ isInstanceAdmin: true }),
      });

      const res = await fetch(`${base}/api/admin/users/${admin.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ isInstanceAdmin: false }),
      });
      await expectStatus(res, 200);
    });

    test('an administrator cannot deactivate themselves', async () => {
      // Never what was meant, unlike demoting.
      const admin = await setup();
      const second = await ordinaryUser('second@example.org');
      await db.query(`UPDATE users SET is_instance_admin = true WHERE id = $1`, [
        second.userId,
      ]);

      const res = await fetch(`${base}/api/admin/users/${admin.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ deactivated: true }),
      });
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: 'cannot_deactivate_yourself' });
    });

    test('deactivating an account revokes its sessions immediately', async () => {
      // Otherwise a deactivated account keeps working until its cookie expires,
      // which is not what anybody means by deactivating it.
      const admin = await setup();
      const member = await ordinaryUser('member@example.org');

      const before = await db.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [
        member.userId,
      ]);
      assert.ok((before.rowCount ?? 0) > 0, 'the member is signed in');

      await fetch(`${base}/api/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ deactivated: true }),
      });

      const after = await db.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [
        member.userId,
      ]);
      assert.equal(after.rowCount, 0);
    });

    test('deactivation keeps the account rather than deleting it', async () => {
      // Removing it would cascade to every page it created, and "this person
      // has left" is not "their work never happened".
      const admin = await setup();
      const member = await ordinaryUser('member@example.org');

      await fetch(`${base}/api/admin/users/${member.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ deactivated: true }),
      });

      const row = await db.query<{ deactivated_at: Date | null }>(
        `SELECT deactivated_at FROM users WHERE id = $1`,
        [member.userId],
      );
      assert.equal(row.rowCount, 1, 'the account is still there');
      assert.ok(row.rows[0]!.deactivated_at !== null);
    });

    // --- settings ----------------------------------------------------------

    test('a setting can be changed and read back', async () => {
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ signupMode: 'closed' }),
      });
      const body = await expectJson<{
        settings: { signupMode: string };
        settingSources: Record<string, string>;
      }>(res);
      assert.equal(body.settings.signupMode, 'closed');
      assert.equal(body.settingSources['signupMode'], 'database');
    });

    test('clearing a setting falls back to the environment', async () => {
      const admin = await setup();
      const patch = (value: unknown): Promise<Response> =>
        fetch(`${base}/api/admin/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: admin.cookie },
          body: JSON.stringify({ signupMode: value }),
        });

      await patch('closed');
      const body = await expectJson<{
        settings: { signupMode: string };
        settingSources: Record<string, string>;
      }>(await patch(null));

      assert.equal(body.settings.signupMode, 'invite', 'the environment default');
      assert.equal(body.settingSources['signupMode'], 'environment');
    });

    test('an unknown setting is refused rather than stored', async () => {
      // A typo silently stored is a setting somebody believes they changed.
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ signupMdoe: 'closed' }),
      });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: 'unknown_setting' });
    });

    test('an invalid value is refused', async () => {
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ signupMode: 'everyone' }),
      });
      assert.equal(res.status, 422);
    });

    test('an ordinary account cannot change settings', async () => {
      await setup();
      const member = await ordinaryUser('member@example.org');
      const res = await fetch(`${base}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: member.cookie },
        body: JSON.stringify({ signupMode: 'open' }),
      });
      assert.equal(res.status, 404);
    });

    test('a stored value that no longer validates degrades to the default', async () => {
      // A setting whose allowed values changed between releases must not stop
      // the server. The row is left alone so an administrator can see it.
      const admin = await setup();
      await db.query(
        `INSERT INTO instance_settings (key, value) VALUES ('signupMode', '"nonsense"'::jsonb)`,
      );
      settings.invalidate();

      const res = await fetch(`${base}/api/admin/overview`, {
        headers: { cookie: admin.cookie },
      });
      const body = await expectJson<{ settings: { signupMode: string } }>(res);
      assert.equal(body.settings.signupMode, 'invite');

      const still = await db.query(`SELECT 1 FROM instance_settings WHERE key = 'signupMode'`);
      assert.equal(still.rowCount, 1, 'the row is kept so it can be corrected');
    });

    test('validation accepts and rejects by declared type', () => {
      assert.equal(validate('signupMode', 'open'), 'open');
      assert.equal(validate('signupMode', 'nope'), undefined);
      assert.equal(validate('allowWorkspaceCreation', true), true);
      assert.equal(validate('allowWorkspaceCreation', 'true'), undefined);
      assert.equal(validate('instanceName', '  Team wiki '), 'Team wiki');
      assert.equal(validate('instanceName', '   '), undefined);
      assert.equal(validate('instanceName', 'x'.repeat(200)), undefined);
    });

    test('changing the signup setting takes effect without a restart', () => {
      // The point of the whole settings table. This was a value read once at
      // startup: an administrator could change it, see it saved, see the
      // interface report the new value — and registration carried on using
      // whatever the environment said when the container booted. A switch that
      // does nothing is worse than no switch, because it is believed.
      //
      // Asserted through the store rather than through a registration attempt,
      // because the auth routes in this harness are wired to a fixed mode; what
      // matters is that the value the route reads changes when a write happens.
      return (async () => {
        const admin = await setup();

        assert.equal(await settings.get('signupMode'), 'invite', 'the environment default');

        await fetch(`${base}/api/admin/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: admin.cookie },
          body: JSON.stringify({ signupMode: 'closed' }),
        });

        assert.equal(
          await settings.get('signupMode'),
          'closed',
          'a reader asking again gets the new value',
        );
      })();
    });

    // --- what administration does not include ------------------------------

    test('the workspace list reports size but not contents', async () => {
      // An instance administrator can see that a workspace exists and how large
      // it is, and cannot read what is in it.
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/workspaces`, {
        headers: { cookie: admin.cookie },
      });
      const body = await expectJson<{ workspaces: Array<Record<string, unknown>> }>(res);
      assert.ok(body.workspaces.length >= 1);

      const fields = Object.keys(body.workspaces[0]!);
      for (const leaked of ['pages', 'content', 'titles']) {
        assert.ok(!fields.includes(leaked), `${leaked} must not be reported`);
      }
      assert.ok(fields.includes('pageCount'), 'a count is fine');
    });

    test('an unwritable upload directory is reported to the administrator', async () => {
      // It used to be visible only in the container log, which is not where
      // anybody looks when an upload fails — and every upload fails until
      // somebody changes ownership on the host.
      const admin = await setup();
      storageProblem = '/var/lib/sone/files is not writable: EACCES';

      const res = await fetch(`${base}/api/admin/maintenance`, {
        headers: { cookie: admin.cookie },
      });
      const body = await expectJson<{
        storage: { writable: boolean; problem: string | null };
      }>(res);

      assert.equal(body.storage.writable, false);
      assert.match(body.storage.problem ?? '', /not writable/);
    });

    test('writable storage reports itself as fine', async () => {
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/maintenance`, {
        headers: { cookie: admin.cookie },
      });
      const body = await expectJson<{ storage: { writable: boolean } }>(res);
      assert.equal(body.storage.writable, true);
    });

    test('storage is re-checked per request, not read from startup', async () => {
      // An administrator who has just fixed a volume's ownership should be able
      // to confirm it here rather than restarting the container to find out.
      const admin = await setup();
      storageProblem = 'broken';
      let body = await expectJson<{ storage: { writable: boolean } }>(
        await fetch(`${base}/api/admin/maintenance`, { headers: { cookie: admin.cookie } }),
      );
      assert.equal(body.storage.writable, false);

      storageProblem = null;
      body = await expectJson<{ storage: { writable: boolean } }>(
        await fetch(`${base}/api/admin/maintenance`, { headers: { cookie: admin.cookie } }),
      );
      assert.equal(body.storage.writable, true, 'without a restart');
    });

    test('maintenance reports the anomaly views', async () => {
      const admin = await setup();
      const res = await fetch(`${base}/api/admin/maintenance`, {
        headers: { cookie: admin.cookie },
      });
      const body = await expectJson<{ counts: Record<string, number> }>(res);
      for (const key of [
        'orphanedPages',
        'staleSearchRows',
        'entriesInsidePages',
        'failedMaterialisations',
      ]) {
        assert.equal(typeof body.counts[key], 'number', `${key} should be reported`);
      }
    });
  },
);
