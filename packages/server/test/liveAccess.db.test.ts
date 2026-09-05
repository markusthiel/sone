/**
 * A change of access, while somebody is connected (ADR-0099).
 *
 * ADR-0098 made a group membership nudge the page tree, and asserted that the
 * nudge arrives. This file asks the question that was not asked: **does the
 * chain work.** The tree is fetched over HTTP, where claims are resolved per
 * request; the documents are served over a WebSocket, where claims were
 * resolved once, at authentication.
 *
 * So the two halves of the application can disagree about who this person is —
 * and the tests below are the two directions of that disagreement. One is a
 * confusing screen. The other is a revocation that has not happened.
 *
 * ADR-0006 rule 1 is that the ACL is re-checked on every document open, and it
 * is: against a snapshot. `SyncServer.revalidateConnection` exists to refresh
 * that snapshot, `revokeAccess` exists to call it for a page — and the only
 * caller of either is the maintenance sweep, every five minutes.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import { SCHEMA_VERSION } from '@sone/core';
import type { Pool } from 'pg';

import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import { SESSION_COOKIE } from '../src/http/auth.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { SyncServer } from '../src/sync/server.js';
import {
  PROTOCOL_VERSION,
  ServerMessage,
  encodeAuth,
  encodeOpen,
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

interface Listed {
  pages: Array<{ id: string; role: string | null }>;
}

describe(
  'access changes reach an open connection (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let http: Server;
    let sync: SyncServer;
    let url: string;
    let base: string;
    const open: TestClient[] = [];

    /** Restricted, so a member reaches it only through a grant (ADR-0089). */
    const SECRET = uuid(1);

    before(async () => {
      db = await getTestPool();

      const router = new Router();
      registerPageRoutes(router, { pool: db } as never);
      http = createServer((req, res) => {
        // The sync server attaches to the same server, so this handler must let
        // an upgrade through untouched.
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });

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
      const port = (http.address() as { port: number }).port;
      url = `ws://127.0.0.1:${port}/sync`;
      base = `http://127.0.0.1:${port}`;
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
        `INSERT INTO pages (id, workspace_id, title, idx, kind, restricted)
         VALUES ($1,$2,'Personalakte','a0','page',true)`,
        [SECRET, fx.workspaceId],
      );
    });

    let cookie = '';

    async function makeMember(email: string): Promise<string> {
      const hash = await hashPassword('correct-horse-battery-staple');
      const user = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1,$2,$3) RETURNING id`,
        [email, email.split('@')[0], hash],
      );
      const userId = user.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, role_id)
         VALUES ($1,$2,'member',(SELECT id FROM roles WHERE key='member'))`,
        [fx.workspaceId, userId],
      );
      return userId;
    }

    async function connectAs(userId: string): Promise<TestClient> {
      const session = await createSession(db, userId, {});
      cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.token)}`;
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

    /** What the tree route says now, which resolves claims per request. */
    async function treeRole(): Promise<string | null | undefined> {
      const res = await fetch(`${base}/api/workspaces/${fx.workspaceId}/pages`, {
        headers: { cookie },
      });
      const body = (await res.json()) as Listed;
      return body.pages.find((one) => one.id === SECRET)?.role;
    }

    /** What the sync connection says now, which resolved claims once. */
    async function canOpen(client: TestClient, requestId: number): Promise<boolean> {
      client.send(encodeOpen(requestId, SECRET));
      const answer = await client.waitFor(
        (m) =>
          (m.type === ServerMessage.OpenAck && m.requestId === requestId) ||
          (m.type === ServerMessage.Error && m.requestId === requestId),
      );
      return answer.type === ServerMessage.OpenAck;
    }

    async function makeGroupWithGrant(role = 'editor'): Promise<string> {
      const group = await db.query<{ id: string }>(
        `INSERT INTO groups (workspace_id, name) VALUES ($1,'Personal') RETURNING id`,
        [fx.workspaceId],
      );
      const groupId = group.rows[0]!.id;
      await db.query(
        `INSERT INTO page_group_permissions (page_id, group_id, role) VALUES ($1,$2,$3)`,
        [SECRET, groupId, role],
      );
      return groupId;
    }

    /**
     * Let the nudge and whatever it sets off finish.
     *
     * Deliberately generous. The point of these tests is what is true a moment
     * after the change, not how fast — and a flake here would read as "the
     * connection caught up", which is the answer they are checking.
     */
    const settle = (ms = 800): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // --- the direction that is a confusing screen --------------------------

    test('a group grant reaches the tree', async () => {
      // First things first: the tree is fetched per request, so this half was
      // never in doubt — and it is worth an assertion, because the rest of the
      // file is about the other half disagreeing with it.
      const anna = await makeMember('anna@example.org');
      await connectAs(anna);
      assert.equal(await treeRole(), undefined, 'restricted, so not there at all yet');

      const groupId = await makeGroupWithGrant();
      await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
        groupId,
        anna,
      ]);

      assert.equal(await treeRole(), 'editor', 'the tree has it');
    });

    test('and the connection can open what the tree offers', async () => {
      /*
       * The chain ADR-0098 did not check. The nudge arrives, the tree redraws
       * with a new entry — and clicking it asks the **sync** connection, whose
       * claims were resolved at authentication and know nothing about a group
       * joined since.
       *
       * A page that appears and refuses to open is worse than one that does not
       * appear: the first reads as a broken application, the second as a
       * permission.
       */
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      const groupId = await makeGroupWithGrant();
      await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
        groupId,
        anna,
      ]);
      await settle();

      assert.equal(await canOpen(client, 1), true);
    });

    test('a grant to the person directly is the same chain', async () => {
      // Not a group thing. The snapshot is the thing, and every kind of grant
      // is in it.
      const anna = await makeMember('anna@example.org');
      const client = await connectAs(anna);

      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'editor')`,
        [SECRET, anna],
      );
      await settle();

      assert.equal(await canOpen(client, 2), true);
    });

    // --- the direction that is a revocation that has not happened ----------

    test('a grant taken away closes the document it opened', async () => {
      /*
       * The half that is not cosmetic.
       *
       * ADR-0006: "Revocation that only affects the next connection is not
       * revocation: an anonymous editor with an open socket would keep
       * writing." `revokeAccess` was written for exactly this and is called by
       * nothing; the only refresh is the maintenance sweep, every five minutes.
       *
       * So somebody removed from a group, or whose grant is withdrawn, keeps
       * the page open and writable — and the person who withdrew it has been
       * told it is done.
       */
      const anna = await makeMember('anna@example.org');
      const groupId = await makeGroupWithGrant();
      await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
        groupId,
        anna,
      ]);

      const client = await connectAs(anna);
      assert.equal(await canOpen(client, 3), true, 'open while they may');

      await db.query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);

      // Told, rather than left to find out: the document is closed on the
      // connection that holds it.
      await client.waitFor((m) => m.type === ServerMessage.Closed);
    });

    test('and a grant lowered says so rather than disconnecting', async () => {
      // A downgrade keeps the document open and tells the client, which is what
      // `RoleChanged` is for — the client turns the editor read-only rather
      // than losing the page mid-sentence.
      const anna = await makeMember('anna@example.org');
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'editor')`,
        [SECRET, anna],
      );
      const client = await connectAs(anna);
      assert.equal(await canOpen(client, 4), true);

      await db.query(
        `UPDATE page_permissions SET role = 'viewer' WHERE page_id = $1 AND user_id = $2`,
        [SECRET, anna],
      );

      const changed = await client.waitFor((m) => m.type === ServerMessage.RoleChanged);
      if (changed.type !== ServerMessage.RoleChanged) return;
      assert.equal(changed.role, 'viewer');
    });

    // --- and what must not set this off ------------------------------------

    test('a rename does not revalidate anybody', async () => {
      /*
       * The cost question. Revalidating a connection loads a page location per
       * open document and resolves a role for each — fine on a permission
       * change, which is rare, and not fine on every rename in the workspace.
       *
       * Checked by its effect rather than by counting queries: after a rename
       * the connection still holds the role it had, including one the database
       * no longer supports. That is a strange thing to assert on purpose, and
       * it is the honest way to say "nothing was re-read".
       */
      const anna = await makeMember('anna@example.org');
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'editor')`,
        [SECRET, anna],
      );
      const client = await connectAs(anna);
      assert.equal(await canOpen(client, 5), true);

      // Change the grant *without* the triggers seeing it, then rename. If a
      // rename revalidated, the stale role would be corrected and a frame sent.
      await db.query(`ALTER TABLE page_permissions DISABLE TRIGGER USER`);
      await db.query(
        `UPDATE page_permissions SET role = 'viewer' WHERE page_id = $1 AND user_id = $2`,
        [SECRET, anna],
      );
      await db.query(`ALTER TABLE page_permissions ENABLE TRIGGER USER`);

      await db.query(`UPDATE pages SET title = 'Anders' WHERE id = $1`, [SECRET]);
      await settle();

      assert.equal(
        client.frames.some((m) => m.type === ServerMessage.RoleChanged),
        false,
        'a rename is not an access change',
      );
    });
  },
);
