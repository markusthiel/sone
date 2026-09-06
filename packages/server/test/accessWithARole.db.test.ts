/**
 * Letting somebody in as the role you mean (ADR-0103).
 *
 * Three acts put a role on somebody in a workspace. Two of them speak the whole
 * vocabulary and one speaks three words:
 *
 *   change a member's role   `PUT  …/members/:userId`   `{role}` or `{roleId}`  ✓
 *   what a group carries     `PUT  …/groups/:id/role`   `{roleId}`              ✓
 *   **give access**          `POST …/members`           `'admin'|'member'|'guest'`
 *
 * So a colleague who should hold "Redaktion" is added as a **member** — which
 * is `editor` on every page in the workspace — and moved afterwards. The
 * intermediate state is not a formality: it is the exact thing this rights
 * model exists to avoid, performed as a required step, by the screen whose job
 * is to avoid it.
 *
 * The screen already knows better. `WorkspaceMembers` fetches every role this
 * workspace has, lists them by id in the table (ADR-0087, "a role somebody
 * defined is no less a role"), and ten lines above offers a hardcoded three.
 *
 * Every test here fails before the change, except the two counterweights that
 * say what must not move.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { createSession } from '../src/auth/session.js';
import { registerInvitationRoutes } from '../src/auth/invitationRoutes.js';
import { registerAuthRoutes, SESSION_COOKIE } from '../src/http/auth.js';
import { Router } from '../src/http/router.js';
import { loadWorkspaceStanding } from '../src/auth/standing.js';
import { queryOne } from '../src/db/pool.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

describe(
  'giving access as a role this workspace made (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let server: Server;
    let base: string;
    let cookie: string;
    /** "Redaktion": may write, may not administer anything. */
    let redaktion: string;

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
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
      } as never);
      registerInvitationRoutes(router, { pool: db } as never);

      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);
      const session = await createSession(db, fx.userId, {});
      cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.token)}`;
      redaktion = await roleNamed(fx.workspaceId, 'Redaktion', 'editor', []);
    });

    // --- the act -------------------------------------------------------------

    test('somebody can be let in as a role this workspace made', async () => {
      const anna = await account('anna@example.org');

      const res = await give({ email: 'anna@example.org', roleId: redaktion });
      const body = await expectJson<{ userId: string; roleId: string; roleName: string }>(
        res,
        201,
      );

      assert.equal(body.userId, anna);
      assert.equal(body.roleId, redaktion);
      assert.equal(body.roleName, 'Redaktion', 'named, because a custom role has no word');

      const standing = await loadWorkspaceStanding(db, anna, fx.workspaceId);
      assert.equal(standing.role, null, 'not one of the four');
      assert.equal(standing.pageLevel, 'editor');
      assert.deepEqual([...standing.rights], []);
    });

    test('and never passes through a role nobody chose', async () => {
      /*
       * The reason this is not a convenience.
       *
       * The way to do it today is: add as `member`, then change the role. A
       * member holds `editor` on every page in the workspace — so giving
       * somebody a read-only role has to grant them write access first, for as
       * long as it takes to make the second request, and longer if it fails.
       *
       * Asserted on the row rather than the reply: one statement, one role, and
       * no moment in between.
       */
      const bert = await account('bert@example.org');
      const readOnly = await roleNamed(fx.workspaceId, 'Nur lesen', 'viewer', []);

      await expectStatus(await give({ email: 'bert@example.org', roleId: readOnly }), 201);

      const row = await queryOne<{ role_id: string; is_owner: boolean }>(
        db,
        `SELECT role_id, is_owner FROM workspace_members
          WHERE workspace_id = $1 AND user_id = $2`,
        [fx.workspaceId, bert],
      );
      assert.equal(row?.role_id, readOnly);
      assert.equal(row?.is_owner, false);
    });

    // --- what must not move --------------------------------------------------

    test('one of the four words still works', async () => {
      // The counterweight. Most access given is given as `member`, and the
      // request that does it must not need to learn about ids.
      const cara = await account('cara@example.org');
      await expectStatus(await give({ email: 'cara@example.org', role: 'admin' }), 201);

      const standing = await loadWorkspaceStanding(db, cara, fx.workspaceId);
      assert.equal(standing.role, 'admin');
      assert.equal(standing.isOwner, false, 'admin is not ownership (ADR-0087)');
    });

    test('owner is still not on offer, by word or by id', async () => {
      /*
       * ADR-0073: "A second owner is a decision about who may delete the
       * workspace. It stays a separate act on the row."
       *
       * The word was refused by not being in the list, which is a refusal by
       * omission — and an id is a second door to the same room. Both are named
       * now, and this is the test that says the new door did not open it.
       */
      await account('dana@example.org');
      await expectStatus(await give({ email: 'dana@example.org', role: 'owner' }), 422);

      const ownerRole = await queryOne<{ id: string }>(
        db,
        `SELECT id FROM roles WHERE key = 'owner' AND workspace_id IS NULL`,
      );
      await expectStatus(
        await give({ email: 'dana@example.org', roleId: ownerRole!.id }),
        422,
      );

      const row = await queryOne<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1`,
        [fx.workspaceId],
      );
      assert.equal(row?.n, 1, 'nobody was added');
    });

    // --- the same refusals the sibling route makes ---------------------------

    test('another workspace´s role cannot reach in here', async () => {
      // The rule the group route already states: "anything else would be
      // another workspace's rule reaching in here."
      const elsewhere = await seedWorkspace(db, 'Somewhere else');
      const theirs = await roleNamed(elsewhere.workspaceId, 'Ihre Rolle', 'admin', [
        'people.manage',
      ]);
      await account('emil@example.org');

      await expectStatus(await give({ email: 'emil@example.org', roleId: theirs }), 422);
    });

    test('naming it twice is refused rather than guessed at', async () => {
      // Exactly as `PUT …/members/:userId` refuses it, and for the reason it
      // gives: "two answers to what this person should be is not a thing to
      // guess at."
      await account('fritz@example.org');
      await expectStatus(
        await give({ email: 'fritz@example.org', role: 'member', roleId: redaktion }),
        422,
      );
    });

    test('a role that does not exist is refused, not silently downgraded', async () => {
      await account('gerd@example.org');
      await expectStatus(
        await give({
          email: 'gerd@example.org',
          roleId: '00000000-0000-4000-8000-000000000001',
        }),
        422,
      );
    });

    // --- the role somebody holds is still not deleted underneath them --------

    test('a role given this way counts as held', async () => {
      /*
       * ADR-0087 refuses to delete a role somebody holds and names the number.
       * A person let in through this route holds it exactly as one moved into
       * it does — worth asserting, because "held" is counted by a query that
       * knows nothing about how the row got there, and that is the property
       * being relied on.
       */
      const hans = await account('hans@example.org');
      await expectStatus(await give({ email: 'hans@example.org', roleId: redaktion }), 201);

      const held = await queryOne<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM workspace_members WHERE role_id = $1`,
        [redaktion],
      );
      assert.equal(held?.n, 1);
      assert.ok(hans);
    });

    // --- helpers -------------------------------------------------------------

    function give(input: Record<string, unknown>): Promise<Response> {
      return fetch(`${base}/api/workspaces/${fx.workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(input),
      });
    }

    async function account(email: string): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`,
        [email, email.split('@')[0]],
      );
      return row.rows[0]!.id;
    }

    async function roleNamed(
      workspaceId: string,
      name: string,
      level: string | null,
      rights: string[],
    ): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO roles (workspace_id, key, name, page_level, rights)
         VALUES ($1, NULL, $2, $3, $4) RETURNING id`,
        [workspaceId, name, level, rights],
      );
      return row.rows[0]!.id;
    }
  },
);
