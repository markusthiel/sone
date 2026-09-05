/**
 * SONE — sync wire protocol.
 *
 * One WebSocket carries many documents. The alternative — a connection per
 * document, which is what y-websocket does — means a page with eight subpages
 * open costs nine TCP connections and nine authentication round trips. A page
 * tree makes that the normal case, not the exception.
 *
 * Framing is binary via lib0 encoding, already present as a Yjs dependency.
 * JSON with base64 payloads would be simpler to read in a debugger and cost
 * a third more bytes on every keystroke.
 *
 * Message layout: [messageType: varUint] [type-specific fields]
 *
 * Documents are addressed by a per-connection numeric handle rather than by
 * uuid, so the document id is transmitted once at open instead of on every
 * update. At a few updates per second per document that is the difference
 * between 36 bytes of overhead per message and one.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { SCHEMA_VERSION, isClientSchemaCompatible, readInternalRequest } from '@sone/core';

export const PROTOCOL_VERSION = 1;

/**
 * Client to server.
 */
export const ClientMessage = {
  /** First message on every connection. Nothing else is accepted before it. */
  Auth: 0,
  /** Request a document. Server replies OpenAck or Error. */
  Open: 1,
  /** y-protocols sync message for an open document. */
  Sync: 2,
  /** y-protocols awareness update (cursors, presence). */
  Awareness: 3,
  /** Release a document handle. */
  Close: 4,
  /** Keepalive. */
  Ping: 5,
} as const;

/**
 * Server to client.
 */
export const ServerMessage = {
  AuthAck: 0,
  /** Document opened; carries the handle and the granted role. */
  OpenAck: 1,
  Sync: 2,
  Awareness: 3,
  /** Server-initiated close: revoked access, document deleted. */
  Closed: 4,
  Pong: 5,
  Error: 6,
  /** Access level changed while the document was open. */
  RoleChanged: 7,
  /**
   * Something this person's inbox counts has changed (ADR-0093).
   *
   * The one frame here that is about a **person** rather than a document: it
   * carries no handle, because a notification is not about the page anybody has
   * open — that is the whole reason the bell could not be pushed to before.
   *
   * It carries a scope and nothing else. No count and no content: the inbox
   * already holds the list it counts, and a number on the wire would be a
   * second answer to a question that list answers — which is how a badge and a
   * list came to disagree in the first place (ADR-0092).
   */
  Notify: 8,
} as const;

/**
 * What a Notify frame is about.
 *
 * A string rather than the bare frame, so the next thing worth nudging — the
 * page tree, say — needs no protocol version.
 */
export const NotifyScope = {
  Inbox: 'inbox',
  /**
   * The page tree of the workspace this connection authenticated for
   * (ADR-0096).
   *
   * The scope that proves the scope was worth having: a second subject, no
   * protocol version. Addressed by **workspace** rather than by person, which
   * is what the tree is, and it names nothing about the change — the tree route
   * is the one place that decides what somebody may see.
   */
  Pages: 'pages',
  /**
   * The workspace's trash (ADR-0097).
   *
   * Its own scope rather than a second reason to refetch the tree: archiving
   * and restoring belong to both lists, and renaming belongs only to the tree.
   * One scope for the pair would mean every rename in the workspace refetching
   * a list it cannot have changed.
   */
  Trash: 'trash',
} as const;

/**
 * The scopes this server will put on the wire.
 *
 * The channel's payload names its own scope, and that payload comes from a
 * trigger rather than from this process — so it is checked against this list
 * before it is forwarded. Our own SQL either way, and an allow-list is one line:
 * a string that reached clients because a migration typed it is a contract
 * nobody agreed to.
 */
export const WORKSPACE_SCOPES: readonly string[] = [NotifyScope.Pages, NotifyScope.Trash];

export type NotifyScopeValue = (typeof NotifyScope)[keyof typeof NotifyScope];

export type ClientMessageType = (typeof ClientMessage)[keyof typeof ClientMessage];
export type ServerMessageType = (typeof ServerMessage)[keyof typeof ServerMessage];

/**
 * Error codes.
 *
 * Codes, not sentences: the client owns the translations (ADR-0011). The
 * server must not decide what language a message is in.
 */
export const SyncError = {
  ProtocolViolation: 'protocol_violation',
  NotAuthenticated: 'not_authenticated',
  AuthFailed: 'auth_failed',
  NotAuthorized: 'not_authorized',
  ReadOnly: 'read_only',
  UnknownHandle: 'unknown_handle',
  TooManyDocuments: 'too_many_documents',
  MessageTooLarge: 'message_too_large',
  RateLimited: 'rate_limited',
  Internal: 'internal',
  /**
   * The client speaks a different document format (ADR-0039).
   *
   * Its own code rather than `auth_failed`: somebody whose tab is a day old has
   * done nothing wrong and needs one instruction — reload — not a message about
   * credentials.
   */
  DocumentSchemaMismatch: 'document_schema_mismatch',
} as const;

export type SyncErrorCode = (typeof SyncError)[keyof typeof SyncError];

/**
 * Limits.
 *
 * Every one of these exists because its absence is a denial-of-service path
 * that an authenticated but hostile client can walk.
 */
export const LIMITS = {
  /** Largest single frame. A legitimate Yjs update is orders below this. */
  maxMessageBytes: 8 * 1024 * 1024,
  /** Open documents per connection. */
  maxDocumentsPerConnection: 128,
  /** Update messages per second per connection, averaged over the window. */
  maxUpdatesPerSecond: 200,
  rateWindowMs: 10_000,
  /** Time a connection may stay unauthenticated before being dropped. */
  authTimeoutMs: 10_000,
  /** No traffic for this long and the connection is considered dead. */
  idleTimeoutMs: 90_000,
} as const;

// --- encoding --------------------------------------------------------------

export interface AuthPayload {
  protocolVersion: number;
  /** The document format the client speaks; must equal the server's (ADR-0039). */
  documentSchemaVersion?: number;
  workspaceId: string;
  /**
   * Session token, or a share token, or neither.
   *
   * Neither means "use the session cookie from the upgrade request". That is
   * the normal case for a browser: the cookie is HttpOnly, so JavaScript
   * cannot read it to send here — and making it readable to work around that
   * would hand any XSS a usable credential.
   */
  sessionToken?: string;
  shareToken?: string;
  /** For share links: display name and optional password. */
  displayName?: string;
  sharePassword?: string;
  /** Reuse an existing anonymous session so presence stays stable. */
  shareSessionId?: string;
}

/**
 * Auth is encoded as JSON inside the binary frame.
 *
 * It happens once per connection, carries strings rather than bytes, and
 * gains nothing from a hand-rolled binary layout — whereas a mistake in the
 * field order of a hand-rolled auth message is a security bug.
 */
export function encodeAuth(payload: AuthPayload): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ClientMessage.Auth);
  encoding.writeVarString(encoder, JSON.stringify(payload));
  return encoding.toUint8Array(encoder);
}

export function encodeAuthAck(payload: {
  principalKind: 'user' | 'guest' | 'anonymous';
  displayName: string;
  workspaceRole: string | null;
  shareSessionId?: string;
}): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.AuthAck);
  encoding.writeVarString(encoder, JSON.stringify(payload));
  return encoding.toUint8Array(encoder);
}

export function encodeOpen(requestId: number, pageId: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ClientMessage.Open);
  encoding.writeVarUint(encoder, requestId);
  encoding.writeVarString(encoder, pageId);
  return encoding.toUint8Array(encoder);
}

export function encodeOpenAck(
  requestId: number,
  handle: number,
  role: string,
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.OpenAck);
  encoding.writeVarUint(encoder, requestId);
  encoding.writeVarUint(encoder, handle);
  encoding.writeVarString(encoder, role);
  return encoding.toUint8Array(encoder);
}

/** Wrap a y-protocols sync payload for a document handle. */
export function encodeSync(handle: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.Sync);
  encoding.writeVarUint(encoder, handle);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function encodeAwareness(handle: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.Awareness);
  encoding.writeVarUint(encoder, handle);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function encodeClosed(handle: number, reason: SyncErrorCode): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.Closed);
  encoding.writeVarUint(encoder, handle);
  encoding.writeVarString(encoder, reason);
  return encoding.toUint8Array(encoder);
}

export function encodeRoleChanged(handle: number, role: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.RoleChanged);
  encoding.writeVarUint(encoder, handle);
  encoding.writeVarString(encoder, role);
  return encoding.toUint8Array(encoder);
}

/**
 * Error frame.
 *
 * `requestId` correlates the error with the request that caused it; 0 means
 * connection-level. `detail` is for logs, never for display — the client
 * renders `code`.
 */
export function encodeError(
  requestId: number,
  code: SyncErrorCode,
  detail = '',
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.Error);
  encoding.writeVarUint(encoder, requestId);
  encoding.writeVarString(encoder, code);
  encoding.writeVarString(encoder, detail);
  return encoding.toUint8Array(encoder);
}

/** Nudge: something in this scope changed for this person (ADR-0093). */
export function encodeNotify(scope: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.Notify);
  encoding.writeVarString(encoder, scope);
  return encoding.toUint8Array(encoder);
}

export function encodePing(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ClientMessage.Ping);
  return encoding.toUint8Array(encoder);
}

export function encodePong(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ServerMessage.Pong);
  return encoding.toUint8Array(encoder);
}

// --- decoding --------------------------------------------------------------

export type DecodedClientMessage =
  | { type: typeof ClientMessage.Auth; payload: AuthPayload }
  | { type: typeof ClientMessage.Open; requestId: number; pageId: string }
  | { type: typeof ClientMessage.Sync; handle: number; payload: Uint8Array }
  | { type: typeof ClientMessage.Awareness; handle: number; payload: Uint8Array }
  | { type: typeof ClientMessage.Close; handle: number }
  | { type: typeof ClientMessage.Ping };

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly code: SyncErrorCode = SyncError.ProtocolViolation,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * Decode a client frame.
 *
 * Every field is validated. This function reads bytes from an untrusted peer,
 * so it throws ProtocolError on anything unexpected rather than returning a
 * partially-filled object that a caller might use.
 */
export function decodeClientMessage(data: Uint8Array): DecodedClientMessage {
  if (data.byteLength === 0) {
    throw new ProtocolError('empty message');
  }
  if (data.byteLength > LIMITS.maxMessageBytes) {
    throw new ProtocolError('message too large', SyncError.MessageTooLarge);
  }

  const decoder = decoding.createDecoder(data);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    throw new ProtocolError('unreadable message type');
  }

  try {
    switch (type) {
      case ClientMessage.Auth: {
        const raw = decoding.readVarString(decoder);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new ProtocolError('auth payload is not valid JSON');
        }
        return { type: ClientMessage.Auth, payload: validateAuth(parsed) };
      }

      case ClientMessage.Open: {
        const requestId = decoding.readVarUint(decoder);
        const pageId = decoding.readVarString(decoder);
        /*
         * A page id, optionally with the internal-comments suffix (ADR-0057).
         *
         * The check was `isUuid` alone, which refused the suffixed form before
         * anything else saw it — so the room's own authorisation never ran and
         * the request came back as a protocol error. The reason was readable
         * here and I did not read it: I added the suffix and then looked for
         * the refusal in the room.
         *
         * Still strict: the part before the suffix must be a uuid, so this
         * accepts exactly one more shape than before rather than any string.
         */
        const asked = readInternalRequest(pageId);
        if (!isUuid(asked.pageId)) throw new ProtocolError('open: pageId is not a uuid');
        return { type: ClientMessage.Open, requestId, pageId };
      }

      case ClientMessage.Sync: {
        const handle = decoding.readVarUint(decoder);
        const payload = decoding.readVarUint8Array(decoder);
        return { type: ClientMessage.Sync, handle, payload };
      }

      case ClientMessage.Awareness: {
        const handle = decoding.readVarUint(decoder);
        const payload = decoding.readVarUint8Array(decoder);
        return { type: ClientMessage.Awareness, handle, payload };
      }

      case ClientMessage.Close: {
        const handle = decoding.readVarUint(decoder);
        return { type: ClientMessage.Close, handle };
      }

      case ClientMessage.Ping:
        return { type: ClientMessage.Ping };

      default:
        throw new ProtocolError(`unknown message type ${type}`);
    }
  } catch (err) {
    if (err instanceof ProtocolError) throw err;
    // A truncated frame lands here: lib0 throws when reading past the end.
    throw new ProtocolError('malformed message');
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && UUID_RE.test(v);

function validateAuth(value: unknown): AuthPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError('auth payload must be an object');
  }
  const v = value as Record<string, unknown>;

  const protocolVersion = v['protocolVersion'];
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      `unsupported protocol version ${String(protocolVersion)}; server speaks ${PROTOCOL_VERSION}`,
    );
  }

  // The document format, which is a separate contract from the wire format above
  // (ADR-0013) and is checked for equality rather than a minimum.
  //
  // A client older than the server deletes blocks it cannot draw — y-prosemirror
  // removes an element it cannot turn into a node, from the shared document, for
  // everyone. A client newer writes blocks the server cannot project. Both are
  // refused, and an absent value is an old client rather than a lenient one.
  const documentSchemaVersion = v['documentSchemaVersion'];
  if (!isClientSchemaCompatible(Number(documentSchemaVersion))) {
    throw new ProtocolError(
      `client speaks document schema ${String(documentSchemaVersion ?? 'unknown')}; ` +
        `this server speaks ${SCHEMA_VERSION}. Reload the page.`,
      SyncError.DocumentSchemaMismatch,
    );
  }

  if (!isUuid(v['workspaceId'])) {
    throw new ProtocolError('auth: workspaceId is not a uuid');
  }

  const sessionToken = optionalString(v['sessionToken'], 'sessionToken');
  const shareToken = optionalString(v['shareToken'], 'shareToken');
  if (sessionToken !== undefined && shareToken !== undefined) {
    // Ambiguous which credential the resulting claims came from.
    throw new ProtocolError('auth: sessionToken and shareToken are mutually exclusive');
  }

  const payload: AuthPayload = {
    protocolVersion: PROTOCOL_VERSION,
    documentSchemaVersion: SCHEMA_VERSION,
    workspaceId: v['workspaceId'],
  };
  if (sessionToken !== undefined) payload.sessionToken = sessionToken;
  if (shareToken !== undefined) payload.shareToken = shareToken;

  const displayName = optionalString(v['displayName'], 'displayName', 64);
  if (displayName !== undefined) payload.displayName = displayName;
  const sharePassword = optionalString(v['sharePassword'], 'sharePassword', 1024);
  if (sharePassword !== undefined) payload.sharePassword = sharePassword;
  const shareSessionId = v['shareSessionId'];
  if (shareSessionId !== undefined && shareSessionId !== null) {
    if (!isUuid(shareSessionId)) {
      throw new ProtocolError('auth: shareSessionId is not a uuid');
    }
    payload.shareSessionId = shareSessionId;
  }

  return payload;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength = 4096,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ProtocolError(`auth: ${field} must be a string`);
  }
  if (value.length > maxLength) {
    throw new ProtocolError(`auth: ${field} exceeds ${maxLength} characters`);
  }
  return value;
}

/** Read a server frame's type without consuming the payload. Used in tests. */
export function peekMessageType(data: Uint8Array): number {
  return decoding.readVarUint(decoding.createDecoder(data));
}

export type DecodedServerMessage =
  | { type: typeof ServerMessage.AuthAck; payload: Record<string, unknown> }
  | { type: typeof ServerMessage.OpenAck; requestId: number; handle: number; role: string }
  | { type: typeof ServerMessage.Sync; handle: number; payload: Uint8Array }
  | { type: typeof ServerMessage.Awareness; handle: number; payload: Uint8Array }
  | { type: typeof ServerMessage.Closed; handle: number; reason: string }
  | { type: typeof ServerMessage.RoleChanged; handle: number; role: string }
  | { type: typeof ServerMessage.Notify; scope: string }
  | { type: typeof ServerMessage.Pong }
  | {
      type: typeof ServerMessage.Error;
      requestId: number;
      code: string;
      detail: string;
    };

/** Decode a server frame. Used by the client and by tests. */
export function decodeServerMessage(data: Uint8Array): DecodedServerMessage {
  const decoder = decoding.createDecoder(data);
  const type = decoding.readVarUint(decoder);

  switch (type) {
    case ServerMessage.AuthAck:
      return {
        type: ServerMessage.AuthAck,
        payload: JSON.parse(decoding.readVarString(decoder)) as Record<string, unknown>,
      };
    case ServerMessage.OpenAck:
      return {
        type: ServerMessage.OpenAck,
        requestId: decoding.readVarUint(decoder),
        handle: decoding.readVarUint(decoder),
        role: decoding.readVarString(decoder),
      };
    case ServerMessage.Sync:
      return {
        type: ServerMessage.Sync,
        handle: decoding.readVarUint(decoder),
        payload: decoding.readVarUint8Array(decoder),
      };
    case ServerMessage.Awareness:
      return {
        type: ServerMessage.Awareness,
        handle: decoding.readVarUint(decoder),
        payload: decoding.readVarUint8Array(decoder),
      };
    case ServerMessage.Closed:
      return {
        type: ServerMessage.Closed,
        handle: decoding.readVarUint(decoder),
        reason: decoding.readVarString(decoder),
      };
    case ServerMessage.RoleChanged:
      return {
        type: ServerMessage.RoleChanged,
        handle: decoding.readVarUint(decoder),
        role: decoding.readVarString(decoder),
      };
    case ServerMessage.Notify:
      return { type: ServerMessage.Notify, scope: decoding.readVarString(decoder) };
    case ServerMessage.Pong:
      return { type: ServerMessage.Pong };
    case ServerMessage.Error:
      return {
        type: ServerMessage.Error,
        requestId: decoding.readVarUint(decoder),
        code: decoding.readVarString(decoder),
        detail: decoding.readVarString(decoder),
      };
    default:
      throw new ProtocolError(`unknown server message type ${type}`);
  }
}
