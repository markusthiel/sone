/**
 * Client end-to-end tests.
 *
 * A real SoneClient against a real SyncServer against a real Postgres. This is
 * the first test in the project that exercises the whole stack, and it is
 * where the client's handshake is actually proven rather than asserted about.
 *
 * Requires SONE_TEST_DATABASE_URL; skips without it.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  appendBlocks,
  readBlockTree,
} from '@sone/core';
import { Pool } from 'pg';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { SoneClient } from '../src/client.js';
import type { SocketLike } from '../src/connection.js';

const BASE_DATABASE_URL = process.env['SONE_TEST_DATABASE_URL'];
const hasDatabase = Boolean(BASE_DATABASE_URL);

/**
 * This suite's own database.
 *
 * Node's test runner runs files in parallel, so a suite that migrates and
 * truncates a shared database fights every other suite doing the same — see
 * the note in the server harness. Own database, own problems.
 */
const DATABASE_NAME = 'sone_t_client_e2e';

function urlForDatabase(name: string): string {
  const url = new URL(BASE_DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

const TEST_DATABASE_URL = hasDatabase ? urlForDatabase(DATABASE_NAME) : undefined;

async function recreateDatabase(): Promise<void> {
  const { Client } = await import('pg');
  const admin = new Client({ connectionString: urlForDatabase('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${DATABASE_NAME}"`);
    await admin.query(`CREATE DATABASE "${DATABASE_NAME}"`);
  } finally {
    await admin.end().catch(() => {});
  }
}

/** `ws` matches the browser API closely enough to satisfy SocketLike. */
const socketFactory = (url: string): SocketLike => {
  const socket = new WebSocket(url) as unknown as SocketLike;
  socket.binaryType = 'arraybuffer';
  return socket;
};

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Kill the underlying socket without telling the client to close.
 *
 * Simulates a network drop, which is the case that matters: a deliberate close
 * does not reconnect, so testing reconnection requires the socket to die out
 * from under the client. Code 4000 because reserved codes such as 1006 cannot
 * be sent by an endpoint.
 */
function dropSocket(client: SoneClient): void {
  const socket = (client.connection as unknown as { socket: SocketLike | null }).socket;
  socket?.close(4000, 'simulated drop');
}

/**
 * Wait for a condition, failing with context rather than a bare timeout.
 *
 * Accepts async predicates so a test can poll the database directly. Polling
 * rather than sleeping a fixed amount matters here: the server persists on a
 * debounce (ADR-0012), so a fixed sleep is either flaky or slow.
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('client end to end', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let http: Server;
  let url: string;
  let workspaceId: string;
  let userId: string;
  let sessionToken: string;
  // Imported lazily so this file does not pull the server package in when the
  // suite is skipped.
  let serverModules: {
    SyncServer: typeof import('@sone/server/src/sync/server.js').SyncServer;
  };
  let sync: import('@sone/server/src/sync/server.js').SyncServer;
  const clients: SoneClient[] = [];

  before(async () => {
    await recreateDatabase();
    db = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });

    const [{ SyncServer }, { migrate }] = await Promise.all([
      import('@sone/server/src/sync/server.js'),
      import('@sone/server/src/db/migrate.js'),
    ]);
    serverModules = { SyncServer };
    await migrate(db, new URL('../../../db/migrations', import.meta.url).pathname, () => {});

    http = createServer();
    sync = new serverModules.SyncServer({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
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
    for (const client of clients) client.close();
    await sync.shutdown();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await db.end();
  });

  beforeEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await sync.drainRooms();
    await db.query(`
      DO $$
      DECLARE tables text;
      BEGIN
        SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO tables
          FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> 'schema_migrations';
        IF tables IS NOT NULL THEN
          EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
        END IF;
      END $$;
    `);
    await db.query(`SELECT setval('doc_update_seq', 1, false)`);

    const { hashPassword } = await import('@sone/server/src/auth/password.js');
    const { createSession } = await import('@sone/server/src/auth/session.js');

    const hash = await hashPassword('correct-horse-battery-staple');
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('e2e@example.org','E2E',$1) RETURNING id`,
      [hash],
    );
    userId = user.rows[0]!.id;

    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('E2E', $1) RETURNING id`,
      [userId],
    );
    workspaceId = ws.rows[0]!.id;
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`,
      [workspaceId, userId],
    );

    sessionToken = (await createSession(db, userId)).token;
  });

  // --- helpers -------------------------------------------------------------

  /**
   * Create a page.
   *
   * Writes the CRDT log *and* the projection. Writing only the projection
   * produces a page row whose document is empty, because the CRDTs are the
   * truth and the projection is derived (ADR-0002) — a mistake this helper made
   * on its first attempt, and one an importer could easily repeat.
   */
  async function seedPage(pageId: string, title: string): Promise<void> {
    const { withTransaction } = await import('@sone/server/src/db/pool.js');
    const { materializeYDoc } = await import(
      '@sone/server/src/materialize/materialize.js'
    );
    const { appendUpdate } = await import('@sone/server/src/doc/docStore.js');

    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, title);
    page.set(PAGE_KEYS.idx, 'a0');
    page.set(PAGE_KEYS.parentPageId, null);

    const seq = await appendUpdate(db, pageId, Y.encodeStateAsUpdate(doc), null);
    await withTransaction(db, (client) =>
      materializeYDoc(client, pageId, doc, { throughSeq: seq, workspaceId }),
    );
    doc.destroy();
  }

  /**
   * @returns the client, plus the history of its connection states.
   *
   * History rather than polling: reconnection is fast enough that the
   * 'reconnecting' state can begin and end between two polls, which made the
   * first version of the reconnect tests flaky in one direction and
   * false-passing in the other.
   */
  function makeClient(
    overrides: Partial<ConstructorParameters<typeof SoneClient>[0]> = {},
  ): SoneClient & { states: string[] } {
    const states: string[] = [];
    const client = new SoneClient({
      url,
      credentials: { workspaceId, sessionToken },
      socketFactory,
      pingIntervalMs: 0,
      baseBackoffMs: 20,
      ...overrides,
      onStateChange: (state) => {
        states.push(state);
        (overrides as { onStateChange?: (s: string) => void }).onStateChange?.(state);
      },
    });
    clients.push(client);
    return Object.assign(client, { states });
  }

  // --- connection ----------------------------------------------------------

  test('connects and reaches ready', async () => {
    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready state');
    assert.equal(client.connection.authAck?.workspaceRole, 'owner');
  });

  test('an invalid session token is fatal, not retried forever', async () => {
    const fatals: string[] = [];
    const client = makeClient({
      credentials: { workspaceId, sessionToken: 'nonsense' },
      onFatal: (code) => fatals.push(code),
    });
    client.connect();
    await waitFor(() => fatals.length > 0, 'a fatal error');
    assert.deepEqual(fatals, ['auth_failed']);
    assert.equal(client.state, 'closed');
  });

  test('a browser authenticates with the session cookie alone', async () => {
    // The session cookie is HttpOnly, so JavaScript cannot read it to put in
    // the auth message. It does travel with the WebSocket upgrade request,
    // which is where the server reads it. Making the cookie readable to send
    // it explicitly would hand any XSS a usable credential.
    await seedPage(uuid(1), 'Cookie auth');

    const client = new SoneClient({
      url,
      // No sessionToken and no shareToken.
      credentials: { workspaceId },
      socketFactory: (target) => {
        const socket = new WebSocket(target, {
          headers: { cookie: `sone_session=${encodeURIComponent(sessionToken)}` },
        }) as unknown as SocketLike;
        socket.binaryType = 'arraybuffer';
        return socket;
      },
      pingIntervalMs: 0,
    });
    clients.push(client);
    client.connect();

    await waitFor(() => client.state === 'ready', 'ready via cookie');
    assert.equal(client.connection.authAck?.workspaceRole, 'owner');

    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.status === 'synced', 'synced');
    assert.equal(
      handle.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title),
      'Cookie auth',
    );
  });

  test('no credential at all is refused', async () => {
    const fatals: string[] = [];
    const client = makeClient({
      credentials: { workspaceId },
      socketFactory: (target) => {
        // No cookie header either.
        const socket = new WebSocket(target) as unknown as SocketLike;
        socket.binaryType = 'arraybuffer';
        return socket;
      },
      onFatal: (code) => fatals.push(code),
    });
    client.connect();
    await waitFor(() => fatals.length > 0, 'a fatal error');
    assert.deepEqual(fatals, ['auth_failed']);
  });

  // --- server-side edits reaching a connected client -----------------------

  /**
   * The reported symptom: renaming a page did not show up in the sidebar, and
   * pages sat at "Opening…" forever.
   *
   * A rename goes through the HTTP API, which writes the CRDT document directly
   * rather than through a sync room. For a client that already has the page
   * open, that update has to travel five hops: appendUpdate inserts into
   * doc_updates, a database trigger fires NOTIFY, the update bus delivers it,
   * the room applies it, the room fans it out.
   *
   * Nothing covered that whole path, which is exactly the sort of chain where
   * one missing link produces "nothing happens" with no error anywhere.
   */
  test('a rename made on the server reaches a connected client', async () => {
    const pageId = uuid(900);
    await seedPage(pageId, 'Before');

    const client = makeClient({});
    client.connect();
    await waitFor(() => client.state === 'ready', 'client ready');

    const handle = client.openPage(pageId);
    await waitFor(() => handle.status === 'synced', 'document synced');
    assert.equal(
      handle.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title),
      'Before',
      'the client should see the seeded title',
    );

    // Exactly what the HTTP rename route does.
    const { applyToDocument } = await import('@sone/server/src/doc/docStore.js');
    const result = await applyToDocument(
      db,
      pageId,
      (doc) => {
        doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'After');
      },
      null,
    );
    assert.equal(result.changed, true, 'the server-side edit must produce a delta');

    await waitFor(
      () => handle.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title) === 'After',
      'the rename to reach the connected client',
    );
  });

  test('a block added on the server reaches a connected client', async () => {
    // Page content was also reported as not arriving, so the same path is
    // checked for the block tree rather than only for a map key.
    const pageId = uuid(901);
    await seedPage(pageId, 'Content page');

    const client = makeClient({});
    client.connect();
    await waitFor(() => client.state === 'ready', 'client ready');
    const handle = client.openPage(pageId);
    await waitFor(() => handle.status === 'synced', 'document synced');

    const { applyToDocument } = await import('@sone/server/src/doc/docStore.js');
    await applyToDocument(
      db,
      pageId,
      (doc) => {
        const fragment = doc.getXmlFragment(DOC_KEYS.content);
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.setAttribute('id', uuid(902));
        paragraph.insert(0, [new Y.XmlText('added on the server')]);
        fragment.insert(fragment.length, [paragraph]);
      },
      null,
    );

    await waitFor(
      () =>
        handle.doc
          .getXmlFragment(DOC_KEYS.content)
          .toString()
          .includes('added on the server'),
      'the new block to reach the connected client',
    );
  });


  // --- documents -----------------------------------------------------------

  test('opens a page and syncs its existing content', async () => {
    // The handshake test. A client that only answers the server's step 1 stays
    // empty, which is the bug this proves is fixed.
    await seedPage(uuid(1), 'Seeded title');

    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');

    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.status === 'synced', `synced, got ${handle.status}`);

    assert.equal(handle.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title), 'Seeded title');
    // The seeded user is the workspace owner, which maps to admin on a page.
    assert.equal(handle.role, 'admin');
    assert.equal(handle.canEdit, true);
  });

  test('an edit reaches the server and is materialised', async () => {
    await seedPage(uuid(1), 'Before');

    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');
    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.status === 'synced', 'synced');

    handle.doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'After');
    appendBlocks(handle.doc, [
      { id: uuid(11), type: 'paragraph', text: 'written by the client' },
    ]);

    await waitFor(async () => {
      const rows = await db.query<{ title: string }>(
        `SELECT title FROM pages WHERE id = $1`,
        [uuid(1)],
      );
      return rows.rows[0]?.title === 'After';
    }, 'the edit to be materialised');

    const blocks = await db.query<{ plain_text: string }>(
      `SELECT plain_text FROM blocks WHERE page_id = $1`,
      [uuid(1)],
    );
    assert.deepEqual(
      blocks.rows.map((r) => r.plain_text),
      ['written by the client'],
    );
  });

  test('two clients converge on the same page', async () => {
    await seedPage(uuid(1), 'Shared');

    const a = makeClient();
    const b = makeClient();
    a.connect();
    b.connect();
    await waitFor(() => a.state === 'ready' && b.state === 'ready', 'both ready');

    const handleA = a.openPage(uuid(1));
    const handleB = b.openPage(uuid(1));
    await waitFor(
      () => handleA.status === 'synced' && handleB.status === 'synced',
      'both synced',
    );

    appendBlocks(handleA.doc, [{ id: uuid(21), type: 'paragraph', text: 'from A' }]);

    await waitFor(
      () => readBlockTree(handleB.doc).blocks.some((blk) => blk.text === 'from A'),
      "B to receive A's block",
    );

    appendBlocks(handleB.doc, [{ id: uuid(22), type: 'paragraph', text: 'from B' }]);
    await waitFor(
      () => readBlockTree(handleA.doc).blocks.some((blk) => blk.text === 'from B'),
      "A to receive B's block",
    );
  });

  test('presence is exchanged between clients', async () => {
    await seedPage(uuid(1), 'Presence');

    const a = makeClient({ presence: { displayName: 'Alice', color: '#f00' } });
    const b = makeClient({ presence: { displayName: 'Bob', color: '#00f' } });
    a.connect();
    b.connect();
    await waitFor(() => a.state === 'ready' && b.state === 'ready', 'ready');

    const handleA = a.openPage(uuid(1));
    const handleB = b.openPage(uuid(1));
    await waitFor(
      () => handleA.status === 'synced' && handleB.status === 'synced',
      'synced',
    );

    await waitFor(
      () => handleA.peers().some((p) => p.displayName === 'Bob'),
      'A to see Bob',
    );
    await waitFor(
      () => handleB.peers().some((p) => p.displayName === 'Alice'),
      'B to see Alice',
    );

    // Own state must not appear among peers, or every cursor list shows a
    // duplicate of the local user.
    assert.ok(!handleA.peers().some((p) => p.displayName === 'Alice'));
  });

  test('opening the same page twice shares one document', async () => {
    // Otherwise a sidebar preview and the editor hold divergent copies.
    await seedPage(uuid(1), 'Shared handle');
    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');

    const first = client.openPage(uuid(1));
    const second = client.openPage(uuid(1));
    assert.equal(first.doc, second.doc, 'the same Y.Doc instance');
    assert.equal(client.store.openPages.length, 1);

    first.release();
    assert.equal(client.store.openPages.length, 1, 'still held by the second handle');
  });

  test('a forbidden page reports denied rather than hanging', async () => {
    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');

    const handle = client.openPage(uuid(999));
    await waitFor(() => handle.status === 'denied', `denied, got ${handle.status}`);
    assert.equal(handle.canEdit, false);
  });

  test('a viewer via share link cannot edit', async () => {
    await seedPage(uuid(1), 'Read only');
    const { createShareLink } = await import('@sone/server/src/auth/share.js');
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: userId,
      role: 'viewer',
    });

    const client = makeClient({
      credentials: { workspaceId, shareToken: link.token, displayName: 'Reader' },
    });
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');

    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.status === 'synced', 'synced');
    assert.equal(handle.role, 'viewer');
    assert.equal(handle.canEdit, false);
  });

  test('a role downgrade is reflected on the open handle', async () => {
    await seedPage(uuid(1), 'Downgrade');
    const { createShareLink } = await import('@sone/server/src/auth/share.js');
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: userId,
      role: 'editor',
    });

    const client = makeClient({
      credentials: { workspaceId, shareToken: link.token },
    });
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');
    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.canEdit, 'editor rights');

    await db.query(`UPDATE share_tokens SET role = 'viewer' WHERE id = $1`, [
      link.shareTokenId,
    ]);
    await sync.revokeAccess(uuid(1));

    await waitFor(() => !handle.canEdit, 'the downgrade to arrive');
    assert.equal(handle.role, 'viewer');
    assert.equal(handle.status, 'synced', 'the document stays open');
  });

  test('a revoked share link closes the document', async () => {
    await seedPage(uuid(1), 'Revoked');
    const { createShareLink, revokeShareLink } = await import(
      '@sone/server/src/auth/share.js'
    );
    const link = await createShareLink(db, { pageId: uuid(1), createdBy: userId });

    const client = makeClient({
      credentials: { workspaceId, shareToken: link.token },
    });
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');
    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.status === 'synced', 'synced');

    await revokeShareLink(db, link.shareTokenId);
    await sync.revokeAccess(uuid(1));

    await waitFor(() => handle.status === 'denied', 'the document to be closed');
  });

  // --- reconnection --------------------------------------------------------

  test('an offline edit survives a reconnect', async () => {
    // The property that justifies CRDTs. Nothing queues the edit explicitly:
    // it sits in the local Y.Doc and the handshake reconciles it.
    await seedPage(uuid(1), 'Offline');

    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');
    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.status === 'synced', 'synced');

    // Drop the underlying socket without telling the client to close.
    // 4000 rather than 1006: reserved codes cannot be sent, and `ws` refuses
    // them outright.
    const readyCount = () => client.states.filter((s) => s === 'ready').length;
    const before = readyCount();

    dropSocket(client);
    // Edit immediately: the reconnect is deliberately fast, so waiting for the
    // disconnected state to be observable would be racing it.
    appendBlocks(handle.doc, [
      { id: uuid(31), type: 'paragraph', text: 'written while offline' },
    ]);

    await waitFor(() => readyCount() > before, 'a reconnection', 10_000);
    assert.ok(
      client.states.includes('reconnecting'),
      'the connection must have gone through reconnecting',
    );
    await waitFor(() => handle.status === 'synced', 'resync after reconnect', 10_000);

    await waitFor(async () => {
      const rows = await db.query<{ plain_text: string }>(
        `SELECT plain_text FROM blocks WHERE page_id = $1`,
        [uuid(1)],
      );
      return rows.rows.some((r) => r.plain_text === 'written while offline');
    }, 'the offline edit to reach the database', 10_000);
  });

  test('releasing a handle with unsynced changes keeps the document', async () => {
    // Dropping it here would silently lose an offline edit.
    await seedPage(uuid(1), 'Unsynced');
    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');
    const handle = client.openPage(uuid(1));
    await waitFor(() => handle.status === 'synced', 'synced');

    // No reconnection for this one: a deliberate close does not retry, so the
    // client stays down and the edit stays unsynced.
    client.connection.close();
    appendBlocks(handle.doc, [{ id: uuid(41), type: 'paragraph', text: 'pending' }]);
    assert.equal(client.hasUnsyncedChanges, true);

    handle.release();
    assert.deepEqual(client.store.openPages, [uuid(1)], 'kept in memory');
  });

  test('subscribers are notified of status changes', async () => {
    await seedPage(uuid(1), 'Subscribe');
    const client = makeClient();
    client.connect();
    await waitFor(() => client.state === 'ready', 'ready');

    const seen: string[] = [];
    const handle = client.openPage(uuid(1));
    handle.subscribe((h) => seen.push(h.status));

    await waitFor(() => seen.includes('synced'), 'a synced notification');
  });
});
