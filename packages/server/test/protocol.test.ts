/**
 * Sync protocol tests.
 *
 * `decodeClientMessage` reads bytes from an untrusted peer, so the emphasis is
 * on rejection: truncated frames, wrong types, missing fields, both
 * credentials at once. A decoder that returns a partially-filled object on bad
 * input is how a protocol bug becomes an authorisation bug.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as encoding from 'lib0/encoding';

import { SCHEMA_VERSION } from '@sone/core';

import {
  ClientMessage,
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  ServerMessage,
  SyncError,
  decodeClientMessage,
  decodeServerMessage,
  encodeAuth,
  encodeAuthAck,
  encodeAwareness,
  encodeClosed,
  encodeError,
  encodeOpen,
  encodeOpenAck,
  encodePong,
  encodeRoleChanged,
  encodeSync,
  isUuid,
} from '../src/sync/protocol.js';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const PAGE = '00000000-0000-4000-8000-000000000002';

// --- round trips -----------------------------------------------------------

test('auth round-trips with a session token', () => {
  const frame = encodeAuth({
    protocolVersion: PROTOCOL_VERSION,
    documentSchemaVersion: SCHEMA_VERSION,
    workspaceId: WORKSPACE,
    sessionToken: 'abc123',
  });
  const decoded = decodeClientMessage(frame);
  assert.equal(decoded.type, ClientMessage.Auth);
  if (decoded.type !== ClientMessage.Auth) throw new Error('unreachable');
  assert.equal(decoded.payload.workspaceId, WORKSPACE);
  assert.equal(decoded.payload.sessionToken, 'abc123');
  assert.equal(decoded.payload.shareToken, undefined);
});

test('auth round-trips with a share token and display name', () => {
  const frame = encodeAuth({
    protocolVersion: PROTOCOL_VERSION,
    documentSchemaVersion: SCHEMA_VERSION,
    workspaceId: WORKSPACE,
    shareToken: 'share-token',
    displayName: 'Visitor',
  });
  const decoded = decodeClientMessage(frame);
  if (decoded.type !== ClientMessage.Auth) throw new Error('unreachable');
  assert.equal(decoded.payload.shareToken, 'share-token');
  assert.equal(decoded.payload.displayName, 'Visitor');
});

test('open and sync frames round-trip', () => {
  const open = decodeClientMessage(encodeOpen(7, PAGE));
  assert.deepEqual(open, { type: ClientMessage.Open, requestId: 7, pageId: PAGE });

  const payload = new Uint8Array([1, 2, 3, 4]);
  const sync = decodeClientMessage(
    (() => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, ClientMessage.Sync);
      encoding.writeVarUint(e, 3);
      encoding.writeVarUint8Array(e, payload);
      return encoding.toUint8Array(e);
    })(),
  );
  assert.equal(sync.type, ClientMessage.Sync);
  if (sync.type !== ClientMessage.Sync) throw new Error('unreachable');
  assert.deepEqual(sync.payload, payload);
});

test('server frames round-trip', () => {
  assert.deepEqual(decodeServerMessage(encodeOpenAck(1, 5, 'editor')), {
    type: ServerMessage.OpenAck,
    requestId: 1,
    handle: 5,
    role: 'editor',
  });

  const sync = decodeServerMessage(encodeSync(5, new Uint8Array([9, 8])));
  assert.equal(sync.type, ServerMessage.Sync);

  const awareness = decodeServerMessage(encodeAwareness(5, new Uint8Array([7])));
  assert.equal(awareness.type, ServerMessage.Awareness);

  assert.deepEqual(decodeServerMessage(encodeClosed(5, SyncError.NotAuthorized)), {
    type: ServerMessage.Closed,
    handle: 5,
    reason: SyncError.NotAuthorized,
  });

  assert.deepEqual(decodeServerMessage(encodeRoleChanged(5, 'viewer')), {
    type: ServerMessage.RoleChanged,
    handle: 5,
    role: 'viewer',
  });

  assert.equal(decodeServerMessage(encodePong()).type, ServerMessage.Pong);
});

test('an error frame carries a code and never a translated sentence', () => {
  // ADR-0011: the client owns the catalogue. `detail` is for logs.
  const decoded = decodeServerMessage(
    encodeError(3, SyncError.ReadOnly, 'role=viewer'),
  );
  assert.equal(decoded.type, ServerMessage.Error);
  if (decoded.type === ServerMessage.Error) {
    assert.equal(decoded.code, 'read_only');
    assert.equal(decoded.requestId, 3);
  }
});

test('auth ack conveys the anonymous share session id', () => {
  // The client stores it and presents it on reconnect so presence stays
  // stable instead of accumulating ghost cursors.
  const decoded = decodeServerMessage(
    encodeAuthAck({
      principalKind: 'anonymous',
      displayName: 'Visitor',
      workspaceRole: null,
      shareSessionId: PAGE,
    }),
  );
  assert.equal(decoded.type, ServerMessage.AuthAck);
  if (decoded.type === ServerMessage.AuthAck) {
    assert.equal(decoded.payload['shareSessionId'], PAGE);
  }
});

// --- rejection -------------------------------------------------------------

test('an empty frame is rejected', () => {
  assert.throws(() => decodeClientMessage(new Uint8Array(0)), ProtocolError);
});

test('an oversized frame is rejected before parsing', () => {
  const huge = new Uint8Array(LIMITS.maxMessageBytes + 1);
  const err = (() => {
    try {
      decodeClientMessage(huge);
      return null;
    } catch (e) {
      return e as ProtocolError;
    }
  })();
  assert.ok(err instanceof ProtocolError);
  assert.equal(err.code, SyncError.MessageTooLarge);
});

test('an unknown message type is rejected', () => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 250);
  assert.throws(() => decodeClientMessage(encoding.toUint8Array(e)), ProtocolError);
});

test('a truncated frame is rejected rather than partially decoded', () => {
  // The dangerous case: a decoder that returns { pageId: undefined } here
  // would hand an unauthorised open to the server.
  const full = encodeOpen(1, PAGE);
  for (const cut of [1, 2, full.byteLength - 5, full.byteLength - 1]) {
    assert.throws(
      () => decodeClientMessage(full.slice(0, cut)),
      ProtocolError,
      `truncating to ${cut} bytes must be rejected`,
    );
  }
});

test('a mismatched protocol version is rejected', () => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(
    e,
    JSON.stringify({ protocolVersion: 99, workspaceId: WORKSPACE, sessionToken: 'x' }),
  );
  assert.throws(() => decodeClientMessage(encoding.toUint8Array(e)), ProtocolError);
});

test('auth with both credentials is rejected', () => {
  // Accepting both would make it ambiguous which credential produced the
  // resulting claims. Neither is fine — that means the cookie — but both is
  // not.
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(
    e,
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      workspaceId: WORKSPACE,
      sessionToken: 'a',
      shareToken: 'b',
    }),
  );
  assert.throws(() => decodeClientMessage(encoding.toUint8Array(e)), ProtocolError);
});

test('auth with neither credential is accepted and means cookie auth', () => {
  // A browser cannot read its own HttpOnly session cookie to put it here. The
  // cookie travels with the upgrade request instead, and the server reads it
  // there — so an auth message with no token is the normal browser case, not a
  // protocol error. Authorisation still happens; it just uses the cookie.
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(
    e,
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      documentSchemaVersion: SCHEMA_VERSION,
      workspaceId: WORKSPACE,
    }),
  );
  const decoded = decodeClientMessage(encoding.toUint8Array(e));
  assert.equal(decoded.type, ClientMessage.Auth);
  if (decoded.type !== ClientMessage.Auth) throw new Error('unreachable');
  assert.equal(decoded.payload.sessionToken, undefined);
  assert.equal(decoded.payload.shareToken, undefined);
});

test('a non-uuid workspace or page id is rejected', () => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(
    e,
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      workspaceId: 'not-a-uuid',
      sessionToken: 'x',
    }),
  );
  assert.throws(() => decodeClientMessage(encoding.toUint8Array(e)), ProtocolError);
  assert.throws(() => decodeClientMessage(encodeOpen(1, 'nope')), ProtocolError);
});

test('malformed auth JSON is rejected', () => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(e, '{not json');
  assert.throws(() => decodeClientMessage(encoding.toUint8Array(e)), ProtocolError);
});

test('auth payloads that are arrays or scalars are rejected', () => {
  for (const body of ['[]', '"string"', '42', 'null']) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, ClientMessage.Auth);
    encoding.writeVarString(e, body);
    assert.throws(
      () => decodeClientMessage(encoding.toUint8Array(e)),
      ProtocolError,
      `payload ${body} must be rejected`,
    );
  }
});

test('an over-long display name is rejected rather than truncated', () => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(
    e,
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      workspaceId: WORKSPACE,
      shareToken: 'x',
      displayName: 'x'.repeat(1000),
    }),
  );
  assert.throws(() => decodeClientMessage(encoding.toUint8Array(e)), ProtocolError);
});

test('a non-uuid share session id is rejected', () => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(
    e,
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      workspaceId: WORKSPACE,
      shareToken: 'x',
      shareSessionId: 'guess',
    }),
  );
  assert.throws(() => decodeClientMessage(encoding.toUint8Array(e)), ProtocolError);
});

test('isUuid rejects near-misses', () => {
  assert.equal(isUuid(PAGE), true);
  assert.equal(isUuid(PAGE.toUpperCase()), true);
  assert.equal(isUuid(PAGE.slice(0, -1)), false);
  assert.equal(isUuid(`${PAGE} `), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(42), false);
});

test('handles and request ids survive values above one byte', () => {
  // varUint encoding changes shape past 128; an off-by-one here would corrupt
  // every message once a connection has opened enough documents.
  for (const n of [0, 1, 127, 128, 255, 16384, 1_000_000]) {
    const decoded = decodeServerMessage(encodeOpenAck(n, n, 'editor'));
    assert.equal(decoded.type, ServerMessage.OpenAck);
    if (decoded.type === ServerMessage.OpenAck) {
      assert.equal(decoded.requestId, n);
      assert.equal(decoded.handle, n);
    }
  }
});

test('a client that does not say which document format it speaks is refused', () => {
  // Exactly what a tab from before this change sends: nothing. It is refused
  // rather than tolerated, because a client that cannot draw a block type deletes
  // it from the shared document, for everyone (ADR-0039).
  const frame = encodeAuth({
    protocolVersion: PROTOCOL_VERSION,
    workspaceId: WORKSPACE,
    sessionToken: 'abc123',
  });
  assert.throws(
    () => decodeClientMessage(frame),
    (err: unknown) =>
      err instanceof ProtocolError && err.code === SyncError.DocumentSchemaMismatch,
  );
});

test('a client speaking a different document format is refused, with its own reason', () => {
  // Not `auth_failed`: somebody whose tab is a day old has done nothing wrong and
  // needs one instruction, which is to reload.
  for (const version of [SCHEMA_VERSION - 1, SCHEMA_VERSION + 1]) {
    const frame = encodeAuth({
      protocolVersion: PROTOCOL_VERSION,
      documentSchemaVersion: version,
      workspaceId: WORKSPACE,
      sessionToken: 'abc123',
    });
    assert.throws(
      () => decodeClientMessage(frame),
      (err: unknown) =>
        err instanceof ProtocolError &&
        err.code === SyncError.DocumentSchemaMismatch &&
        /Reload the page/.test(err.message),
      `schema ${version}`,
    );
  }
});
