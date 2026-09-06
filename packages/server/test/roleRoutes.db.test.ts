/**
 * Defining a role, through the routes the screen uses (ADR-0087, step three).
 *
 * The point of this file is the *shape* of the thing, not the CRUD: a role is a
 * page level and a set of rights, and the tests that matter are the ones about
 * what cannot be done — because a settings screen for permissions is a place
 * where the refusals are the feature.
 *
 * Three of them, and each has cost somebody a workspace somewhere:
 * a built-in role cannot be edited away, a role somebody holds cannot be
 * deleted out from under them, and a right the server does not know is refused
 * rather than dropped.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerInvitationRoutes } from '../src/auth/invitationRoutes.js';
import { registerGroupRoutes } from '../src/pages/groupRoutes.js';
import { registerRoleRoutes } from '../src/auth/roleRoutes.js';
import { registerWorkspaceRoutes } from '../src/http/workspaces.js';
import { loadWorkspaceStanding } from '../src/auth/standing.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

interface RoleJson {
  id: string;
  key: string | null;
  name: string;
  pageLevel: string | null;
  rights: string[];
  members: number;
  groups: number;
}

describe(
  'defining roles (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let cookie: string;
    let workspaceId: string;
    let colleagueId: string;

    const json = (body: unknown, method = 'POST'): RequestInit => ({
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);

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
      } as never);
      registerInvitationRoutes(router, { pool: db });
      registerGroupRoutes(router, { pool: db });
      registerRoleRoutes(router, { pool: db });
      registerWorkspaceRoutes(router, { pool: db } as never);

      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

      const setup = await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          workspaceName: 'W',
        }),
      });
      const body = await expectJson<{ workspaceId: string }>(setup, 201);
      workspaceId = body.workspaceId;
      const header = setup.headers.get('set-cookie')!;
      const value = parseCookies(header.split(';')[0]!)[SESSION_COOKIE]!;
      cookie = `${SESSION_COOKIE}=${encodeURIComponent(value)}`;

      // A second person, so "a role somebody holds" is a real situation rather
      // than a row nobody points at.
      const colleague = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('colleague@example.org','Colleague','x') RETURNING id`,
      );
      colleagueId = colleague.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
         VALUES ($1,$2,(SELECT id FROM roles WHERE key='member'),false)`,
        [workspaceId, colleagueId],
      );
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    const roles = async (): Promise<RoleJson[]> => {
      const res = await fetch(`${base}/api/workspaces/${workspaceId}/roles`, {
        headers: { cookie },
      });
      const body = await expectJson<{ roles: RoleJson[] }>(res, 200);
      return body.roles;
    };

    test('the four built-in roles are listed, and say so', async () => {
      const list = await roles();
      const keys = list.filter((one) => one.key !== null).map((one) => one.key);
      assert.deepEqual(keys.sort(), ['admin', 'guest', 'member', 'owner']);

      const guest = list.find((one) => one.key === 'guest')!;
      assert.equal(guest.pageLevel, null, 'a guest gets nothing without a share');
      const member = list.find((one) => one.key === 'member')!;
      assert.equal(member.pageLevel, 'editor');
      assert.deepEqual(member.rights, [], 'and decides nothing about who is here');
    });

    test('a read-only role can be made, which is the whole point', async () => {
      /*
       * Markus's first question: "kann ich da dann noch rechte vergeben, zb nur
       * lesend hinzufügen". Before roles were rows this was not a setting
       * somebody had forgotten to expose — `member` mapped to `editor` and a
       * grant could only widen, so it was inexpressible.
       */
      const res = await fetch(
        `${base}/api/workspaces/${workspaceId}/roles`,
        json({ name: 'Lesen', pageLevel: 'viewer', rights: [] }),
      );
      const created = await expectJson<RoleJson>(res, 201);
      assert.equal(created.pageLevel, 'viewer');

      const put = await fetch(
        `${base}/api/workspaces/${workspaceId}/members/${colleagueId}`,
        json({ roleId: created.id }, 'PUT'),
      );
      await expectJson(put, 200);

      const standing = await loadWorkspaceStanding(db, colleagueId, workspaceId);
      assert.equal(standing.pageLevel, 'viewer', 'read-only in the workspace');
      assert.deepEqual([...standing.rights], []);
      assert.equal(standing.isOwner, false, 'and a custom role never carries ownership');
    });

    test('a role somebody holds is not deleted out from under them', async () => {
      // The alternative is moving everybody to `member` and deleting, which
      // changes what several people may do without saying so.
      const held = (await roles()).find((one) => one.name === 'Lesen')!;
      assert.equal(held.members, 1, 'the list says who holds it');

      const res = await fetch(`${base}/api/workspaces/${workspaceId}/roles/${held.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      const body = await expectJson<{ error: string; members: number }>(res, 409);
      assert.equal(body.error, 'role_in_use');
      assert.equal(body.members, 1, 'and the refusal says how many');
    });

    test('a built-in role cannot be edited or deleted', async () => {
      /*
       * The safety floor. A workspace always has an owner and an owner always
       * holds every right; both have to survive any amount of editing here, or
       * somebody builds a workspace nobody can administer — usually the person
       * who then cannot undo it.
       */
      const member = (await roles()).find((one) => one.key === 'member')!;

      const patched = await fetch(
        `${base}/api/workspaces/${workspaceId}/roles/${member.id}`,
        json({ name: 'Mitglied', pageLevel: 'admin', rights: [] }, 'PATCH'),
      );
      assert.equal(patched.status, 409);
      assert.equal(((await patched.json()) as { error: string }).error, 'system_role');

      const deleted = await fetch(`${base}/api/workspaces/${workspaceId}/roles/${member.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      assert.equal(deleted.status, 409);

      const after = (await roles()).find((one) => one.key === 'member')!;
      assert.equal(after.pageLevel, 'editor', 'unchanged');
    });

    test('a right the server does not know is refused, not dropped', async () => {
      /*
       * The opposite of what the loader does when it *reads* a row, and
       * deliberately so. A stored name nothing recognises is ignored, because a
       * row can outlive the code. A name arriving from a client right now is
       * refused, because saving a role without the right somebody just ticked
       * is the failure this whole record is about: a control that appears to
       * work and does not.
       */
      const res = await fetch(
        `${base}/api/workspaces/${workspaceId}/roles`,
        json({ name: 'Zukunft', pageLevel: 'editor', rights: ['everything.manage'] }),
      );
      assert.equal(res.status, 422);
      assert.equal(((await res.json()) as { error: string }).error, 'invalid_right');

      assert.equal(
        (await roles()).some((one) => one.name === 'Zukunft'),
        false,
        'and nothing was created',
      );
    });

    test('a page level the ladder does not have is refused', async () => {
      const res = await fetch(
        `${base}/api/workspaces/${workspaceId}/roles`,
        json({ name: 'Halb', pageLevel: 'halfway', rights: [] }),
      );
      assert.equal(res.status, 422);
      assert.equal(((await res.json()) as { error: string }).error, 'invalid_level');
    });

    test('a group can carry a role, and everybody in it holds what it gives', async () => {
      const made = await fetch(
        `${base}/api/workspaces/${workspaceId}/roles`,
        json({ name: 'Büro', pageLevel: null, rights: ['people.manage'] }),
      );
      const role = await expectJson<RoleJson>(made, 201);

      const group = await fetch(
        `${base}/api/workspaces/${workspaceId}/groups`,
        json({ name: 'Büro' }),
      );
      const made2 = await expectJson<{ id: string }>(group, 201);

      await expectJson(
        await fetch(
          `${base}/api/workspaces/${workspaceId}/groups/${made2.id}/role`,
          json({ roleId: role.id }, 'PUT'),
        ),
        200,
      );
      await expectJson(
        await fetch(
          `${base}/api/groups/${made2.id}/members/${colleagueId}`,
          json({}, 'PUT'),
        ),
        200,
      );

      const standing = await loadWorkspaceStanding(db, colleagueId, workspaceId);
      assert.ok(standing.rights.has('people.manage'), 'held through the group');
      // And the union never subtracts: they still hold the read-only role's
      // page level from earlier, which the group's null level must not lower
      // (ADR-0026).
      assert.equal(standing.pageLevel, 'viewer');

      const listed = (await roles()).find((one) => one.id === role.id)!;
      assert.equal(listed.groups, 1, 'the list says a group holds it');
    });

    test('a role of another workspace cannot be given to a group here', async () => {
      // Otherwise one workspace's rule reaches into another, which is the
      // boundary that must never leak.
      const other = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by) VALUES ('Elsewhere', $1) RETURNING id`,
        [colleagueId],
      );
      const foreign = await db.query<{ id: string }>(
        `INSERT INTO roles (workspace_id, name, page_level, rights)
         VALUES ($1,'Fremd','admin','{}') RETURNING id`,
        [other.rows[0]!.id],
      );

      const groups = await fetch(`${base}/api/workspaces/${workspaceId}/groups`, {
        headers: { cookie },
      });
      const list = await expectJson<{ groups: Array<{ id: string }> }>(groups, 200);

      const res = await fetch(
        `${base}/api/workspaces/${workspaceId}/groups/${list.groups[0]!.id}/role`,
        json({ roleId: foreign.rows[0]!.id }, 'PUT'),
      );
      assert.equal(res.status, 422);
    });
  },
);
