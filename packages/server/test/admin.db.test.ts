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
import { closeTestPool, getTestPool, hasDatabase, resetDatabase, seedWorkspace } from './support/db.js';
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
    /** What the test button asked the relay to do, and what it may answer. */
    let mailAsked: { to: string; host: string } | null = null;
    /** Who was told their second factor was removed, and by whom. */
    let factorRemovedTold: { to: string; byWhom: string } | null = null;
    /*
     * Read through a call, which defeats the narrowing.
     *
     * The same shape as `askedMail` above, and for the same reason: after
     * `= null` the compiler knows the variable *is* null, and the assignment
     * that fills it happens in a callback it cannot follow.
     */
    const toldAbout = (): { to: string; byWhom: string } | null => factorRemovedTold;
    /*
     * Read through a call, which defeats the narrowing.
     *
     * After `mailAsked = null` the compiler knows the variable *is* null, and
     * the assignment that fills it happens inside a callback it cannot follow —
     * so a direct read was `never` and `assert.ok` could not widen it back. A
     * function's return type is its declared one.
     */
    const askedMail = (): { to: string; host: string } | null => mailAsked;
    let mailRefuses: string | null = null;

    before(async () => {
      db = await getTestPool();
      settings = new SettingsStore(db, {
        signupMode: 'invite',
        instanceName: 'SONE',
        allowWorkspaceCreation: true,
        defaultLocale: 'en',
      addressForm: 'informal' as const,
        // No relay in a test instance, which is the ordinary case: no email is
        // attempted and nothing is offered (ADR-0058).
        smtpHost: '',
        smtpPort: '587',
        smtpUser: '',
        smtpFrom: '',
        smtpSecurity: 'starttls' as const,
        emailDetail: 'title' as const,
        // No mailbox either: replies are absent in these suites (ADR-0060).
        requireSecondFactor: false,
        requireSecondFactorSince: '',
        imapHost: '',
        imapPort: '993',
        imapUser: '',
        imapFolder: 'INBOX',
        replyMailbox: '',
      });

      const router = new Router();
      registerAuthRoutes(router, {
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
        // No relay in these suites: the reset is absent, which is the
        // ordinary case for an instance without mail (ADR-0059).
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
        // No requirement in these suites (ADR-0065).
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
      });
      registerAdminRoutes(router, {
        pool: db,
        oidcClientSecret: null,
        settings,
        version: 'test',
        commit: 'abc1234',
        // Reports whatever storageProblem currently holds, so a test can decide
        // what the instance's storage looks like.
        checkStorage: () => Promise.resolve(storageProblem),
        /*
         * A relay that records rather than connects.
         *
         * The test button's value is that it reports what the relay said, so
         * what these tests need is control over what it says — not a network.
         */
        sendTestMail: (relay, to) => {
          mailAsked = { to, host: relay.host };
          if (mailRefuses !== null) return Promise.reject(new Error(mailRefuses));
          return Promise.resolve();
        },
        smtpPassword: 'aus der Umgebung',
        // Recorded rather than sent: the test asserts who was told, and by
        // which name (ADR-0063).
        tellFactorRemoved: (to, byWhom) => {
          factorRemovedTold = { to, byWhom };
          return Promise.resolve();
        },
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

    test('anybody may list workspaces, but only the right may delete one', async () => {
      /*
       * One list of different lengths (ADR-0067): it was administrator-only,
       * which is why a member had no list at all.
       *
       * And the second half is the check that would have caught the worst
       * mistake in this change. Loosening the list route, my text replacement
       * also hit the deletion route below it and removed *its* guard — which
       * would have let any member mark any workspace deleted. Nothing about the
       * loosening is safe without this assertion beside it.
       */
      const admin = await setup();
      const member = await ordinaryUser('lister@example.org');

      const listed = await expectJson<{ workspaces: Array<{ id: string }> }>(
        await fetch(`${base}/api/admin/workspaces`, { headers: { cookie: member.cookie } }),
        200,
      );
      const all = await expectJson<{ workspaces: Array<{ id: string }> }>(
        await fetch(`${base}/api/admin/workspaces`, { headers: { cookie: admin.cookie } }),
        200,
      );
      assert.ok(all.workspaces.length >= listed.workspaces.length, 'the admin sees at least as many');

      await expectStatus(
        await fetch(`${base}/api/admin/workspaces/${all.workspaces[0]!.id}/deletion`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: member.cookie },
          body: JSON.stringify({ confirmName: 'whatever' }),
        }),
        404,
      );
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

      /*
       * `workspaces` is no longer in this list, deliberately (ADR-0067).
       *
       * Listing workspaces is open to everybody now and the answer's length is
       * the right — one list of different lengths rather than a screen whose
       * existence depends on a permission. The routes below are still
       * administration, and still answer "not there" rather than "not allowed"
       * for the reason this test was written.
       */
      for (const path of ['overview', 'users', 'maintenance']) {
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

    test('a failed send is an anomaly the operator can see', async () => {
      // Otherwise a wrong SMTP password is a failed job in a queue and nowhere
      // an administrator is looking (ADR-0058).
      const admin = await setup();
      const fixture = await seedWorkspace(db, 'Mail failures');
      await db.query(
        `INSERT INTO jobs (workspace_id, kind, state, error)
         VALUES ($1, 'email_notifications', 'failed', '535 authentication failed')`,
        [fixture.workspaceId],
      );

      const report = await expectJson<{ counts: { failedMail: number } }>(
        await fetch(`${base}/api/admin/maintenance`, { headers: { cookie: admin.cookie } }),
        200,
      );
      assert.equal(report.counts.failedMail, 1);
    });

    test('the test button mails the administrator asking, and reports the relay´s words', async () => {
      // To their own address, never one they type: a form that mails an
      // arbitrary address is an open relay with a sign-in (ADR-0058).
      const admin = await setup();
      await fetch(`${base}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ smtpHost: 'mail.example.org' }),
      });

      mailAsked = null;
      mailRefuses = null;
      const sent = await expectJson<{ sentTo: string | null }>(
        await fetch(`${base}/api/admin/mail/test`, {
          method: 'POST',
          headers: { cookie: admin.cookie },
        }),
        200,
      );
      // `assert.ok` first, because it narrows: the compiler had reduced
      // `mailAsked` to `never` after the reset above, since the assignment
      // happens inside a callback it cannot follow. Asserting it exists is both
      // the fix and the thing worth asserting.
      const asked = askedMail();
      assert.ok(asked, 'the relay was asked');
      assert.equal(asked.host, 'mail.example.org');
      assert.equal(sent.sentTo, asked.to, 'to the address it says it used');

      // A refusal comes back as the relay's own words, and as 200: a failed
      // test is a successful test — it did what it was asked and found
      // something. "535 authentication failed" is the answer; "sending failed"
      // costs somebody an hour.
      mailRefuses = '535 authentication failed';
      const refused = await expectJson<{
        sentTo: string | null;
        problem?: string;
        using?: {
          host: string;
          passwordLength: number;
          passwordLooksQuoted: boolean;
        };
      }>(
        await fetch(`${base}/api/admin/mail/test`, {
          method: 'POST',
          headers: { cookie: admin.cookie },
        }),
        200,
      );
      assert.equal(refused.sentTo, null);
      assert.match(refused.problem ?? '', /535 authentication failed/);

      /*
       * And what it used, so a 535 can be told from a typo (ADR-0058).
       *
       * An operator cannot see inside the container. Every value here is one
       * they set, except the password — for which only the length and two
       * shapes that have each produced a 535 for somebody: a value that arrived
       * still wrapped in quotes, and one padded with whitespace.
       */
      assert.equal(refused.using?.host, 'mail.example.org');
      assert.equal(refused.using?.passwordLength, 'aus der Umgebung'.length);
      assert.equal(refused.using?.passwordLooksQuoted, false);
      // Never the password itself: a field that echoes a secret to whoever is
      // signed in as an administrator is one phished session from being read.
      assert.doesNotMatch(JSON.stringify(refused), /aus der Umgebung/);
    });

    test('the test button refuses when no mail server is set', async () => {
      // Rather than sending nowhere and reporting success.
      const admin = await setup();
      await expectStatus(
        await fetch(`${base}/api/admin/mail/test`, {
          method: 'POST',
          headers: { cookie: admin.cookie },
        }),
        422,
      );
    });

    test('an administrator can remove a second factor, and the person is told', async () => {
      /*
       * The only way back for somebody who has lost both their phone and their
       * recovery codes — and deliberately not self-service (ADR-0063).
       *
       * There is no audit table in SONE, and a log line nobody reads is not
       * accountability. The person whose account was disarmed is exactly who
       * needs to know, and the mail names who did it so they can act on it.
       */
      const admin = await setup();
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ('verloren@example.org', 'Verloren')
         RETURNING id::text AS id`,
      );
      const target = rows[0]!.id;

      // With a confirmed factor in place.
      await db.query(
        `INSERT INTO second_factors (user_id, secret, confirmed_at) VALUES ($1, 'v1.a.b.c', now())`,
        [target],
      );
      await db.query(
        `INSERT INTO recovery_codes (code_hash, user_id) VALUES ('deadbeef', $1)`,
        [target],
      );

      factorRemovedTold = null;
      const removed = await expectJson<{ removed: boolean }>(
        await fetch(`${base}/api/admin/users/${target}/second-factor/remove`, {
          method: 'POST',
          headers: { cookie: admin.cookie },
        }),
        200,
      );
      assert.equal(removed.removed, true);
      const told = toldAbout();
      assert.ok(told, 'somebody was told');
      assert.equal(told.to, 'verloren@example.org');
      assert.ok(told.byWhom !== '', 'and by whom');
      assert.notEqual(told.byWhom, 'an administrator', 'named, not generic');

      // The codes go with it: none may outlive the factor.
      const left = await db.query(`SELECT 1 FROM recovery_codes WHERE user_id = $1`, [target]);
      assert.equal(left.rowCount, 0);

      // Doing it again tells nobody: a mail about removing a factor somebody
      // never had starts a conversation about nothing.
      factorRemovedTold = null;
      const again = await expectJson<{ removed: boolean }>(
        await fetch(`${base}/api/admin/users/${target}/second-factor/remove`, {
          method: 'POST',
          headers: { cookie: admin.cookie },
        }),
        200,
      );
      assert.equal(again.removed, false);
      assert.equal(toldAbout(), null);
    });

    test('an administrator cannot require a second factor without having one', async () => {
      /*
       * The decision this exists for: a policy imposed by somebody exempt from
       * it gets rolled back the first time it inconveniences the person who set
       * it (ADR-0065).
       */
      const admin = await setup();
      await expectStatus(
        await fetch(`${base}/api/admin/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: admin.cookie },
          body: JSON.stringify({ requireSecondFactor: true }),
        }),
        422,
      );

      // With one in place it goes through, and the clock is stamped by the
      // server rather than taken from the request.
      const me = await db.query<{ id: string }>(
        `SELECT user_id::text AS id FROM sessions ORDER BY created_at DESC LIMIT 1`,
      );
      await db.query(
        `INSERT INTO second_factors (user_id, secret, confirmed_at)
         VALUES ($1, 'v1.a.b.c', now())
         ON CONFLICT (user_id) DO UPDATE SET confirmed_at = now()`,
        [me.rows[0]!.id],
      );

      const saved = await expectJson<{ settings: { requireSecondFactorSince: string } }>(
        await fetch(`${base}/api/admin/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: admin.cookie },
          body: JSON.stringify({
            requireSecondFactor: true,
            // Ignored: the clock is the server's to set.
            requireSecondFactorSince: '1999-01-01T00:00:00.000Z',
          }),
        }),
        200,
      );
      assert.notEqual(saved.settings.requireSecondFactorSince, '1999-01-01T00:00:00.000Z');
      assert.ok(Date.parse(saved.settings.requireSecondFactorSince) > Date.now() - 60_000);

      // And saving something else does not restart the grace period, which
      // would silently give everybody another fortnight.
      const stamped = saved.settings.requireSecondFactorSince;
      const again = await expectJson<{ settings: { requireSecondFactorSince: string } }>(
        await fetch(`${base}/api/admin/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: admin.cookie },
          body: JSON.stringify({ requireSecondFactor: true, instanceName: 'Anders' }),
        }),
        200,
      );
      assert.equal(again.settings.requireSecondFactorSince, stamped, 'the clock did not move');
    });

    test('the mail server can be set without touching the environment', async () => {
      // The keys existed and the route accepted them, and no screen drew them —
      // so from an administrator's side they were environment-only whatever the
      // code said (ADR-0058). This is the route half of the fix; the screen is
      // asserted in the web tests.
      const admin = await setup();
      const response = await fetch(`${base}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({
          smtpHost: 'mail.example.org',
          smtpPort: '465',
          smtpSecurity: 'tls',
          smtpFrom: 'sone@example.org',
          emailDetail: 'workspace',
        }),
      });
      // The PATCH answers with the settings; there is no GET for them, and the
      // field is `settingSources`. I wrote a second request to a route that
      // does not exist and read a field name I had invented.
      const read = await expectJson<{
        settings: Record<string, unknown>;
        settingSources: Record<string, string>;
      }>(response);
      assert.equal(read.settings['smtpHost'], 'mail.example.org');
      assert.equal(read.settings['smtpSecurity'], 'tls');
      assert.equal(read.settings['emailDetail'], 'workspace');
      // And it says where the value came from, which is what makes the screen
      // able to explain itself.
      assert.equal(read.settingSources['smtpHost'], 'database');

      // The password is not a setting and cannot become one: a secret in a
      // table is a secret in every backup (ADR-0024).
      assert.ok(!('smtpPassword' in read.settings), 'no password among the settings');
      const refused = await fetch(`${base}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ smtpPassword: 'hunter2' }),
      });
      assert.equal(refused.status, 422, 'an unknown key, because it is not one');
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
