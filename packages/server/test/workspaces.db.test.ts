/**
 * Workspace routes.
 *
 * Everything in the data model already allowed several workspaces — the session
 * endpoint has always returned a list — but nothing could create a second one,
 * so an instance was effectively single-workspace.
 *
 * These tests run through real HTTP because the interesting parts are the
 * status codes, the membership that has to be created alongside the workspace,
 * and who may read an email address.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { registerWorkspaceRoutes } from '../src/http/workspaces.js';
import { hashPassword } from '../src/auth/password.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'workspaces (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    before(async () => {
      db = await getTestPool();
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
      registerPageRoutes(router, { pool: db });
      registerWorkspaceRoutes(router, { pool: db });

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
    });

    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header, 'expected a Set-Cookie header');
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    async function setup(): Promise<{ cookie: string; workspaceId: string; userId: string }> {
      const res = await fetch(
        `${base}/api/auth/setup`,
        json({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          workspaceName: 'First',
        }),
      );
      const body = await expectJson<{ userId: string; workspaceId: string }>(res, 201);
      return { cookie: cookieFrom(res), workspaceId: body.workspaceId, userId: body.userId };
    }

    const auth = (cookie: string, init: RequestInit = {}): RequestInit => ({
      ...init,
      headers: { ...(init.headers ?? {}), cookie },
    });

    test('managing workspaces is not taken away by being a member of one', async () => {
      /*
       * The rule did not match itself.
       *
       * The rights were fetched only when the role was null, so somebody with
       * the workspace-management right who happened to be an ordinary **member**
       * of a workspace was refused — while the same person could have edited it
       * by leaving first. A right a membership takes away is not a right
       * (ADR-0067).
       *
       * Found by loosening the interface to match this route, and noticing the
       * route disagreed with its own comment.
       */
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      const manager = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash, can_manage_workspaces)
         VALUES ('verwalter@example.org','Verwalter',$1,true) RETURNING id`,
        [hash],
      );
      // A member of it, deliberately: that is the case that used to fail.
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [session.workspaceId, manager.rows[0]!.id],
      );

      // The same way every other test here signs in as somebody else — I
      // invented a `signIn` helper that does not exist.
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'verwalter@example.org', password: PASSWORD }),
      );
      const renamed = await fetch(`${base}/api/workspaces/${session.workspaceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieFrom(login) },
        body: JSON.stringify({ name: 'Umbenannt vom Verwalter' }),
      });
      assert.equal(renamed.status, 200, 'the right holds whatever the membership says');
    });

    test('a second workspace can be created', async () => {
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces`,
        auth(session.cookie, json({ name: 'Second' })),
      );
      await expectStatus(res, 201);

      const list = await fetch(`${base}/api/workspaces`, auth(session.cookie));
      const body = (await list.json()) as { workspaces: Array<{ name: string; role: string }> };
      assert.deepEqual(
        body.workspaces.map((w) => w.name).sort(),
        ['First', 'Second'],
      );
      assert.ok(body.workspaces.every((w) => w.role === 'owner'));
    });

    test('the creator becomes a member in the same transaction', async () => {
      // A workspace nobody belongs to is invisible and unreachable, including
      // to the person who just made it.
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces`,
        auth(session.cookie, json({ name: 'Second' })),
      );
      const created = (await res.json()) as { id: string };

      const member = await db.query<{ role: string }>(
        `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [created.id, session.userId],
      );
      assert.equal(member.rows[0]?.role, 'owner');
    });

    test('a new workspace starts with a folder', async () => {
      // Without one it cannot hold a page at all (ADR-0019), so it would open
      // onto a "new page" button that refuses.
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces`,
        auth(session.cookie, json({ name: 'Second' })),
      );
      const created = (await res.json()) as { id: string; defaultFolderId: string | null };
      assert.ok(created.defaultFolderId, 'a default folder should be reported');

      const folders = await db.query<{ kind: string; title: string }>(
        `SELECT kind, title FROM pages WHERE workspace_id = $1`,
        [created.id],
      );
      assert.equal(folders.rowCount, 1);
      assert.equal(folders.rows[0]!.kind, 'folder');
    });

    test('an empty name is refused', async () => {
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces`,
        auth(session.cookie, json({ name: '   ' })),
      );
      assert.equal(res.status, 422);
    });

    test('an anonymous caller cannot create a workspace', async () => {
      await setup();
      const res = await fetch(`${base}/api/workspaces`, json({ name: 'Sneaky' }));
      assert.equal(res.status, 401);
    });

    test('a guest cannot create a workspace', async () => {
      // A guest is a share-link participant, not a member.
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash, is_guest)
         VALUES ('guest@example.org','G',$1,true)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'guest@example.org', password: PASSWORD }),
      );
      const res = await fetch(
        `${base}/api/workspaces`,
        auth(cookieFrom(login), json({ name: 'Nope' })),
      );
      assert.equal(res.status, 403);
    });

    test('workspaces of other people are not listed', async () => {
      const first = await setup();
      await fetch(`${base}/api/workspaces`, auth(first.cookie, json({ name: 'Private' })));

      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('other@example.org','Other',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'other@example.org', password: PASSWORD }),
      );

      const list = await fetch(`${base}/api/workspaces`, auth(cookieFrom(login)));
      const body = (await list.json()) as { workspaces: unknown[] };
      assert.deepEqual(body.workspaces, [], 'membership is the only way in');
    });

    test('renaming requires owner or admin', async () => {
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}`,
        auth(session.cookie, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        }),
      );
      assert.equal(res.status, 200);

      const row = await db.query<{ name: string }>(
        `SELECT name FROM workspaces WHERE id = $1`,
        [session.workspaceId],
      );
      assert.equal(row.rows[0]!.name, 'Renamed');
    });

    test('a non-member gets 404 rather than 403 when renaming', async () => {
      // A 403 would confirm the workspace exists.
      const first = await setup();
      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('other@example.org','Other',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'other@example.org', password: PASSWORD }),
      );

      const res = await fetch(`${base}/api/workspaces/${first.workspaceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieFrom(login) },
        body: JSON.stringify({ name: 'Hijack' }),
      });
      assert.equal(res.status, 404);
    });

    test('members are listed, with emails only for administrators', async () => {
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      const other = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('member@example.org','Member',$1) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [session.workspaceId, other.rows[0]!.id],
      );

      const asOwner = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/members`,
        auth(session.cookie),
      );
      const ownerView = (await asOwner.json()) as {
        members: Array<{ displayName: string; email: string | null }>;
        viewerRole: string;
      };
      assert.equal(ownerView.viewerRole, 'owner');
      assert.equal(ownerView.members.length, 2);
      assert.ok(
        ownerView.members.every((m) => m.email !== null),
        'an administrator sees addresses',
      );

      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'member@example.org', password: PASSWORD }),
      );
      const asMember = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/members`,
        auth(cookieFrom(login)),
      );
      const memberView = (await asMember.json()) as {
        members: Array<{ displayName: string; email: string | null }>;
      };
      assert.ok(
        memberView.members.every((m) => m.email === null),
        'an ordinary member sees names, not addresses',
      );
      assert.ok(
        memberView.members.every((m) => m.displayName.length > 0),
        'names are still there — they are what identifies who edited a page',
      );
    });

    test('a non-member cannot list members', async () => {
      const first = await setup();
      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('nosy@example.org','Nosy',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'nosy@example.org', password: PASSWORD }),
      );
      const res = await fetch(`${base}/api/workspaces/${first.workspaceId}/members`, {
        headers: { cookie: cookieFrom(login) },
      });
      assert.equal(res.status, 404);
    });

    // --- theme ---------------------------------------------------------------

    const readTheme = async (cookie: string, workspaceId: string) =>
      expectJson<{ theme: Record<string, unknown> }>(
        await fetch(`${base}/api/workspaces/${workspaceId}/theme`, {
          headers: { cookie },
        }),
      );

    const setTheme = (
      cookie: string,
      workspaceId: string,
      theme: unknown,
    ): Promise<Response> =>
      fetch(`${base}/api/workspaces/${workspaceId}/theme`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ theme }),
      });

    test('a workspace with no theme has an empty one, not a missing one', async () => {
      // Having no theme is the ordinary state, and it has to render exactly as
      // every workspace did before themes existed (ADR-0023).
      const session = await setup();
      assert.deepEqual((await readTheme(session.cookie, session.workspaceId)).theme, {});
    });

    test('a theme is stored and read back', async () => {
      const session = await setup();
      await expectStatus(
        await setTheme(session.cookie, session.workspaceId, {
          heading1: { size: 2, color: 'blue' },
        }),
        200,
      );

      assert.deepEqual((await readTheme(session.cookie, session.workspaceId)).theme, {
        heading1: { size: 2, color: 'blue' },
      });
    });

    test('an unusable value is dropped and the rest is kept', async () => {
      // A theme comes from a form, and one stale field should not cost somebody
      // the rest of their settings. What comes back says what was stored.
      const session = await setup();
      const res = await setTheme(session.cookie, session.workspaceId, {
        // A hex is a colour now (ADR-0023); 'chartreuse' is neither a palette
        // name nor a hex, and the unknown element is still dropped.
        heading1: { size: 1, color: '#ff0000' },
        body: { color: 'chartreuse' },
        banner: { size: 3 },
      });
      const body = await expectJson<{ theme: Record<string, unknown> }>(res, 200);

      assert.deepEqual(body.theme, { heading1: { size: 1, color: '#ff0000' } });
      assert.deepEqual((await readTheme(session.cookie, session.workspaceId)).theme, {
        heading1: { size: 1, color: '#ff0000' },
      });
    });

    test('setting it again replaces rather than accumulating', async () => {
      const session = await setup();
      await setTheme(session.cookie, session.workspaceId, { heading1: { size: 2 } });
      await setTheme(session.cookie, session.workspaceId, { body: { color: 'grey' } });

      assert.deepEqual((await readTheme(session.cookie, session.workspaceId)).theme, {
        body: { color: 'grey' },
      });
    });

    test('a value written by hand is not served as-is', async () => {
      // Sanitised on the way out as well as in: something a newer version or a
      // database client wrote must not reach a client that would render what
      // nothing here decided.
      const session = await setup();
      await db.query(
        `INSERT INTO workspace_themes (workspace_id, settings) VALUES ($1, $2)`,
        [session.workspaceId, JSON.stringify({ heading1: { size: 99 }, body: { color: 'green' } })],
      );

      assert.deepEqual((await readTheme(session.cookie, session.workspaceId)).theme, {
        body: { color: 'green' },
      });
    });

    test('an ordinary member may read it but not set it', async () => {
      // It changes what the workspace looks like for everybody in it, which is
      // what "defaults" means.
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      const member = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('member@example.org','M',$1) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [session.workspaceId, member.rows[0]!.id],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'member@example.org', password: PASSWORD }),
      );
      const cookie = cookieFrom(login);

      await expectStatus(
        await fetch(`${base}/api/workspaces/${session.workspaceId}/theme`, {
          headers: { cookie },
        }),
        200,
      );
      assert.equal(
        (await setTheme(cookie, session.workspaceId, { body: { color: 'red' } })).status,
        403,
      );
    });

    test('somebody outside the workspace sees nothing', async () => {
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('out@example.org','O',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'out@example.org', password: PASSWORD }),
      );

      assert.equal(
        (
          await fetch(`${base}/api/workspaces/${session.workspaceId}/theme`, {
            headers: { cookie: cookieFrom(login) },
          })
        ).status,
        404,
      );
    });
  },
);
