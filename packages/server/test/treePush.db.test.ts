/**
 * The tree, while somebody is looking at it (ADR-0096).
 *
 * `usePages` carried the note for months: *"Changes made by other people still
 * arrive on the next refetch rather than live; that needs a workspace-level
 * subscription, which the sync protocol does not have yet."* ADR-0093 gave the
 * protocol a frame with a scope, precisely so the next thing worth nudging
 * would cost no protocol version. This is the next thing.
 *
 * And ADR-0095 added the case that makes it more than a convenience: an entry
 * now carries what it allows, so a permission that changes while somebody is
 * looking leaves a rename field on screen that the server will refuse.
 *
 * The frame is a doorbell, not a letter: it says *something in this workspace
 * changed*, and the tree route — the one place that decides what a person may
 * see — answers the question of what.
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
  'the tree is pushed to (database)',
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
        `INSERT INTO pages (id, workspace_id, title, idx, kind) VALUES ($1,$2,'Die Zahlen','a0','folder')`,
        [id, workspaceId],
      );
    }

    async function makeMember(email: string, workspaceId = fx.workspaceId): Promise<string> {
      const hash = await hashPassword('correct-horse-battery-staple');
      const user = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1,$2,$3) RETURNING id`,
        [email, email.split('@')[0], hash],
      );
      const userId = user.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [workspaceId, userId],
      );
      return userId;
    }

    async function connectAs(
      userId: string,
      workspaceId = fx.workspaceId,
    ): Promise<TestClient> {
      const session = await createSession(db, userId, {});
      const client = await TestClient.connect(url);
      open.push(client);
      client.send(
        encodeAuth({
          protocolVersion: PROTOCOL_VERSION,
          documentSchemaVersion: SCHEMA_VERSION,
          workspaceId,
          sessionToken: session.token,
        }),
      );
      await client.waitForType(ServerMessage.AuthAck);
      return client;
    }

    const settle = (ms = 600): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const pagesNudge = (client: TestClient, atLeast = 1): Promise<unknown> =>
      client.waitFor(
        (m) =>
          m.type === ServerMessage.Notify &&
          m.scope === NotifyScope.Pages &&
          client.frames.filter(
            (one) => one.type === ServerMessage.Notify && one.scope === NotifyScope.Pages,
          ).length >= atLeast,
      );

    const pagesNudges = (client: TestClient): number =>
      client.frames.filter(
        (one) => one.type === ServerMessage.Notify && one.scope === NotifyScope.Pages,
      ).length;

    // --- the four things the tree draws ------------------------------------

    test('a new page reaches everybody with the workspace open', async () => {
      const anna = await makeMember('anna@example.org');
      const bert = await makeMember('bert@example.org');
      const hers = await connectAs(anna);
      const his = await connectAs(bert);

      await makePage(uuid(2));

      await pagesNudge(hers);
      await pagesNudge(his);
    });

    test('so does a rename', async () => {
      // The commonest change of all, and the one the note in `usePages` was
      // about: somebody else's rename never appeared in a tab left open.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET title = 'Umbenannt' WHERE id = $1`, [PAGE]);

      await pagesNudge(client);
    });

    test('and a deletion, which is when the tree is most wrong', async () => {
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`DELETE FROM pages WHERE id = $1`, [PAGE]);

      await pagesNudge(client);
    });

    test('and a permission, which changes what the entry allows', async () => {
      /*
       * The case ADR-0095 named and left: an entry now carries its role, so a
       * grant that arrives while somebody is looking leaves a rename field on
       * screen that the server will refuse. Nothing about the page row changes
       * here at all — the change is in another table entirely.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
        [PAGE, anna],
      );

      await pagesNudge(client);
    });

    // --- and what must stay quiet ------------------------------------------

    test('typing does not ring it', async () => {
      /*
       * The whole design rests on this one.
       *
       * The projection rewrites a page's row on **every flush** — that is every
       * few hundred milliseconds while somebody types — and `last_edited_at`
       * changes each time. A trigger on any update at all would turn one
       * person's typing into a full tree refetch for every other person in the
       * workspace, several times a second.
       *
       * So the trigger compares the columns the tree actually draws, and
       * `last_edited_at` is deliberately not among them: it is on screen, and
       * it is not worth a request per keystroke. The focus refresh still
       * catches it.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      for (let at = 0; at < 5; at++) {
        await db.query(`UPDATE pages SET last_edited_at = now() WHERE id = $1`, [PAGE]);
      }
      await settle();

      assert.equal(pagesNudges(client), 0);
    });

    test('another workspace is not told', async () => {
      // The tree is per workspace, and a doorbell that rings in the next house
      // is a disclosure: it says somebody there is working, right now.
      const anna = await makeMember('anna@example.org');
      const hers = await connectAs(anna);

      const other = await seedWorkspace(db, 'Anderswo');
      const bert = await makeMember('bert@example.org', other.workspaceId);
      const his = await connectAs(bert, other.workspaceId);

      await makePage(uuid(3));
      await pagesNudge(hers);
      await settle();

      assert.equal(pagesNudges(his), 0);
    });

    test('one statement that makes three pages is one nudge', async () => {
      // An import writes a whole subtree. Statement-level, like the inbox's
      // (ADR-0093): a nudge per row would be a full tree refetch per row, for
      // everybody.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         SELECT gen_random_uuid(), $1, t, 'a0', 'page'
           FROM unnest(ARRAY['Eins','Zwei','Drei']) AS t`,
        [fx.workspaceId],
      );

      await pagesNudge(client);
      await settle();

      assert.equal(pagesNudges(client), 1);
    });

    test('an update that changes nothing says nothing', async () => {
      // Setting a title to the title it already has. Real: the projection
      // writes the row wholesale on every flush, so most of its updates are
      // this.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET title = title WHERE id = $1`, [PAGE]);
      await settle();

      assert.equal(pagesNudges(client), 0);
    });

    test('the frame says which list to fetch again, and nothing about the change', async () => {
      /*
       * A doorbell, not a letter (ADR-0093's rule, applied a second time).
       *
       * Naming the page would be worse than useless here: the nudge goes to
       * everybody with the workspace open, and whether any of them may see that
       * page is a question only the tree route answers. Carrying the id would
       * put a restricted page's identity on a wire that reaches people who
       * cannot open it.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await makePage(uuid(4));

      const frame = await pagesNudge(client);
      assert.deepEqual(Object.keys(frame as object).sort(), ['scope', 'type']);
    });
  },
);
