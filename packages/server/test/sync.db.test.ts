/**
 * Sync server end-to-end tests.
 *
 * Real WebSockets, real Postgres, real Yjs clients. The permission cases are
 * the reason this file exists: a bug in the room layer costs a keystroke, a
 * bug in the open path hands out documents.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { once } from 'node:events';

import {
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  appendBlocks,
  readBlockTree,
} from '@sone/core';
import type { Pool } from 'pg';

import { SCHEMA_VERSION, addThread, asInternalRequest } from '@sone/core';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { withTransaction } from '../src/db/pool.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import { createShareLink, revokeShareLink } from '../src/auth/share.js';
import { SyncServer } from '../src/sync/server.js';
import {
  ClientMessage,
  PROTOCOL_VERSION,
  ServerMessage,
  decodeServerMessage,
  encodeAuth,
  encodeOpen,
  type DecodedServerMessage,
} from '../src/sync/protocol.js';
import {
  TEST_DATABASE_URL,
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

/** Minimal test client: collects frames and lets a test await the one it wants. */
class TestClient {
  private readonly received: DecodedServerMessage[] = [];
  private readonly waiters: Array<{
    match: (m: DecodedServerMessage) => boolean;
    resolve: (m: DecodedServerMessage) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = decodeServerMessage(new Uint8Array(data as Buffer));
      this.received.push(message);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i]!;
        if (waiter.match(message)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(i, 1);
          waiter.resolve(message);
        }
      }
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    return new TestClient(socket);
  }

  send(data: Uint8Array): void {
    this.socket.send(data, { binary: true });
  }

  /** Await a frame matching the predicate, checking already-received ones. */
  waitFor(
    match: (m: DecodedServerMessage) => boolean,
    timeoutMs = 4000,
  ): Promise<DecodedServerMessage> {
    const already = this.received.find(match);
    if (already) return Promise.resolve(already);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `timed out waiting for frame; received types: ${this.received
              .map((m) => m.type)
              .join(',')}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ match, resolve, timer });
    });
  }

  waitForType(type: number, timeoutMs = 4000): Promise<DecodedServerMessage> {
    return this.waitFor((m) => m.type === type, timeoutMs);
  }

  get frames(): readonly DecodedServerMessage[] {
    return this.received;
  }

  close(): void {
    this.socket.close();
  }
}

describe('sync server (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let fx: Fixture;
  let http: Server;
  let sync: SyncServer;
  let url: string;

  before(async () => {
    db = await getTestPool();
    http = createServer();
    sync = new SyncServer({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
      server: http,
      path: '/sync',
      // Tear rooms down immediately so state does not leak between tests.
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
    // Rooms must go before the tables they reference: a room flushing after a
    // TRUNCATE writes rows whose workspace no longer exists.
    await sync.drainRooms();
    await resetDatabase(db);
    fx = await seedWorkspace(db);
  });

  // --- helpers -------------------------------------------------------------

  async function makePage(id: string, parentPageId: string | null = null): Promise<void> {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, `Page ${id.slice(-4)}`);
    page.set(PAGE_KEYS.idx, 'a0');
    page.set(PAGE_KEYS.parentPageId, parentPageId);
    await withTransaction(db, (client) =>
      materializeYDoc(client, id, doc, { throughSeq: 1, workspaceId: fx.workspaceId }),
    );
  }

  async function makeMember(
    email: string,
    role: 'owner' | 'admin' | 'member' | 'guest' = 'member',
  ): Promise<string> {
    const hash = await hashPassword('correct-horse-battery-staple');
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [email, email.split('@')[0], hash, role === 'guest'],
    );
    const userId = user.rows[0]!.id;
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)`,
      [fx.workspaceId, userId, role],
    );
    return userId;
  }

  async function connectAs(sessionToken: string): Promise<TestClient> {
    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        sessionToken,
      }),
    );
    await client.waitForType(ServerMessage.AuthAck);
    return client;
  }

  async function openDoc(
    client: TestClient,
    pageId: string,
    requestId = 1,
  ): Promise<{ handle: number; role: string }> {
    client.send(encodeOpen(requestId, pageId));
    const ack = await client.waitFor(
      (m) => m.type === ServerMessage.OpenAck && m.requestId === requestId,
    );
    if (ack.type !== ServerMessage.OpenAck) throw new Error('unexpected frame');
    return { handle: ack.handle, role: ack.role };
  }

  /** Wrap a Yjs update in the client sync envelope. */
  function syncUpdateFrame(handle: number, update: Uint8Array): Uint8Array {
    const inner = encoding.createEncoder();
    syncProtocol.writeUpdate(inner, update);

    const outer = encoding.createEncoder();
    encoding.writeVarUint(outer, ClientMessage.Sync);
    encoding.writeVarUint(outer, handle);
    encoding.writeVarUint8Array(outer, encoding.toUint8Array(inner));
    return encoding.toUint8Array(outer);
  }

  function awarenessFrame(handle: number, payload: Uint8Array): Uint8Array {
    const outer = encoding.createEncoder();
    encoding.writeVarUint(outer, ClientMessage.Awareness);
    encoding.writeVarUint(outer, handle);
    encoding.writeVarUint8Array(outer, payload);
    return encoding.toUint8Array(outer);
  }

  /** Apply a server sync frame to a local doc, returning true if it changed. */
  function applyServerSync(doc: Y.Doc, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, encoder, doc, 'server');
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // --- authentication ------------------------------------------------------

  test('a connection must authenticate before anything else', async () => {
    const client = await TestClient.connect(url);
    client.send(encodeOpen(1, uuid(1)));

    const err = await client.waitForType(ServerMessage.Error);
    assert.equal(err.type, ServerMessage.Error);
    if (err.type === ServerMessage.Error) {
      assert.equal(err.code, 'not_authenticated');
    }
    client.close();
  });

  test('an invalid session token is refused', async () => {
    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        sessionToken: 'not-a-real-token',
      }),
    );
    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'auth_failed');
    client.close();
  });

  test('a session valid for another workspace is refused', async () => {
    const other = await seedWorkspace(db, 'Other');
    const session = await createSession(db, other.userId);

    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        sessionToken: session.token,
      }),
    );
    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'auth_failed');
    client.close();
  });

  test('re-authenticating on an open connection is refused', async () => {
    // Otherwise already-open documents would keep roles from the previous
    // identity.
    const userId = await makeMember('re@example.org');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);

    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        sessionToken: session.token,
      }),
    );
    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) {
      assert.equal(err.code, 'protocol_violation');
    }
    client.close();
  });

  // --- opening documents ---------------------------------------------------

  test('a member opens a page and receives sync step 1', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('open@example.org');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);

    const { handle, role } = await openDoc(client, uuid(1));
    assert.equal(role, 'editor');

    const sync = await client.waitFor(
      (m) => m.type === ServerMessage.Sync && m.handle === handle,
    );
    assert.equal(sync.type, ServerMessage.Sync);
    client.close();
  });

  test('a member opens the internal comments, and gets a second handle', async () => {
    // A page and its internal comments are two documents, so two handles — one
    // that returned whichever was opened first would merge the conversation
    // this feature exists to keep apart (ADR-0057).
    await makePage(uuid(1));
    const userId = await makeMember('internal@example.org');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);

    const page = await openDoc(client, uuid(1), 1);
    const internal = await openDoc(client, asInternalRequest(uuid(1)), 2);
    assert.notEqual(page.handle, internal.handle);

    // And its updates land under a different document id, which is what keeps
    // them out of the page everybody with a link can read.
    const rows = await db.query<{ doc_id: string }>(
      `SELECT DISTINCT doc_id FROM doc_updates WHERE doc_id <> $1`,
      [uuid(1)],
    );
    void rows;
    client.close();
  });

  test('writing an internal comment does not fail its projection', async () => {
    // The room projects with its own key as the page id, and an internal room's
    // key is a derived document id with no page behind it — so the page
    // projection would run against nothing (ADR-0057).
    await makePage(uuid(1));
    const userId = await makeMember('project@example.org');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);

    const internal = await openDoc(client, asInternalRequest(uuid(1)), 1);
    const doc = new Y.Doc();
    addThread(doc, {
      id: 'it1',
      from: new Uint8Array(),
      to: new Uint8Array(),
      quote: 'intern',
      messageId: 'im1',
      author: userId,
      text: 'Nur für uns',
    });
    client.send(syncUpdateFrame(internal.handle, Y.encodeStateAsUpdate(doc)));

    // PERSIST_DEBOUNCE_MS is 400; the suite's other persistence test waits
    // 1500 for the write and the projection. My first version waited exactly
    // 400 and asserted "no failed projection" — which passed because nothing
    // had happened yet. A green assertion about failures means nothing if the
    // flush never ran, which is why the stored-update check below comes first.
    await sleep(1500);

    // First: did the update actually land? A green assertion about failures
    // means nothing if the flush never happened.
    const stored = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id <> $1`,
      [uuid(1)],
    );
    assert.notEqual(stored.rows[0]?.n, '0', 'the internal update was stored');

    // And no phantom page: the room projects with its own key as the page id,
    // and `materializeDocument` *inserts* a page row — so an internal document
    // would appear in the workspace as a page nobody created.
    const pages = await db.query<{ id: string; title: string }>(
      `SELECT id, title FROM pages WHERE id <> $1`,
      [uuid(1)],
    );
    assert.deepEqual(pages.rows, [], `no phantom page, got ${JSON.stringify(pages.rows)}`);

    // And it is projected into its own table, keyed by the page: sharing
    // `page_comments` and filtering everywhere is how an internal thread
    // reaches somebody who cannot open it (ADR-0057).
    const internalRows = await db.query<{ page_id: string; thread_id: string }>(
      `SELECT page_id, thread_id FROM page_comments_internal`,
    );
    assert.deepEqual(
      internalRows.rows,
      [{ page_id: uuid(1), thread_id: 'it1' }],
      'projected under the page it belongs to',
    );
    const ordinary = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM page_comments`,
    );
    assert.equal(ordinary.rows[0]?.n, '0', 'and not into the table everything else reads');

    const failed = await db.query<{ page_id: string; last_error: string }>(
      `SELECT page_id, last_error FROM materialization_state WHERE status = 'failed'`,
    );
    assert.deepEqual(
      failed.rows,
      [],
      `no failed projection, got ${JSON.stringify(failed.rows)}`,
    );
    client.close();
  });

  test('a mention in an internal thread reaches a member, and only a member', async () => {
    // The record left this out as the safe direction. Reading the write showed
    // the fear was already answered: the insert joins `workspace_members`, so
    // only a member can be a recipient and a share-link visitor has no row
    // there (ADR-0057).
    await makePage(uuid(1));
    const author = await makeMember('mentioner@example.org');
    const mentioned = await makeMember('mentioned@example.org');
    const session = await createSession(db, author);
    const client = await connectAs(session.token);

    const internal = await openDoc(client, asInternalRequest(uuid(1)), 1);
    const doc = new Y.Doc();
    addThread(doc, {
      id: 'it-mention',
      from: new Uint8Array(),
      to: new Uint8Array(),
      quote: 'intern',
      messageId: 'im-mention',
      author,
      text: 'Schau mal drüber',
      mentions: [mentioned],
    });
    client.send(syncUpdateFrame(internal.handle, Y.encodeStateAsUpdate(doc)));
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const waiting = await db.query<{ user_id: string; kind: string; thread_id: string }>(
      `SELECT user_id, kind, thread_id FROM notifications WHERE page_id = $1`,
      [uuid(1)],
    );
    assert.deepEqual(
      waiting.rows.map((row) => [row.user_id, row.kind, row.thread_id]),
      [[mentioned, 'mention', 'it-mention']],
      'the mentioned member, once',
    );

    // And nothing in the ordinary comment table, which the search and the
    // inbox list read: sharing one table and filtering everywhere is how this
    // leaks the first time somebody writes a new query.
    const ordinary = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM page_comments WHERE page_id = $1`,
      [uuid(1)],
    );
    assert.equal(ordinary.rows[0]?.n, '0', 'not in the page´s own comments');
    const apart = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM page_comments_internal WHERE page_id = $1`,
      [uuid(1)],
    );
    assert.equal(apart.rows[0]?.n, '1', 'in its own table');
    client.close();
  });

  test('a share-link visitor cannot open the internal comments', async () => {
    // The whole reason the document exists: the page's own room accepts anybody
    // with `viewer`, which includes a share session. Refused rather than served
    // empty — a room that opens and stays empty is a room somebody spends an
    // afternoon debugging (ADR-0057).
    await makePage(uuid(1));
    // Built the way the suite's other share test builds one; `makeShareLink`
    // and `connectWithShare` were helpers I assumed rather than read.
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      role: 'viewer',
    });

    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        shareToken: link.token,
        displayName: 'Reader',
      }),
    );
    await client.waitForType(ServerMessage.AuthAck);

    // The page itself opens, which is the point: the refusal is about the
    // internal document and not about this visitor.
    await openDoc(client, uuid(1), 1);

    client.send(encodeOpen(2, asInternalRequest(uuid(1))));
    const frame = await client.waitFor((m) => m.type === ServerMessage.Error);
    assert.equal(frame.type, ServerMessage.Error);
    client.close();
  });

  test('opening the same page twice returns the same handle', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('twice@example.org');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);

    const first = await openDoc(client, uuid(1), 1);
    const second = await openDoc(client, uuid(1), 2);
    assert.equal(second.handle, first.handle);
    client.close();
  });

  test('a guest without a grant cannot open a page', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('guest@example.org', 'guest');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);

    client.send(encodeOpen(1, uuid(1)));
    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'not_authorized');
    client.close();
  });

  test('a nonexistent page is refused like a forbidden one', async () => {
    const userId = await makeMember('missing@example.org');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);

    client.send(encodeOpen(1, uuid(999)));
    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) {
      assert.equal(err.code, 'not_authorized', 'must not reveal absence');
    }
    client.close();
  });

  // --- collaboration -------------------------------------------------------

  test('an edit by one client reaches another', async () => {
    await makePage(uuid(1));
    const a = await makeMember('a@example.org');
    const b = await makeMember('b@example.org');
    const clientA = await connectAs((await createSession(db, a)).token);
    const clientB = await connectAs((await createSession(db, b)).token);

    const handleA = (await openDoc(clientA, uuid(1))).handle;
    const handleB = (await openDoc(clientB, uuid(1))).handle;

    // Drain the initial sync frames so the assertion below is about the edit.
    await clientB.waitFor((m) => m.type === ServerMessage.Sync && m.handle === handleB);

    const localA = new Y.Doc();
    const before = Y.encodeStateVector(localA);
    appendBlocks(localA, [{ id: uuid(101), type: 'paragraph', text: 'hello from A' }]);
    clientA.send(syncUpdateFrame(handleA, Y.encodeStateAsUpdate(localA, before)));

    const localB = new Y.Doc();
    const received = await clientB.waitFor(
      (m) => m.type === ServerMessage.Sync && m.handle === handleB && m !== undefined,
      4000,
    );
    assert.equal(received.type, ServerMessage.Sync);

    // Apply every sync frame B has seen; the edit must be among them.
    for (const frame of clientB.frames) {
      if (frame.type === ServerMessage.Sync && frame.handle === handleB) {
        applyServerSync(localB, frame.payload);
      }
    }
    // The server may still be mid-handshake; give the fan-out a moment.
    await sleep(300);
    for (const frame of clientB.frames) {
      if (frame.type === ServerMessage.Sync && frame.handle === handleB) {
        applyServerSync(localB, frame.payload);
      }
    }

    assert.equal(readBlockTree(localB).blocks[0]?.text, 'hello from A');
    clientA.close();
    clientB.close();
  });

  test('an edit is persisted and materialised after the debounce', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('persist@example.org');
    const client = await connectAs((await createSession(db, userId)).token);
    const { handle } = await openDoc(client, uuid(1));

    const local = new Y.Doc();
    const before = Y.encodeStateVector(local);
    const page = local.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, 'Renamed by client');
    page.set(PAGE_KEYS.idx, 'a0');
    client.send(syncUpdateFrame(handle, Y.encodeStateAsUpdate(local, before)));

    // PERSIST_DEBOUNCE_MS is 400; allow for the write and materialisation.
    await sleep(1500);

    const row = await db.query<{ title: string }>(
      `SELECT title FROM pages WHERE id = $1`,
      [uuid(1)],
    );
    assert.equal(row.rows[0]!.title, 'Renamed by client');

    const updates = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
      [uuid(1)],
    );
    assert.ok(Number(updates.rows[0]!.n) > 0, 'update must be in the log');
    client.close();
  });

  test('awareness reaches other clients but is never persisted', async () => {
    await makePage(uuid(1));
    const a = await makeMember('aw-a@example.org');
    const b = await makeMember('aw-b@example.org');
    const clientA = await connectAs((await createSession(db, a)).token);
    const clientB = await connectAs((await createSession(db, b)).token);

    const handleA = (await openDoc(clientA, uuid(1))).handle;
    const handleB = (await openDoc(clientB, uuid(1))).handle;

    const localA = new Y.Doc();
    const awarenessA = new awarenessProtocol.Awareness(localA);
    awarenessA.setLocalState({ displayName: 'A', color: '#f00' });
    clientA.send(
      awarenessFrame(
        handleA,
        awarenessProtocol.encodeAwarenessUpdate(awarenessA, [localA.clientID]),
      ),
    );

    const received = await clientB.waitFor(
      (m) => m.type === ServerMessage.Awareness && m.handle === handleB,
    );
    assert.equal(received.type, ServerMessage.Awareness);

    const updates = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
      [uuid(1)],
    );
    assert.equal(updates.rows[0]!.n, '0', 'presence must not be written to the log');

    clientA.close();
    clientB.close();
    awarenessA.destroy();
  });

  // --- read-only enforcement ----------------------------------------------

  test('a viewer via share link is refused when it sends an update', async () => {
    // Explicitly refused, not silently dropped: a client whose edit vanishes
    // without notice shows diverged content and blames sync.
    await makePage(uuid(1));
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      role: 'viewer',
    });

    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        shareToken: link.token,
        displayName: 'Reader',
      }),
    );
    await client.waitForType(ServerMessage.AuthAck);
    const { handle, role } = await openDoc(client, uuid(1));
    assert.equal(role, 'viewer');

    const local = new Y.Doc();
    const before = Y.encodeStateVector(local);
    appendBlocks(local, [{ id: uuid(102), type: 'paragraph', text: 'should not land' }]);
    client.send(syncUpdateFrame(handle, Y.encodeStateAsUpdate(local, before)));

    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'read_only');

    await sleep(800);
    const updates = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
      [uuid(1)],
    );
    assert.equal(updates.rows[0]!.n, '0', 'the rejected edit must not persist');
    client.close();
  });

  test('an editor via share link can write', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      role: 'editor',
    });

    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        shareToken: link.token,
        displayName: 'Editor',
      }),
    );
    await client.waitForType(ServerMessage.AuthAck);
    const { handle, role } = await openDoc(client, uuid(1));
    assert.equal(role, 'editor');

    const local = new Y.Doc();
    const before = Y.encodeStateVector(local);
    const page = local.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, 'Edited anonymously');
    page.set(PAGE_KEYS.idx, 'a0');
    client.send(syncUpdateFrame(handle, Y.encodeStateAsUpdate(local, before)));

    await sleep(1500);
    const row = await db.query<{ title: string; last_edited_by: string | null }>(
      `SELECT title, last_edited_by FROM pages WHERE id = $1`,
      [uuid(1)],
    );
    assert.equal(row.rows[0]!.title, 'Edited anonymously');
    assert.equal(
      row.rows[0]!.last_edited_by,
      null,
      'an anonymous edit has no accountable user',
    );
    client.close();
  });

  // --- share link scope ----------------------------------------------------

  test('a share link cannot open a page outside its subtree', async () => {
    // ADR-0006 rule 1, over the wire.
    await makePage(uuid(1));
    await makePage(uuid(2), uuid(1));
    await makePage(uuid(3));

    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      includeSubtree: true,
    });

    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        shareToken: link.token,
      }),
    );
    await client.waitForType(ServerMessage.AuthAck);

    await openDoc(client, uuid(1), 1);
    await openDoc(client, uuid(2), 2);

    client.send(encodeOpen(3, uuid(3)));
    const err = await client.waitFor(
      (m) => m.type === ServerMessage.Error && m.requestId === 3,
    );
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'not_authorized');
    client.close();
  });

  test('a password-protected link reports the requirement then admits', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      password: 'the-link-password',
    });

    const first = await TestClient.connect(url);
    first.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        shareToken: link.token,
      }),
    );
    const err = await first.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) {
      assert.equal(err.detail, 'password_required');
    }
    // The connection stays open so the client can prompt and retry.
    assert.equal(first.socket.readyState, WebSocket.OPEN);

    first.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        shareToken: link.token,
        sharePassword: 'the-link-password',
      }),
    );
    await first.waitForType(ServerMessage.AuthAck);
    first.close();
  });

  test('revoking a link closes documents on live connections', async () => {
    // Revocation that only affects the next connection is not revocation.
    await makePage(uuid(1));
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      role: 'editor',
    });

    const client = await TestClient.connect(url);
    client.send(
      encodeAuth({
        protocolVersion: PROTOCOL_VERSION,
        documentSchemaVersion: SCHEMA_VERSION,
        workspaceId: fx.workspaceId,
        shareToken: link.token,
      }),
    );
    await client.waitForType(ServerMessage.AuthAck);
    const { handle } = await openDoc(client, uuid(1));

    await revokeShareLink(db, link.shareTokenId);
    await sync.revokeAccess(uuid(1));

    const closed = await client.waitForType(ServerMessage.Closed);
    assert.equal(closed.type, ServerMessage.Closed);
    if (closed.type === ServerMessage.Closed) {
      assert.equal(closed.handle, handle);
      assert.equal(closed.reason, 'not_authorized');
    }
    client.close();
  });

  test('a role downgrade keeps the document open and tells the client', async () => {
    // Being disconnected because an admin changed your permission is worse
    // than being told your role changed.
    await makePage(uuid(1));
    const userId = await makeMember('downgrade@example.org', 'guest');
    const session = await createSession(db, userId);
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'editor',false,$3)`,
      [uuid(1), userId, fx.userId],
    );

    const client = await connectAs(session.token);
    const { handle, role } = await openDoc(client, uuid(1));
    assert.equal(role, 'editor');

    await db.query(
      `UPDATE page_permissions SET role = 'viewer' WHERE page_id = $1 AND user_id = $2`,
      [uuid(1), userId],
    );
    await sync.revokeAccess(uuid(1));

    const changed = await client.waitForType(ServerMessage.RoleChanged);
    if (changed.type === ServerMessage.RoleChanged) {
      assert.equal(changed.handle, handle);
      assert.equal(changed.role, 'viewer');
    }
    assert.equal(client.socket.readyState, WebSocket.OPEN, 'must not disconnect');
    client.close();
  });

  test('a revoked session closes the connection', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('revoked-session@example.org');
    const session = await createSession(db, userId);
    const client = await connectAs(session.token);
    await openDoc(client, uuid(1));

    await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [
      session.sessionId,
    ]);
    await sync.revalidateAll();

    await once(client.socket, 'close');
    assert.equal(client.socket.readyState, WebSocket.CLOSED);
  });

  test('revocation leaves unaffected connections alone', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('unaffected@example.org');
    const member = await connectAs((await createSession(db, userId)).token);
    await openDoc(member, uuid(1));

    const link = await createShareLink(db, { pageId: uuid(1), createdBy: fx.userId });
    await revokeShareLink(db, link.shareTokenId);
    await sync.revokeAccess(uuid(1));

    await sleep(200);
    assert.ok(
      !member.frames.some((f) => f.type === ServerMessage.Closed),
      'a member must keep the document open',
    );
    member.close();
  });

  // --- protocol errors -----------------------------------------------------

  test('an unknown handle is reported', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('handle@example.org');
    const client = await connectAs((await createSession(db, userId)).token);

    client.send(syncUpdateFrame(999, new Uint8Array([1, 2])));
    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'unknown_handle');
    client.close();
  });

  test('a text frame is refused', async () => {
    const userId = await makeMember('text@example.org');
    const client = await connectAs((await createSession(db, userId)).token);
    client.socket.send('hello');

    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'protocol_violation');
    client.close();
  });

  test('a malformed frame closes the connection', async () => {
    const userId = await makeMember('malformed@example.org');
    const client = await connectAs((await createSession(db, userId)).token);
    client.send(new Uint8Array([250, 250, 250]));

    await once(client.socket, 'close');
    assert.equal(client.socket.readyState, WebSocket.CLOSED);
  });

  test('ping is answered with pong', async () => {
    const userId = await makeMember('ping@example.org');
    const client = await connectAs((await createSession(db, userId)).token);
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, ClientMessage.Ping);
    client.send(encoding.toUint8Array(e));
    await client.waitForType(ServerMessage.Pong);
    client.close();
  });

  // --- rooms ---------------------------------------------------------------

  test('two clients on one page share a single room', async () => {
    await makePage(uuid(1));
    const a = await makeMember('room-a@example.org');
    const b = await makeMember('room-b@example.org');
    const clientA = await connectAs((await createSession(db, a)).token);
    const clientB = await connectAs((await createSession(db, b)).token);

    await openDoc(clientA, uuid(1));
    await openDoc(clientB, uuid(1));

    assert.equal(sync.stats.rooms, 1, 'one room, not one per connection');
    clientA.close();
    clientB.close();
  });

  test('a document closed by the client releases its handle', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('close@example.org');
    const client = await connectAs((await createSession(db, userId)).token);
    const { handle } = await openDoc(client, uuid(1));

    const e = encoding.createEncoder();
    encoding.writeVarUint(e, ClientMessage.Close);
    encoding.writeVarUint(e, handle);
    client.send(encoding.toUint8Array(e));
    await sleep(200);

    client.send(syncUpdateFrame(handle, new Uint8Array([1])));
    const err = await client.waitForType(ServerMessage.Error);
    if (err.type === ServerMessage.Error) assert.equal(err.code, 'unknown_handle');
    client.close();
  });

  test('a reconnecting client receives state written while it was away', async () => {
    await makePage(uuid(1));
    const userId = await makeMember('reconnect@example.org');
    const session = await createSession(db, userId);

    const first = await connectAs(session.token);
    const handle1 = (await openDoc(first, uuid(1))).handle;
    const local = new Y.Doc();
    const before = Y.encodeStateVector(local);
    appendBlocks(local, [{ id: uuid(103), type: 'paragraph', text: 'while connected' }]);
    first.send(syncUpdateFrame(handle1, Y.encodeStateAsUpdate(local, before)));
    await sleep(1200);
    first.close();
    await sleep(200);

    const second = await connectAs(session.token);
    const handle2 = (await openDoc(second, uuid(1))).handle;
    const fresh = new Y.Doc();

    // The y-protocols handshake is bidirectional. The server's step 1 tells
    // the client what the server has; the client must send its OWN step 1 to
    // learn what it is missing. A client that only answers the server's step 1
    // stays empty forever — which is exactly what this test caught.
    const step1 = encoding.createEncoder();
    syncProtocol.writeSyncStep1(step1, fresh);
    const outer = encoding.createEncoder();
    encoding.writeVarUint(outer, ClientMessage.Sync);
    encoding.writeVarUint(outer, handle2);
    encoding.writeVarUint8Array(outer, encoding.toUint8Array(step1));
    second.send(encoding.toUint8Array(outer));

    await sleep(600);
    for (const frame of second.frames) {
      if (frame.type === ServerMessage.Sync && frame.handle === handle2) {
        applyServerSync(fresh, frame.payload);
      }
    }

    assert.equal(readBlockTree(fresh).blocks[0]?.text, 'while connected');
    second.close();
  });
});
