/**
 * The shares screen, while somebody is looking at it (ADR-0098).
 *
 * The fourth subject on the notify frame, and the first one that cost what
 * ADR-0093 promised and ADR-0097 finally made true: a constant and a trigger.
 * There is no new channel here, no bus handler and no wiring — which is the
 * whole claim, and the reason this file is mostly about *which* changes belong
 * to this list rather than about how one reaches a client.
 *
 * The lists (ADR-0088): links, what this person granted, what was granted to
 * them. So the changes that matter are a link created or revoked, a grant given
 * or taken away, and — the one that is easy to miss — somebody joining or
 * leaving a **group**, because a group grant reaches its members.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import { SCHEMA_VERSION } from '@sone/core';
import type { Pool } from 'pg';

import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import { createShareLink, revokeShareLink } from '../src/auth/share.js';
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
  'the shares screen is pushed to (database)',
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
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         VALUES ($1,$2,'Die Zahlen','a0','page')`,
        [PAGE, fx.workspaceId],
      );
    });

    async function makeMember(email: string): Promise<string> {
      const hash = await hashPassword('correct-horse-battery-staple');
      const user = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1,$2,$3) RETURNING id`,
        [email, email.split('@')[0], hash],
      );
      const userId = user.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
       VALUES ($1,$2,(SELECT id FROM roles WHERE key = 'member' AND workspace_id IS NULL), false)`,
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

      /*
       * Drain what the fixture set off before counting anything (ADR-0102).
       *
       * `makeMember` inserts a membership, and a membership insert is an access
       * change: it nudges `pages` for the whole workspace, on purpose. That
       * nudge crosses the bus while this connection is being made, so it could
       * land either side of the AuthAck — and the three tests that assert a
       * scope was **not** nudged count every frame the connection ever saw.
       *
       * Which made them pass because the timing usually went one way. An
       * absence assertion that depends on a race is the assertion most worth
       * making deterministic: the day it goes red it will be read as a flake.
       */
      await settle();
      client.forget();
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

    // --- links -------------------------------------------------------------

    test('a link created reaches the screen that lists links', async () => {
      /*
       * The list that matters most of the three, for the reason ADR-0088 put it
       * first: a link is the only kind of share that has already left the
       * building, and it can be created by anybody who may manage the page.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await createShareLink(db, {
        pageId: PAGE,
        role: 'viewer',
        includeSubtree: false,
        createdBy: fx.userId,
      });

      await nudge(client, NotifyScope.Shares);
    });

    test('and a link revoked, which is the one somebody is watching for', async () => {
      const anna = await makeMember('anna@example.org');
      const link = await createShareLink(db, {
        pageId: PAGE,
        role: 'viewer',
        includeSubtree: false,
        createdBy: fx.userId,
      });
      const client = await connectAs(anna);

      await revokeShareLink(db, link.shareTokenId);

      /*
       * A note from getting this wrong: the first version passed `link.id`,
       * which does not exist — so the UPDATE matched no rows, the transition
       * table was empty, and nothing was sent. It read exactly like a missing
       * trigger, and it was the "an empty statement says nothing" property
       * working (ADR-0093). Worth remembering when one of these files reports
       * silence: check that the statement changed anything first.
       */
      await nudge(client, NotifyScope.Shares);
    });

    test('a link is not the tree´s business', async () => {
      // A link changes nothing a member's page tree draws. Nudging it would be
      // a full tree refetch, for everybody, for a row on a different screen.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await createShareLink(db, {
        pageId: PAGE,
        role: 'viewer',
        includeSubtree: false,
        createdBy: fx.userId,
      });

      await nudge(client, NotifyScope.Shares);
      await settle();

      assert.equal(countOf(client, NotifyScope.Pages), 0);
    });

    // --- grants ------------------------------------------------------------

    test('a grant is both screens, because it changes both', async () => {
      /*
       * It appears in "granted" and in the other person's "received", and it
       * changes what their tree shows and what each entry allows (ADR-0095). So
       * both scopes, on one change — the same shape as archiving.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
        [PAGE, anna],
      );

      await nudge(client, NotifyScope.Shares);
      await nudge(client, NotifyScope.Pages);
    });

    test('a grant taken away is announced as loudly as one given', async () => {
      // The direction somebody is more likely to be watching, and the one an
      // insert-only trigger would have missed.
      const anna = await makeMember('anna@example.org');
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
        [PAGE, anna],
      );
      const client = await connectAs(anna);

      await db.query(`DELETE FROM page_permissions WHERE page_id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Shares);
    });

    // --- the one that is easy to miss --------------------------------------

    test('joining a group changes what was granted to you', async () => {
      /*
       * "received" lists group grants with "via the group X" (ADR-0088),
       * because "why do I have this" is the question somebody has. So a
       * membership is a share, and joining one changes the list.
       *
       * It also changes their **tree**, and nothing nudged that either — a gap
       * in ADR-0096's trigger set that this test is what found. A group grant
       * reaches its members, so being added to a group is being given pages.
       */
      const anna = await makeMember('anna@example.org');
      const group = await db.query<{ id: string }>(
        `INSERT INTO groups (workspace_id, name) VALUES ($1,'Redaktion') RETURNING id`,
        [fx.workspaceId],
      );
      const groupId = group.rows[0]!.id;
      await db.query(
        `INSERT INTO page_group_permissions (page_id, group_id, role) VALUES ($1,$2,'editor')`,
        [PAGE, groupId],
      );
      const client = await connectAs(anna);

      await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
        groupId,
        anna,
      ]);

      await nudge(client, NotifyScope.Shares);
      await nudge(client, NotifyScope.Pages);
    });

    test('and leaving one changes it back', async () => {
      const anna = await makeMember('anna@example.org');
      const group = await db.query<{ id: string }>(
        `INSERT INTO groups (workspace_id, name) VALUES ($1,'Redaktion') RETURNING id`,
        [fx.workspaceId],
      );
      const groupId = group.rows[0]!.id;
      await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
        groupId,
        anna,
      ]);
      const client = await connectAs(anna);

      await db.query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);

      await nudge(client, NotifyScope.Shares);
    });

    // --- what takes a row off the screen without anybody sharing anything ---

    test('archiving a shared page takes it off all three lists', async () => {
      /*
       * Every one of the three queries ends `AND p.archived_at IS NULL`. So
       * archiving removes rows from a screen nobody touched — and a row left
       * behind is a row somebody clicks and gets a refusal for.
       */
      const anna = await makeMember('anna@example.org');
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
        [PAGE, anna],
      );
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Shares);
    });

    test('so does deleting it', async () => {
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`DELETE FROM pages WHERE id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Shares);
    });

    // --- and what must stay quiet ------------------------------------------

    test('a rename is not a change to who may see it', async () => {
      /*
       * The screen shows a page's title, so a rename does make one row read
       * differently — and nudging on it would be a request per rename per
       * person with the screen open, for a word. The focus refresh catches it,
       * which is what the focus refresh is for.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(`UPDATE pages SET title = 'Anders' WHERE id = $1`, [PAGE]);

      await nudge(client, NotifyScope.Pages);
      await settle();

      assert.equal(countOf(client, NotifyScope.Shares), 0);
    });

    test('typing rings none of the three', async () => {
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      for (let at = 0; at < 5; at++) {
        await db.query(`UPDATE pages SET last_edited_at = now() WHERE id = $1`, [PAGE]);
      }
      await settle();

      assert.equal(countOf(client, NotifyScope.Shares), 0);
      assert.equal(countOf(client, NotifyScope.Trash), 0);
      assert.equal(countOf(client, NotifyScope.Pages), 0);
    });

    test('one statement granting three pages is one nudge', async () => {
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         SELECT gen_random_uuid(), $1, t, 'a0', 'page'
           FROM unnest(ARRAY['Eins','Zwei','Drei']) AS t`,
        [fx.workspaceId],
      );
      await nudge(client, NotifyScope.Pages);

      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role)
         SELECT id, $2, 'viewer' FROM pages WHERE workspace_id = $1`,
        [fx.workspaceId, anna],
      );

      await nudge(client, NotifyScope.Shares);
      await settle();

      assert.equal(countOf(client, NotifyScope.Shares), 1);
    });
  },
);
