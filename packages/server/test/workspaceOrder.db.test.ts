/**
 * The order of a person's switcher (ADR-0031).
 *
 * The order belongs to one person, not to a workspace, so the things worth
 * testing are about whose list is affected and about the state a list starts in:
 *
 *  - nobody has arranged anything yet, so the list is alphabetical and no row
 *    has a key at all;
 *  - the first drag has to write keys for the whole list, because there is
 *    nothing to place a key between;
 *  - one person's arrangement leaves everybody else's list untouched;
 *  - `/api/workspaces` and `/api/auth/session` agree, because the client opens
 *    the first entry of the session's list when nothing is remembered.
 *
 * Through real HTTP, like the rest of the workspace tests: the status codes for
 * a stale client are half of what this endpoint is.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { Router } from '../src/http/router.js';
import { registerWorkspaceRoutes } from '../src/http/workspaces.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'workspace order (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
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
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
      });
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

    const auth = (cookie: string, init: RequestInit = {}): RequestInit => ({
      ...init,
      headers: { ...(init.headers ?? {}), cookie },
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header, 'expected a Set-Cookie header');
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    /** The first account, and its first workspace. */
    async function setup(): Promise<{ cookie: string; workspaceId: string }> {
      const res = await fetch(
        `${base}/api/auth/setup`,
        json({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          // Named so the alphabetical order is known and is not the order the
          // workspaces are created in — otherwise a test could pass by
          // accident.
          workspaceName: 'Delta',
        }),
      );
      const body = await expectJson<{ workspaceId: string }>(res, 201);
      return { cookie: cookieFrom(res), workspaceId: body.workspaceId };
    }

    async function createWorkspace(cookie: string, name: string): Promise<string> {
      const res = await fetch(`${base}/api/workspaces`, auth(cookie, json({ name })));
      const body = await expectJson<{ id: string }>(res, 201);
      return body.id;
    }

    async function names(cookie: string): Promise<string[]> {
      const res = await fetch(`${base}/api/workspaces`, auth(cookie));
      const body = await expectJson<{ workspaces: Array<{ name: string }> }>(res, 200);
      return body.workspaces.map((entry) => entry.name);
    }

    async function sessionNames(cookie: string): Promise<string[]> {
      const res = await fetch(`${base}/api/auth/session`, auth(cookie));
      const body = await expectJson<{ workspaces: Array<{ name: string }> }>(res, 200);
      return body.workspaces.map((entry) => entry.name);
    }

    const reorder = (
      cookie: string,
      workspaceId: string,
      afterWorkspaceId: string | null,
    ): Promise<Response> =>
      fetch(
        `${base}/api/workspaces/reorder`,
        auth(cookie, json({ workspaceId, afterWorkspaceId })),
      );

    async function keys(userId?: string): Promise<Array<string | null>> {
      const { rows } = await db.query<{ idx: string | null }>(
        `SELECT m.idx FROM workspace_members m
           JOIN workspaces w ON w.id = m.workspace_id
          ${userId ? 'WHERE m.user_id = $1' : ''}
          ORDER BY w.name COLLATE "und-x-icu"`,
        userId ? [userId] : [],
      );
      return rows.map((row) => row.idx);
    }

    test('an untouched list is alphabetical and has no keys', async () => {
      // The state every account starts in. No backfill exists, so this is what
      // "nobody has arranged anything" has to look like.
      const session = await setup();
      await createWorkspace(session.cookie, 'Alpha');
      await createWorkspace(session.cookie, 'Charlie');

      assert.deepEqual(await names(session.cookie), ['Alpha', 'Charlie', 'Delta']);
      assert.deepEqual(await keys(), [null, null, null]);
    });

    test('the first drag places the whole list, not one row', async () => {
      // One key and two nulls would leave the moved workspace somewhere and the
      // rest alphabetical, which does not read as "this moved".
      const session = await setup();
      const alpha = await createWorkspace(session.cookie, 'Alpha');
      await createWorkspace(session.cookie, 'Charlie');

      await expectStatus(await reorder(session.cookie, alpha, session.workspaceId), 200);

      assert.deepEqual(await names(session.cookie), ['Charlie', 'Delta', 'Alpha']);
      const placed = await keys();
      assert.equal(placed.filter((key) => key === null).length, 0, 'every row has a key');
    });

    test('null means first', async () => {
      const session = await setup();
      await createWorkspace(session.cookie, 'Alpha');
      await createWorkspace(session.cookie, 'Charlie');

      await expectStatus(await reorder(session.cookie, session.workspaceId, null), 200);
      assert.deepEqual(await names(session.cookie), ['Delta', 'Alpha', 'Charlie']);
    });

    test('a second move is a single-row change', async () => {
      // Once the list is materialised, placing one workspace must not disturb
      // the keys of the others — that is the whole reason for a fractional
      // index rather than a position.
      const session = await setup();
      const alpha = await createWorkspace(session.cookie, 'Alpha');
      const charlie = await createWorkspace(session.cookie, 'Charlie');

      await expectStatus(await reorder(session.cookie, alpha, charlie), 200);
      assert.deepEqual(await names(session.cookie), ['Charlie', 'Alpha', 'Delta']);
      const before = await db.query<{ workspace_id: string; idx: string }>(
        `SELECT workspace_id, idx FROM workspace_members ORDER BY workspace_id`,
      );

      // Delta from the back to the front: the two it passes must not be
      // rewritten on the way.
      await expectStatus(await reorder(session.cookie, session.workspaceId, null), 200);
      const after = await db.query<{ workspace_id: string; idx: string }>(
        `SELECT workspace_id, idx FROM workspace_members ORDER BY workspace_id`,
      );

      const changed = after.rows.filter((row, at) => row.idx !== before.rows[at]!.idx);
      assert.equal(changed.length, 1, 'exactly one row rewritten');
      assert.equal(changed[0]!.workspace_id, session.workspaceId);
      assert.deepEqual(await names(session.cookie), ['Delta', 'Charlie', 'Alpha']);
    });

    test('a workspace joined later appears at the end, not in the middle', async () => {
      // A membership with no key sorts after every one that has a key. The
      // alternative — falling back into alphabetical position — would drop a new
      // workspace into the middle of a list somebody arranged.
      const session = await setup();
      const alpha = await createWorkspace(session.cookie, 'Alpha');
      await expectStatus(await reorder(session.cookie, alpha, session.workspaceId), 200);
      assert.deepEqual(await names(session.cookie), ['Delta', 'Alpha']);

      await createWorkspace(session.cookie, 'Aardvark');
      assert.deepEqual(await names(session.cookie), ['Delta', 'Alpha', 'Aardvark']);
    });

    test('the switcher and the session agree', async () => {
      // The client opens the session list's first entry when no workspace is
      // remembered, so a disagreement means the switcher's first row and the
      // workspace you land in are different ones.
      const session = await setup();
      const alpha = await createWorkspace(session.cookie, 'Alpha');
      await createWorkspace(session.cookie, 'Charlie');
      await expectStatus(await reorder(session.cookie, alpha, null), 200);

      assert.deepEqual(await sessionNames(session.cookie), await names(session.cookie));
      assert.deepEqual(await names(session.cookie), ['Alpha', 'Charlie', 'Delta']);
    });

    test("one person's arrangement leaves another's list alone", async () => {
      // The reason this is on the membership row rather than on the workspace.
      const owner = await setup();
      const shared = await createWorkspace(owner.cookie, 'Alpha');

      const signup = await fetch(
        `${base}/api/auth/signup`,
        json({
          email: 'other@example.org',
          password: PASSWORD,
          displayName: 'Other',
        }),
      );
      await expectStatus(signup, 201);
      const other = cookieFrom(signup);
      const otherBefore = await names(other);

      await expectStatus(await reorder(owner.cookie, shared, owner.workspaceId), 200);

      assert.deepEqual(await names(other), otherBefore, "the other list is untouched");
      const { rows } = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM workspace_members WHERE idx IS NOT NULL`,
      );
      assert.equal(Number(rows[0]!.count), 2, 'only the owner’s two memberships got keys');
    });

    test('a workspace the caller is not in cannot be named', async () => {
      const owner = await setup();
      const signup = await fetch(
        `${base}/api/auth/signup`,
        json({ email: 'other@example.org', password: PASSWORD, displayName: 'Other' }),
      );
      await expectStatus(signup, 201);
      const other = cookieFrom(signup);
      const theirs = await createWorkspace(other, 'Theirs');

      // Moving something that is not yours.
      const moved = await reorder(owner.cookie, theirs, null);
      await expectStatus(moved, 404);

      // Or landing after something that is not yours: a stale client, and
      // "after that one" has no meaning, so it is refused rather than placed
      // somewhere arbitrary.
      const landed = await reorder(owner.cookie, owner.workspaceId, theirs);
      const body = await expectJson<{ error: string }>(landed, 409);
      assert.equal(body.error, 'sibling_not_found');
    });

    test('a workspace cannot follow itself', async () => {
      const session = await setup();
      const res = await reorder(session.cookie, session.workspaceId, session.workspaceId);
      const body = await expectJson<{ error: string }>(res, 409);
      assert.equal(body.error, 'cannot_follow_itself');
    });

    test('a missing position is refused rather than read as "last"', async () => {
      // Every caller is a drag that landed somewhere, so an absent field is a
      // client bug. Guessing would hide it.
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces/reorder`,
        auth(session.cookie, json({ workspaceId: session.workspaceId })),
      );
      const body = await expectJson<{ error: string }>(res, 422);
      assert.equal(body.error, 'missing_fields');
    });

    test('a signed-out caller cannot reorder anything', async () => {
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces/reorder`,
        json({ workspaceId: session.workspaceId, afterWorkspaceId: null }),
      );
      await expectStatus(res, 401);
    });

    test('a workspace marked for deletion leaves the switcher', async () => {
      // The session endpoint has always excluded it (ADR-0027) and the switcher
      // did not, so it offered somewhere to write that the rest of the interface
      // had already taken away.
      const session = await setup();
      const alpha = await createWorkspace(session.cookie, 'Alpha');
      await db.query(`UPDATE workspaces SET deleted_at = now() WHERE id = $1`, [alpha]);

      assert.deepEqual(await names(session.cookie), ['Delta']);
      assert.deepEqual(await sessionNames(session.cookie), ['Delta']);
    });
  },
);
