/**
 * Connection tests.
 *
 * Driven by a stub socket, so the state machine and the backoff can be
 * examined without a server and without waiting on real timers. The
 * end-to-end behaviour is covered separately in sync.e2e.test.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as encoding from 'lib0/encoding';

import {
  DEFAULT_MAX_BACKOFF_MS,
  SyncConnection,
  type ConnectionState,
  type SocketLike,
} from '../src/connection.js';
import {
  ClientMessage,
  ServerMessage,
  decodeServerFrame,
} from '../src/protocol.js';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';

/** A socket whose lifecycle the test drives explicitly. */
class StubSocket implements SocketLike {
  readyState = 0;
  sent: Uint8Array[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  /** Simulate the socket opening. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Simulate the server sending a frame. */
  receive(data: Uint8Array): void {
    this.onmessage?.({ data });
  }

  /** Simulate the socket dropping. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  /** Decode what the client has sent, for assertions. */
  sentTypes(): number[] {
    return this.sent.map((frame) => frame[0] ?? -1);
  }
}

function authAckFrame(
  overrides: Record<string, unknown> = {},
): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ServerMessage.AuthAck);
  encoding.writeVarString(
    e,
    JSON.stringify({
      principalKind: 'user',
      displayName: 'Tester',
      workspaceRole: 'member',
      ...overrides,
    }),
  );
  return encoding.toUint8Array(e);
}

function errorFrame(requestId: number, code: string, detail = ''): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ServerMessage.Error);
  encoding.writeVarUint(e, requestId);
  encoding.writeVarString(e, code);
  encoding.writeVarString(e, detail);
  return encoding.toUint8Array(e);
}

interface Harness {
  connection: SyncConnection;
  sockets: StubSocket[];
  states: ConnectionState[];
  reconnects: number;
  fatals: Array<{ code: string; detail: string }>;
  passwordPrompts: number;
  shareSessions: string[];
  latest(): StubSocket;
}

function harness(
  options: {
    sessionToken?: string;
    shareToken?: string;
    random?: () => number;
    baseBackoffMs?: number;
  } = {},
): Harness {
  const sockets: StubSocket[] = [];
  const states: ConnectionState[] = [];
  const fatals: Array<{ code: string; detail: string }> = [];
  const shareSessions: string[] = [];
  let reconnects = 0;
  let passwordPrompts = 0;

  const connection = new SyncConnection(
    {
      url: 'ws://test/sync',
      credentials: {
        workspaceId: WORKSPACE,
        ...(options.shareToken
          ? { shareToken: options.shareToken }
          : { sessionToken: options.sessionToken ?? 'token' }),
      },
      socketFactory: () => {
        const socket = new StubSocket();
        sockets.push(socket);
        return socket;
      },
      pingIntervalMs: 0,
      ...(options.random ? { random: options.random } : { random: () => 0.5 }),
      ...(options.baseBackoffMs !== undefined
        ? { baseBackoffMs: options.baseBackoffMs }
        : {}),
    },
    {
      onStateChange: (state) => states.push(state),
      onReconnect: () => {
        reconnects++;
      },
      onFatal: (code, detail) => fatals.push({ code, detail }),
      onPasswordRequired: () => {
        passwordPrompts++;
      },
      onShareSession: (id) => shareSessions.push(id),
    },
  );

  return {
    connection,
    sockets,
    states,
    get reconnects() {
      return reconnects;
    },
    fatals,
    get passwordPrompts() {
      return passwordPrompts;
    },
    shareSessions,
    latest: () => sockets[sockets.length - 1]!,
  };
}

// --- handshake -------------------------------------------------------------

test('authenticates on open and becomes ready', () => {
  const h = harness();
  h.connection.connect();
  assert.equal(h.connection.currentState, 'connecting');

  h.latest().open();
  assert.equal(h.connection.currentState, 'authenticating');
  assert.deepEqual(h.latest().sentTypes(), [ClientMessage.Auth]);

  h.latest().receive(authAckFrame());
  assert.equal(h.connection.currentState, 'ready');
  assert.equal(h.connection.authAck?.displayName, 'Tester');
});

test('the auth frame carries the protocol version and exactly one credential', () => {
  const h = harness({ sessionToken: 'the-token' });
  h.connection.connect();
  h.latest().open();

  const frame = h.latest().sent[0]!;
  // Decode by hand: this is a client frame, and the client codec only decodes
  // server frames.
  const json = Buffer.from(frame.slice(2)).toString('utf8');
  const payload = JSON.parse(json.slice(json.indexOf('{'))) as Record<string, unknown>;
  assert.equal(payload['protocolVersion'], 1);
  assert.equal(payload['sessionToken'], 'the-token');
  assert.equal(payload['shareToken'], undefined);
});

test('nothing is sent before the connection is ready', () => {
  const h = harness();
  h.connection.connect();
  h.latest().open();
  // Still authenticating.
  assert.equal(h.connection.send(new Uint8Array([1, 2, 3])), false);

  h.latest().receive(authAckFrame());
  assert.equal(h.connection.send(new Uint8Array([1, 2, 3])), true);
});

test('an anonymous share session id is surfaced for persistence', () => {
  // The client stores it and presents it on reconnect, or presence
  // accumulates ghost cursors.
  const h = harness({ shareToken: 'share' });
  h.connection.connect();
  h.latest().open();
  h.latest().receive(
    authAckFrame({
      principalKind: 'anonymous',
      workspaceRole: null,
      shareSessionId: '00000000-0000-4000-8000-0000000000ff',
    }),
  );
  assert.deepEqual(h.shareSessions, ['00000000-0000-4000-8000-0000000000ff']);
});

// --- reconnection ----------------------------------------------------------

test('a dropped socket schedules a reconnect', async () => {
  const h = harness({ baseBackoffMs: 1 });
  h.connection.connect();
  h.latest().open();
  h.latest().receive(authAckFrame());

  h.latest().drop();
  assert.equal(h.connection.currentState, 'reconnecting');

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.sockets.length, 2, 'a new socket must have been created');
  h.connection.close();
});

test('onReconnect fires on the second successful auth, not the first', async () => {
  // The store uses this to reopen documents. Firing it on the first connect
  // would reopen documents that were never open.
  const h = harness({ baseBackoffMs: 1 });
  h.connection.connect();
  h.latest().open();
  h.latest().receive(authAckFrame());
  assert.equal(h.reconnects, 0);

  h.latest().drop();
  await new Promise((r) => setTimeout(r, 20));
  h.latest().open();
  h.latest().receive(authAckFrame());

  assert.equal(h.reconnects, 1);
  h.connection.close();
});

test('backoff grows and is capped', () => {
  // random() fixed at 1 so the delay equals the ceiling, making the growth
  // curve observable.
  const h = harness({ random: () => 1, baseBackoffMs: 100 });
  const delays = [0, 1, 2, 3, 10, 20].map((n) => h.connection.backoffDelay(n));

  assert.deepEqual(delays.slice(0, 4), [100, 200, 400, 800]);
  assert.equal(delays[4], DEFAULT_MAX_BACKOFF_MS, 'must be capped');
  assert.equal(delays[5], DEFAULT_MAX_BACKOFF_MS);
});

test('backoff uses full jitter', () => {
  // Full jitter means a uniform draw over [0, ceiling], not ceiling plus
  // noise. Without it, a server restart brings every client back at once.
  const h = harness({ random: () => 0, baseBackoffMs: 100 });
  assert.equal(h.connection.backoffDelay(5), 0, 'the low end of the range is zero');

  const h2 = harness({ random: () => 0.999, baseBackoffMs: 100 });
  assert.ok(h2.connection.backoffDelay(0) < 100);
});

test('a deliberate close does not reconnect', async () => {
  const h = harness({ baseBackoffMs: 1 });
  h.connection.connect();
  h.latest().open();
  h.latest().receive(authAckFrame());

  h.connection.close();
  assert.equal(h.connection.currentState, 'closed');

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.sockets.length, 1, 'no new socket after a deliberate close');
});

// --- fatal errors ----------------------------------------------------------

test('auth_failed is fatal and stops retrying', async () => {
  // A bad credential does not become good by waiting, and retrying forever
  // burns the server's rate limit while showing the user a spinner.
  const h = harness({ baseBackoffMs: 1 });
  h.connection.connect();
  h.latest().open();
  h.latest().receive(errorFrame(0, 'auth_failed'));

  assert.equal(h.connection.currentState, 'closed');
  assert.deepEqual(h.fatals.map((f) => f.code), ['auth_failed']);

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.sockets.length, 1);
});

test('a password-protected link prompts instead of failing', () => {
  const h = harness({ shareToken: 'share' });
  h.connection.connect();
  h.latest().open();
  h.latest().receive(errorFrame(0, 'auth_failed', 'password_required'));

  assert.equal(h.passwordPrompts, 1);
  assert.equal(h.connection.currentState, 'authenticating', 'socket stays open');
  assert.deepEqual(h.fatals, [], 'not fatal');
});

test('retrying with a password re-sends auth on the same socket', () => {
  const h = harness({ shareToken: 'share' });
  h.connection.connect();
  h.latest().open();
  h.latest().receive(errorFrame(0, 'auth_failed', 'password_required'));

  h.connection.retryAuth('the-password');
  assert.equal(h.sockets.length, 1, 'no new socket needed');
  assert.equal(h.latest().sent.length, 2);

  h.latest().receive(authAckFrame());
  assert.equal(h.connection.currentState, 'ready');
});

test('an unparseable frame is fatal rather than ignored', () => {
  // A frame we cannot parse means the server speaks a protocol we do not.
  // Reconnecting will not help; a reload after a deploy will.
  const h = harness();
  h.connection.connect();
  h.latest().open();
  h.latest().receive(authAckFrame());

  h.latest().receive(new Uint8Array([250, 250, 250]));
  assert.equal(h.connection.currentState, 'closed');
  assert.deepEqual(h.fatals.map((f) => f.code), ['protocol_violation']);
});

test('a non-fatal error frame is passed through to the store', () => {
  const frames: number[] = [];
  const sockets: StubSocket[] = [];
  const connection = new SyncConnection(
    {
      url: 'ws://test/sync',
      credentials: { workspaceId: WORKSPACE, sessionToken: 't' },
      socketFactory: () => {
        const s = new StubSocket();
        sockets.push(s);
        return s;
      },
      pingIntervalMs: 0,
    },
    { onFrame: (frame) => frames.push(frame.type) },
  );

  connection.connect();
  sockets[0]!.open();
  sockets[0]!.receive(authAckFrame());
  sockets[0]!.receive(errorFrame(7, 'not_authorized'));

  assert.deepEqual(frames, [ServerMessage.Error]);
  assert.equal(connection.currentState, 'ready', 'a per-request error is not fatal');
  connection.close();
});

test('a string frame is ignored rather than misparsed', () => {
  const h = harness();
  h.connection.connect();
  h.latest().open();
  h.latest().receive(authAckFrame());

  h.latest().onmessage?.({ data: 'not binary' });
  assert.equal(h.connection.currentState, 'ready');
});

test('pong frames are consumed and not forwarded', () => {
  const frames: number[] = [];
  const sockets: StubSocket[] = [];
  const connection = new SyncConnection(
    {
      url: 'ws://test/sync',
      credentials: { workspaceId: WORKSPACE, sessionToken: 't' },
      socketFactory: () => {
        const s = new StubSocket();
        sockets.push(s);
        return s;
      },
      pingIntervalMs: 0,
    },
    { onFrame: (frame) => frames.push(frame.type) },
  );
  connection.connect();
  sockets[0]!.open();
  sockets[0]!.receive(authAckFrame());

  const pong = encoding.createEncoder();
  encoding.writeVarUint(pong, ServerMessage.Pong);
  sockets[0]!.receive(encoding.toUint8Array(pong));

  assert.deepEqual(frames, []);
  connection.close();
});

// --- codec -----------------------------------------------------------------

test('server frames decode with values above one byte', () => {
  // varUint changes shape past 128; an off-by-one would corrupt every frame
  // once enough documents are open.
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ServerMessage.OpenAck);
  encoding.writeVarUint(e, 300);
  encoding.writeVarUint(e, 20_000);
  encoding.writeVarString(e, 'editor');

  const frame = decodeServerFrame(encoding.toUint8Array(e));
  assert.equal(frame.type, ServerMessage.OpenAck);
  if (frame.type === ServerMessage.OpenAck) {
    assert.equal(frame.requestId, 300);
    assert.equal(frame.handle, 20_000);
    assert.equal(frame.role, 'editor');
  }
});

test('an empty or truncated frame is rejected', () => {
  assert.throws(() => decodeServerFrame(new Uint8Array(0)));
  const full = authAckFrame();
  assert.throws(() => decodeServerFrame(full.slice(0, 3)));
});
