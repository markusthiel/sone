/**
 * The word that four comments said nothing reads (ADR-0102).
 *
 * `workspace_members.role` is the enum ADR-0087 superseded, and migration 0058
 * wrote its epitaph into the database itself:
 *
 *   COMMENT ON COLUMN workspace_members.role IS
 *     'Superseded by role_id and is_owner (ADR-0087). Nothing reads it: ...'
 *
 * The same sentence is in the ADR, in the open-points list, and in a code
 * comment in `invitationRoutes.ts` that goes further — "the column is only read
 * by a server that predates roles being rows".
 *
 * **Two live routes read it**, `/api/auth/session` and `/api/workspaces`, and
 * both hand it to the browser, where three places use it and two of those
 * decide what to offer. Those SELECTs are older than the migration that
 * declared them gone: the sentence was false on the day it was written.
 *
 * And underneath, the two bridges that read the word "only during a rolling
 * deploy" turned out to be what thirty test fixtures were running on — see
 * `addMember` in `support/db.ts`.
 *
 * These tests are what the column costs to remove. Every one fails before the
 * change.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { createSession } from '../src/auth/session.js';
import { registerAuthRoutes, SESSION_COOKIE } from '../src/http/auth.js';
import { registerWorkspaceRoutes } from '../src/http/workspaces.js';
import { Router } from '../src/http/router.js';
import { loadWorkspaceStanding } from '../src/auth/standing.js';
import { queryRows } from '../src/db/pool.js';
import { visiblePagesCondition } from '../src/pages/access.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';
import { expectJson } from './support/http.js';

interface WorkspaceEntry {
  id: string;
  name: string;
  role: string;
  roleName: string | null;
  rights: string[];
  isOwner: boolean;
}

describe(
  'the word nothing was supposed to read (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let server: Server;
    let base: string;

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
      registerWorkspaceRoutes(router, { pool: db } as never);

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
    });

    // --- what the two listings answer ---------------------------------------

    test('the session names the role somebody actually holds', async () => {
      /*
       * A custom role is the case the four-word vocabulary cannot express, and
       * the write path says so out loud: assigning one sets the enum column to
       * `'member'`, because that is "the nearest of the four words".
       *
       * Harmless for a column nothing reads, and a lie on a screen. The person
       * holds "Redaktion"; the settings screen tells them they are a member.
       */
      const { cookie } = await memberWith('Redaktion', 'admin', ['workspace.settings']);
      const entry = await sessionWorkspace(cookie);

      assert.equal(entry.role, 'custom', 'not one of the four words, and not member');
      assert.equal(entry.roleName, 'Redaktion', 'the name they were actually given');
    });

    test('and says what that role lets them do', async () => {
      /*
       * The reason a name is not enough.
       *
       * `WorkspaceSettingsScreen` computes `canEdit` as `role === 'owner' ||
       * role === 'admin' || manages`, and its own comment records fixing this
       * exact fault once already — for an instance administrator, whose
       * controls were disabled while the route would have accepted the save:
       * "the interface was stricter than the rule it was mirroring".
       *
       * The other half was left. The route guards those settings with the
       * `workspace.settings` **right**, and somebody holding it through a
       * custom role gets every control disabled.
       *
       * So the listing carries the rights and the screen asks what the server
       * asks. The same move as ADR-0095, one layer out: the answer was already
       * being computed, and thrown away.
       */
      const { cookie } = await memberWith('Redaktion', 'admin', ['workspace.settings']);
      const entry = await sessionWorkspace(cookie);

      assert.deepEqual(entry.rights, ['workspace.settings']);
      assert.equal(entry.isOwner, false, 'a custom role never carries ownership');
    });

    test('the workspace listing answers the same as the session', async () => {
      // Two routes, one question. They have been kept in step by hand —
      // `WORKSPACE_ORDER_SQL` is shared for exactly that reason — and this is
      // the half that was not.
      const { cookie } = await memberWith('Redaktion', 'editor', ['groups.manage']);

      const fromSession = await sessionWorkspace(cookie);
      const listed = await expectJson<{ workspaces: WorkspaceEntry[] }>(
        await fetch(`${base}/api/workspaces`, { headers: { cookie } }),
      );
      const fromList = listed.workspaces.find((one) => one.id === fx.workspaceId);

      assert.ok(fromList);
      assert.equal(fromList.role, fromSession.role);
      assert.equal(fromList.roleName, fromSession.roleName);
      assert.deepEqual(fromList.rights, fromSession.rights);
    });

    test('a system role still answers by its old name', async () => {
      /*
       * The counterweight, and the thing that must not change.
       *
       * `MoveToWorkspaceDialog` filters destinations by `role === 'owner' ||
       * role === 'admin'`, mirroring what the move route enforces. A cleanup
       * that made an owner stop looking like an owner would empty that list,
       * and it would read as a broken move rather than as a moved word.
       */
      const cookie = await sessionFor(fx.userId);
      const entry = await sessionWorkspace(cookie);

      assert.equal(entry.role, 'owner');
      assert.equal(entry.isOwner, true);
    });

    // --- what replaces the bridges ------------------------------------------

    test('a membership must point at a role', async () => {
      /*
       * What makes the two bridges unnecessary rather than merely unused.
       *
       * They exist because a membership could carry the word and no role row —
       * written by a previous server mid-deploy, or restored from a dump. The
       * migration backfills every such row and then forbids the state, so there
       * is nothing left for a bridge to rescue.
       *
       * A constraint rather than a convention: the previous arrangement was a
       * convention, and thirty test fixtures broke it without anybody noticing
       * for four ADRs.
       */
      const stranger = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ($1,'Bert') RETURNING id`,
        [`bert-${Math.random().toString(36).slice(2)}@example.org`],
      );

      await assert.rejects(
        db.query(
          `INSERT INTO workspace_members (workspace_id, user_id)
           VALUES ($1, $2)`,
          [fx.workspaceId, stranger.rows[0]!.id],
        ),
        /role_id/,
      );
    });

    test('an owner still reaches a restricted page', async () => {
      /*
       * The bridges removed, the resolvers unchanged.
       *
       * Both of them — `loadWorkspaceStanding` and `fullAccessCondition` — read
       * `m.role::text` as a fallback. This is the assertion that says removing
       * them cost nothing, and it is worth more than it looks: until this
       * change `seedWorkspace` wrote only the word, so **this exact path was
       * the fallback** in every test that used the fixture.
       */
      const standing = await loadWorkspaceStanding(db, fx.userId, fx.workspaceId);
      assert.equal(standing.role, 'owner');
      assert.equal(standing.pageLevel, 'admin');
      assert.equal(standing.isOwner, true);

      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind, restricted)
         VALUES (gen_random_uuid(),$1,'Personalakte','a1','page',true)`,
        [fx.workspaceId],
      );
      const seen = await queryRows<{ id: string }>(
        db,
        `SELECT p.id FROM pages p
          WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2')}`,
        [fx.workspaceId, fx.userId],
      );
      assert.equal(seen.length, 1, 'and the listing condition agrees');
    });

    // --- the schema ----------------------------------------------------------

    test('the column is gone', async () => {
      // The point of the exercise, and the one assertion that cannot pass by
      // accident. `sqlColumns.db.test.ts` catches a reference left behind, and
      // it can only do that once the column is really absent.
      const rows = await queryRows<{ column_name: string }>(
        db,
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'workspace_members' AND column_name = 'role'`,
      );
      assert.deepEqual(rows, []);
    });

    test('and the enum type stays, because invitations still mean it', async () => {
      /*
       * Not an oversight. `invitations.role` names one of the four words and is
       * read on every acceptance; an invitation cannot offer a custom role
       * today, because there is no screen for it and no column to hold one. The
       * type is carrying a real meaning there rather than a leftover.
       *
       * Asserted rather than assumed, so "the enum is gone" cannot be read off
       * this change as more than it is.
       */
      const rows = await queryRows<{ typname: string }>(
        db,
        `SELECT typname FROM pg_type WHERE typname = 'workspace_role'`,
      );
      assert.equal(rows.length, 1);
    });

    // --- helpers ------------------------------------------------------------

    /** Somebody holding a custom role, and a cookie for them. */
    async function memberWith(
      name: string,
      level: string | null,
      rights: string[],
    ): Promise<{ userId: string; cookie: string }> {
      const user = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ($1,'Anna') RETURNING id`,
        [`anna-${Math.random().toString(36).slice(2)}@example.org`],
      );
      const userId = user.rows[0]!.id;
      const role = await db.query<{ id: string }>(
        `INSERT INTO roles (workspace_id, key, name, page_level, rights)
         VALUES ($1, NULL, $2, $3, $4) RETURNING id`,
        [fx.workspaceId, name, level, rights],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id)
         VALUES ($1,$2,$3)`,
        [fx.workspaceId, userId, role.rows[0]!.id],
      );
      return { userId, cookie: await sessionFor(userId) };
    }

    async function sessionFor(userId: string): Promise<string> {
      const session = await createSession(db, userId, {});
      return `${SESSION_COOKIE}=${encodeURIComponent(session.token)}`;
    }

    async function sessionWorkspace(cookie: string): Promise<WorkspaceEntry> {
      const body = await expectJson<{ workspaces: WorkspaceEntry[] }>(
        await fetch(`${base}/api/auth/session`, { headers: { cookie } }),
      );
      const entry = body.workspaces.find((one) => one.id === fx.workspaceId);
      assert.ok(entry, 'the workspace is in the session listing');
      return entry;
    }
  },
);
