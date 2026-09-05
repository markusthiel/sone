/**
 * The trash, while somebody is looking at it (ADR-0097).
 *
 * The third subject on the frame from ADR-0093, and the one that tests the
 * claim that record made and ADR-0096 repeated: that the next subject would be
 * "a constant and a trigger". It was not quite — a subject also needed a
 * channel, a bus handler and its wiring. So this change makes the claim true
 * first (one workspace channel whose payload names its own scope) and adds the
 * trash to it second.
 *
 * The two scopes overlap on purpose and differ on purpose:
 *
 *   archive, restore   both lists change
 *   permanent delete   the trash, and the tree if the row was still in it
 *   rename, move, icon the tree alone
 *
 * One scope for the pair would mean every rename in the workspace refetching a
 * list it cannot have changed — which is the fault this whole line of work
 * exists to avoid, arriving from the other direction.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import { SCHEMA_VERSION } from '@sone/core';
import type { Pool } from 'pg';

import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import { SyncServer } from '../src/sync/server.js';
import {
  NotifyScope,
  PROTOCOL_VERSION,
  ServerMessage,
  encodeAuth,
} from '../src/sync/protocol.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  testDatabaseUrl,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';
import { TestClient } from './support/syncClient.js';

describe(
  'the trash is pushed to (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let http: Server;
    let sync: SyncServer;
    let url: string;
    const open: TestClient[] = [];

    const PAGE = uuid(1);

    before(async () => {
      db = await getTestPool();
      http = createServer();
      sync = new SyncServer({
        pool: db,
        databaseUrl: testDatabaseUrl(),
        server: http,
        path: '/sync',
        roomLingerMs: 0,
        log: () => {},
      });
      await sync.start();
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const address = http.address();
      if (typeof address === 'object' && address) {
        url = `ws://127.0.0.1:${address.port}/sync`;
      }
    });

    after(async () => {
      await sync.shutdown();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await closeTestPool();
    });

    beforeEach(async () => {
      for (const client of open.splice(0)) client.close();
      await sync.drainRooms();
      await resetDatabase(db);
      fx = await seedWorkspace(db);
      await makePage(PAGE);
    });

    async function makePage(id: string, workspaceId = fx.workspaceId): Promise<void> {
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind) VALUES ($1,$2,'Die Zahlen','a0','page')`,
        [id, workspaceId],
      );
    }

    async function makeMember(email: string): Promise<string> {
      const hash = await hashPassword('correct-horse-battery-staple');
      const user = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1,$2,$3) RETURNING id`,
        [email, email.split('@')[0], hash],
      );
      const userId = user.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [fx.workspaceId, userId],
      );
      return userId;
    }

    async function connectAs(userId: string): Promise<TestClient> {
      const session = await createSession(db, userId, {});
      const client = await TestClient.connect(url);
      open.push(client);
      client.send(
        encodeAuth({
          protocolVersion: PROTOCOL_VERSION,
          documentSchemaVersion: SCHEMA_VERSION,
          workspaceId: fx.workspaceId,
          sessionToken: session.token,
        }),
      );
      await client.waitForType(ServerMessage.AuthAck);
      return client;
    }

    const settle = (ms = 600): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const countOf = (client: TestClient, scope: string): number =>
      client.frames.filter(
        (one) => one.type === ServerMessage.Notify && one.scope === scope,
      ).length;

    const nudge = (client: TestClient, scope: string, atLeast = 1): Promise<unknown> =>
      client.waitFor(
        (m) =>
          m.type === ServerMessage.Notify &&
          m.scope === scope &&
          countOf(client, scope) >= atLeast,
      );

    // --- what puts something in the trash, and takes it out ----------------

    test('archiving reaches everybody with the workspace open', async () => {
      const anna = await makeMember('anna@example.org');
      const bert = await makeMember('bert@example.org');
      const hers = await connectAs(anna);
      const his = await connectAs(bert);

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [PAGE]);

      await nudge(hers, NotifyScope.Trash);
      await nudge(his, NotifyScope.Trash);
    });

    test('archiving is both lists, because it changes both', async () => {
      // It leaves the tree and enters the trash in one act. Two scopes on one
      // change rather than one scope for two lists: the alternative makes every
      // rename refetch the trash.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Trash);
      await nudge(client, NotifyScope.Pages);
    });

    test('restoring is both lists too', async () => {
      const anna = await makeMember('anna@example.org');
      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [PAGE]);
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET archived_at = NULL WHERE id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Trash);
      await nudge(client, NotifyScope.Pages);
    });

    test('emptying it reaches the people watching it empty', async () => {
      /*
       * The case with two people in it: one presses "delete permanently" and
       * the other is looking at the same list. Without this the second one
       * clicks a row that is not there and gets a refusal for something they
       * could not have known.
       */
      const anna = await makeMember('anna@example.org');
      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [PAGE]);
      const client = await connectAs(anna);

      await db.query(`DELETE FROM pages WHERE id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Trash);
    });

    // --- and what the trash must not be woken for --------------------------

    test('a rename is the tree´s business and not the trash´s', async () => {
      /*
       * The whole reason this is a second scope.
       *
       * A rename cannot change what is in the trash, and refetching it anyway
       * would be a request per rename per person with the trash open — the same
       * mistake as nudging the tree on every keystroke (ADR-0096), from the
       * other side.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET title = 'Anders' WHERE id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Pages);
      await settle();

      assert.equal(countOf(client, NotifyScope.Trash), 0);
    });

    test('typing rings neither', async () => {
      // `last_edited_at` is outside the compared columns of both triggers, for
      // the reason ADR-0096 gives: it is on screen and it is not worth a
      // request per keystroke.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      for (let at = 0; at < 5; at++) {
        await db.query(`UPDATE pages SET last_edited_at = now() WHERE id = $1`, [PAGE]);
      }
      await settle();

      assert.equal(countOf(client, NotifyScope.Trash), 0);
      assert.equal(countOf(client, NotifyScope.Pages), 0);
    });

    test('archiving a folder and its subtree is one nudge', async () => {
      /*
       * Archiving is one statement over the page and its descendants — which is
       * exactly the shape statement-level triggers exist for, and the shape
       * that makes a row-level one look correct until somebody deletes a folder
       * with forty pages in it.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);
      await makePage(uuid(2));
      await makePage(uuid(3));

      await db.query(
        `UPDATE pages SET archived_at = now() WHERE workspace_id = $1 AND archived_at IS NULL`,
        [fx.workspaceId],
      );

      await nudge(client, NotifyScope.Trash);
      await settle();

      assert.equal(countOf(client, NotifyScope.Trash), 1);
    });

    test('the frame names its scope and nothing else', async () => {
      // A doorbell, not a letter — the rule from ADR-0093, third application.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [PAGE]);

      const frame = await nudge(client, NotifyScope.Trash);
      assert.deepEqual(Object.keys(frame as object).sort(), ['scope', 'type']);
    });
  },
);
