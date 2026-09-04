/**
 * The whole way in, walked once (ADR-0073).
 *
 * Every step of this is covered somewhere: resolving a group grant has its own
 * tests in pageAccess, adding somebody has its own in invitations, and the
 * routes each check their own rights. What none of them covers is the path a
 * person actually takes — give a colleague access to the workspace, put them in
 * a group, grant the group a page — and that is the path the question was
 * about: can somebody besides me see and work on this, with group rights.
 *
 * So this test is deliberately end to end and deliberately one story. It exists
 * to fail when the *joins* between those pieces come apart, which is the kind
 * of break that no test of a single piece can see.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerInvitationRoutes } from '../src/auth/invitationRoutes.js';
import { registerGroupRoutes } from '../src/pages/groupRoutes.js';
import { registerPagePermissionRoutes } from '../src/pages/permissionRoutes.js';
import { resolvePageAccess } from '../src/pages/access.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'workspace access with groups (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
      });
      registerInvitationRoutes(router, { pool: db });
      registerGroupRoutes(router, { pool: db });
      registerPagePermissionRoutes(router, { pool: db });

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

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header, 'expected a Set-Cookie header');
      const value = parseCookies(header.split(';')[0]!)[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    const post = (path: string, cookie: string, body?: unknown): Promise<Response> =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body ?? {}),
      });

    const put = (path: string, cookie: string, body?: unknown): Promise<Response> =>
      fetch(`${base}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body ?? {}),
      });

    /** An owner with a workspace, and a colleague with only an account. */
    async function twoPeople(): Promise<{
      owner: string;
      workspaceId: string;
      colleagueId: string;
    }> {
      const first = await fetch(`${base}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          workspaceName: 'Verein',
        }),
      });
      const created = await expectJson<{ workspaceId: string }>(first, 201);

      const second = await fetch(`${base}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'colleague@example.org',
          password: PASSWORD,
          displayName: 'Colleague',
        }),
      });
      const other = await expectJson<{ userId: string }>(second, 201);

      return {
        owner: cookieFrom(first),
        workspaceId: created.workspaceId,
        colleagueId: other.userId,
      };
    }

    /** A folder with a page in it, made directly: this suite is about rights. */
    async function twoPages(workspaceId: string): Promise<{ folder: string; page: string }> {
      const folder = await db.query<{ id: string }>(
        `INSERT INTO pages (id, workspace_id, idx, title, kind)
         VALUES (gen_random_uuid(), $1, 'a0', 'Vorstand', 'folder') RETURNING id`,
        [workspaceId],
      );
      const folderId = folder.rows[0]!.id;
      const page = await db.query<{ id: string }>(
        `INSERT INTO pages (id, workspace_id, parent_page_id, ancestor_ids, idx, title, kind)
         VALUES (gen_random_uuid(), $1, $2, ARRAY[$2]::uuid[], 'a0', 'Protokoll', 'page')
         RETURNING id`,
        [workspaceId, folderId],
      );
      return { folder: folderId, page: page.rows[0]!.id };
    }

    test('a colleague can be let in, put in a group, and given a page through it', async () => {
      const { owner, workspaceId, colleagueId } = await twoPeople();
      const { folder, page } = await twoPages(workspaceId);

      // Access, not an invitation: the account exists, so nothing is created
      // and no link is sent.
      await expectJson(
        await post(`/api/workspaces/${workspaceId}/members`, owner, {
          email: 'colleague@example.org',
          // A guest gets nothing by role alone, which is what makes the rest of
          // this test about the group and not about membership.
          role: 'guest',
        }),
        201,
      );
      assert.equal(
        (await resolvePageAccess(db, { pageId: page, userId: colleagueId })).access,
        null,
        'in the workspace, and that alone gives a guest nothing',
      );

      const group = await expectJson<{ id: string }>(
        await post(`/api/workspaces/${workspaceId}/groups`, owner, { name: 'Vorstand' }),
        201,
      );

      // Only people already in the workspace may be in a group — which is why
      // access has to come first, and why it is one act rather than two.
      await expectJson(
        await put(`/api/groups/${group.id}/members/${colleagueId}`, owner),
        200,
      );

      // Granted on the folder, and it reaches the page inside: a group grant
      // inherits like any other (ADR-0026).
      await expectJson(
        await put(`/api/pages/${folder}/groups/${group.id}`, owner, { access: 'editor' }),
        200,
      );

      assert.equal(
        (await resolvePageAccess(db, { pageId: page, userId: colleagueId })).access,
        'editor',
        'and may work on it, not only read it',
      );
    });

    test('leaving the group takes the page with it, and membership stays', async () => {
      /*
       * The point of a group: membership is the one thing kept up to date, and
       * a grant does not have to be found and undone page by page. Being in the
       * workspace is a separate fact and must survive.
       */
      const { owner, workspaceId, colleagueId } = await twoPeople();
      const { folder, page } = await twoPages(workspaceId);

      await post(`/api/workspaces/${workspaceId}/members`, owner, {
        email: 'colleague@example.org',
        role: 'guest',
      });
      const group = await expectJson<{ id: string }>(
        await post(`/api/workspaces/${workspaceId}/groups`, owner, { name: 'Vorstand' }),
        201,
      );
      await put(`/api/groups/${group.id}/members/${colleagueId}`, owner);
      await put(`/api/pages/${folder}/groups/${group.id}`, owner, { access: 'editor' });

      await fetch(`${base}/api/groups/${group.id}/members/${colleagueId}`, {
        method: 'DELETE',
        headers: { cookie: owner },
      });

      assert.equal(
        (await resolvePageAccess(db, { pageId: page, userId: colleagueId })).access,
        null,
      );
      const still = await db.query(
        `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, colleagueId],
      );
      assert.equal(still.rowCount, 1, 'still in the workspace, with nothing granted');
    });

    test('a group cannot hold somebody who is not in the workspace', async () => {
      /*
       * A member by the side door: they would reach pages through a grant while
       * appearing in no list of who is here. The refusal is what makes access
       * the single place where "who is in this workspace" is decided.
       */
      const { owner, workspaceId, colleagueId } = await twoPeople();
      const group = await expectJson<{ id: string }>(
        await post(`/api/workspaces/${workspaceId}/groups`, owner, { name: 'Vorstand' }),
        201,
      );

      const res = await put(`/api/groups/${group.id}/members/${colleagueId}`, owner);
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: 'not_a_member' });
    });

    test('taking access away takes the group membership with it', async () => {
      /*
       * Otherwise removing somebody from a workspace leaves them in its groups,
       * and adding them back a year later silently restores every page those
       * groups reach.
       */
      const { owner, workspaceId, colleagueId } = await twoPeople();
      await post(`/api/workspaces/${workspaceId}/members`, owner, {
        email: 'colleague@example.org',
        role: 'member',
      });
      const group = await expectJson<{ id: string }>(
        await post(`/api/workspaces/${workspaceId}/groups`, owner, { name: 'Vorstand' }),
        201,
      );
      await put(`/api/groups/${group.id}/members/${colleagueId}`, owner);

      await fetch(`${base}/api/workspaces/${workspaceId}/members/${colleagueId}`, {
        method: 'DELETE',
        headers: { cookie: owner },
      });

      const left = await db.query(
        `SELECT 1 FROM group_members gm JOIN groups g ON g.id = gm.group_id
          WHERE g.workspace_id = $1 AND gm.user_id = $2`,
        [workspaceId, colleagueId],
      );
      assert.equal(left.rowCount, 0);
    });
  },
);
