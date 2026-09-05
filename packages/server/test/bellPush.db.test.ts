/**
 * The bell, while you are looking at it (ADR-0093).
 *
 * ADR-0092 moved the badge onto the inbox icon and made it count the list the
 * inbox already holds, refreshed on `focus`. It named the residual gap in the
 * same breath: **the badge still does not appear while somebody is staring at
 * the page.** This is that gap.
 *
 * Every test here goes through the whole path — a row in `notifications`, the
 * trigger, LISTEN/NOTIFY, the bus, the connection index, the frame — because
 * that path has seven joints and each of the previous rounds of bugs lived in
 * exactly one of them. A test that called the server's own send method would
 * assert that a wire exists, which is the thing this codebase has already
 * learned twice is not a test (ADR-0091).
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  SCHEMA_VERSION,
  addMessage,
  addThread,
} from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import { createShareLink } from '../src/auth/share.js';
import { withTransaction } from '../src/db/pool.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
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
  'the bell is pushed to (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let http: Server;
    let sync: SyncServer;
    let url: string;
    const open: TestClient[] = [];

    before(async () => {
      db = await getTestPool();
      http = createServer();
      sync = new SyncServer({
        // This file's own database, for both the pool and the bus — the
        // mistake that hid the whole cross-instance mechanism for a year
        // (ADR-0076) and would hide this one just as completely.
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

    const PAGE = uuid(1);

    async function makePage(id: string): Promise<void> {
      const doc = new Y.Doc();
      doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
      const page = doc.getMap(DOC_KEYS.page);
      page.set(PAGE_KEYS.title, 'Die Zahlen');
      page.set(PAGE_KEYS.idx, 'a0');
      page.set(PAGE_KEYS.parentPageId, null);
      await withTransaction(db, (client) =>
        materializeYDoc(client, id, doc, { throughSeq: 1, workspaceId: fx.workspaceId }),
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

    /** One notification, written the way the projection writes them. */
    async function notify(
      userId: string,
      messageId = 'm1',
    ): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO notifications
           (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt)
         VALUES ($1,$2,$3,'mention','t1',$4,'schau mal') RETURNING id`,
        [userId, fx.workspaceId, PAGE, messageId],
      );
      return row.rows[0]!.id;
    }

    /**
     * Let anything that was going to arrive, arrive.
     *
     * The assertions about *absence* need this: "nothing came" is only worth
     * asserting after the moment when something would have. Generous, because a
     * flake here would read as "the push works" and is the one failure this
     * file could not afford.
     */
    const settle = (ms = 600): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // --- the gap ADR-0092 named ------------------------------------------

    test('a notification written while somebody is connected reaches them', async () => {
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await notify(anna);

      const frame = await client.waitForType(ServerMessage.Notify);
      assert.equal(frame.type, ServerMessage.Notify);
      if (frame.type !== ServerMessage.Notify) return;
      assert.equal(frame.scope, NotifyScope.Inbox);
    });

    test('the frame carries no count and no content', async () => {
      /*
       * The whole design, asserted as a shape.
       *
       * A count on the wire is a second answer to a question the inbox's own
       * list already answers, and two answers to one question is precisely how
       * the badge and the list came to disagree (ADR-0092). An excerpt would be
       * worse: it would put somebody's sentence in a frame sent to every one of
       * their open tabs, past whatever the inbox route decides they may see.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);
      await notify(anna);

      const frame = await client.waitForType(ServerMessage.Notify);
      assert.deepEqual(Object.keys(frame).sort(), ['scope', 'type']);
    });

    test('nobody else is told', async () => {
      // The one mistake here that would be a disclosure rather than a bug: an
      // inbox is the only list in SONE that is per person (ADR-0052), and a
      // nudge sent to the wrong person tells them somebody was addressed.
      const anna = await makeMember('anna@example.org');
      const bert = await makeMember('bert@example.org');
      const hers = await connectAs(anna);
      const his = await connectAs(bert);

      await notify(anna);
      await hers.waitForType(ServerMessage.Notify);
      await settle();

      assert.equal(his.countOfType(ServerMessage.Notify), 0);
    });

    test('both of somebody´s tabs are told', async () => {
      // A person is not a connection. The phone in their hand and the tab on
      // their desk are two, and a badge that appears on one of them is the bug
      // this replaces wearing a different hat.
      const anna = await makeMember('anna@example.org');
      const desk = await connectAs(anna);
      const phone = await connectAs(anna);

      await notify(anna);

      await desk.waitForType(ServerMessage.Notify);
      await phone.waitForType(ServerMessage.Notify);
    });

    test('a share-link visitor is never sent one', async () => {
      /*
       * They have no account and therefore no inbox (ADR-0046), so there is
       * nothing to nudge — and the index must not hold them under some
       * placeholder key, which is the shape the guest bugs of ADR-0091 and
       * ADR-0092 both had.
       */
      const anna = await makeMember('anna@example.org');
      const link = await createShareLink(db, {
        pageId: PAGE,
        role: 'viewer',
        includeSubtree: false,
        createdBy: fx.userId,
      });

      const guest = await TestClient.connect(url);
      open.push(guest);
      guest.send(
        encodeAuth({
          protocolVersion: PROTOCOL_VERSION,
          documentSchemaVersion: SCHEMA_VERSION,
          workspaceId: fx.workspaceId,
          shareToken: link.token,
          displayName: 'Lars',
        }),
      );
      await guest.waitForType(ServerMessage.AuthAck);

      await notify(anna);
      await settle();

      assert.equal(guest.countOfType(ServerMessage.Notify), 0);
    });

    // --- the other two directions the count moves -------------------------

    test('a notification whose thread was deleted is a nudge too', async () => {
      // The projection removes these (ADR-0092). A badge that only ever counts
      // up is a badge that lies in the direction people notice least.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);
      const id = await notify(anna);
      await client.waitForType(ServerMessage.Notify);

      await db.query(`DELETE FROM notifications WHERE id = $1`, [id]);

      // The second one: the first was the insert.
      await client.waitFor(
        (m) => m.type === ServerMessage.Notify && client.countOfType(ServerMessage.Notify) >= 2,
      );
    });

    test('marking one read on the phone moves the badge on the desk', async () => {
      const anna = await makeMember('anna@example.org');
      const desk = await connectAs(anna);
      const id = await notify(anna);
      await desk.waitForType(ServerMessage.Notify);

      await db.query(`UPDATE notifications SET read_at = now() WHERE id = $1`, [id]);

      await desk.waitFor(
        (m) => m.type === ServerMessage.Notify && desk.countOfType(ServerMessage.Notify) >= 2,
      );
    });

    test('one statement that writes three rows is one nudge', async () => {
      /*
       * Per statement, not per row.
       *
       * A projection can write a mention for the same person in several blocks
       * at once, and a nudge per row would be several refetches of one list for
       * one edit. The trigger is statement-level over a transition table for
       * exactly this — and this is the assertion that keeps it that way, since
       * a row-level trigger passes every other test in this file.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(
        `INSERT INTO notifications
           (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt)
         SELECT $1, $2, $3, 'mention', 't1', m, 'schau mal'
           FROM unnest(ARRAY['m1','m2','m3']) AS m`,
        [anna, fx.workspaceId, PAGE],
      );

      await client.waitForType(ServerMessage.Notify);
      await settle();

      assert.equal(client.countOfType(ServerMessage.Notify), 1);
    });

    test('the mail job stamping a row is not a change to the screen', async () => {
      /*
       * `emailed_at` says the digest has gone out (ADR-0058). Nothing about it
       * moves a badge, and the job stamps every row it sent in one sweep — so a
       * trigger that fired on any update at all would wake every person with a
       * tab open, nightly, for nothing.
       *
       * This is why the update trigger compares the rows rather than naming
       * columns: Postgres will not take a column list beside a transition
       * table, and comparing is the stricter check of the two anyway.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);
      const id = await notify(anna);
      await client.waitForType(ServerMessage.Notify);

      await db.query(`UPDATE notifications SET emailed_at = now() WHERE id = $1`, [id]);
      await settle();

      assert.equal(client.countOfType(ServerMessage.Notify), 1, 'the insert, and no more');
    });

    test('marking a row read twice is one nudge', async () => {
      // The second UPDATE sets the column to what it already held. Real: the
      // inbox marks read optimistically and the reply route marks read again on
      // the server (ADR-0076), so the same row is written twice by one act.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);
      const id = await notify(anna);
      await client.waitForType(ServerMessage.Notify);

      await db.query(`UPDATE notifications SET read_at = now() WHERE id = $1`, [id]);
      await client.waitFor(
        (m) => m.type === ServerMessage.Notify && client.countOfType(ServerMessage.Notify) >= 2,
      );

      await db.query(
        `UPDATE notifications SET read_at = read_at WHERE id = $1`,
        [id],
      );
      await settle();

      assert.equal(client.countOfType(ServerMessage.Notify), 2);
    });

    test('a statement that changes nothing says nothing', async () => {
      /*
       * The projection runs its "delete notifications whose thread has gone"
       * sweep on **every** rewrite of a page (ADR-0092), which is every
       * keystroke that triggers a flush. If an empty sweep nudged, every person
       * with an open tab would refetch their inbox on somebody else's typing.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`DELETE FROM notifications WHERE page_id = $1`, [PAGE]);
      await settle();

      assert.equal(client.countOfType(ServerMessage.Notify), 0);
    });

    // --- and the real path ------------------------------------------------

    test('a comment reply reaches the bell without anybody touching the window', async () => {
      /*
       * The end-to-end case, and the reason the others are not enough: the
       * notification is written **inside the projection's transaction**, and
       * NOTIFY is transactional — it is delivered at commit and discarded on a
       * rollback. That is a property worth depending on and therefore worth
       * asserting, not least because the last round's worst fault was a
       * projection that rolled back for ever (ADR-0092).
       */
      const anna = await makeMember('anna@example.org');
      const bert = await makeMember('bert@example.org');
      const client = await connectAs(anna);

      const doc = new Y.Doc();
      doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
      const page = doc.getMap(DOC_KEYS.page);
      page.set(PAGE_KEYS.title, 'Die Zahlen');
      page.set(PAGE_KEYS.idx, 'a0');
      page.set(PAGE_KEYS.parentPageId, null);

      addThread(doc, {
        id: 't1',
        from: new Uint8Array(),
        to: new Uint8Array(),
        quote: 'die Zahlen',
        messageId: 'm1',
        author: anna,
        text: 'Was meint ihr?',
      });
      // Bert answers, so Anna is told — the reply case, which is the one that
      // was throwing `22P02` a week ago (ADR-0092).
      addMessage(doc, 't1', { id: 'm2', author: bert, text: 'Ich finde es gut.' });

      await withTransaction(db, (tx) =>
        materializeYDoc(tx, PAGE, doc, { throughSeq: 2, workspaceId: fx.workspaceId }),
      );

      const frame = await client.waitForType(ServerMessage.Notify);
      if (frame.type !== ServerMessage.Notify) return;
      assert.equal(frame.scope, NotifyScope.Inbox);
    });
  },
);
