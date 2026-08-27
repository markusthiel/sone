/**
 * SONE client — wire protocol.
 *
 * Mirrors packages/server/src/sync/protocol.ts. The duplication is deliberate:
 * the alternative is a shared package that both the server and the browser
 * bundle depend on, and pulling the server's module graph into the client
 * bundle to reuse a hundred lines of encoding is a worse trade.
 *
 * The two must stay in step. PROTOCOL_VERSION is negotiated at auth and a
 * mismatch is refused, so a drift shows up as a clear refusal rather than as
 * corrupted frames — which is the whole reason the version exists.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const PROTOCOL_VERSION = 1;

export const ClientMessage = {
  Auth: 0,
  Open: 1,
  Sync: 2,
  Awareness: 3,
  Close: 4,
  Ping: 5,
} as const;

export const ServerMessage = {
  AuthAck: 0,
  OpenAck: 1,
  Sync: 2,
  Awareness: 3,
  Closed: 4,
  Pong: 5,
  Error: 6,
  RoleChanged: 7,
} as const;

export type Role = 'viewer' | 'commenter' | 'editor' | 'admin';

export interface AuthPayload {
  protocolVersion: number;
  workspaceId: string;
  /**
   * Omit both to authenticate with the session cookie.
   *
   * A browser cannot read an HttpOnly cookie to send it here, and making it
   * readable would hand any XSS a usable credential. The cookie does travel
   * with the WebSocket upgrade request, which is where the server reads it.
   */
  sessionToken?: string;
  shareToken?: string;
  displayName?: string;
  sharePassword?: string;
  shareSessionId?: string;
}

export interface AuthAck {
  principalKind: 'user' | 'guest' | 'anonymous';
  displayName: string;
  workspaceRole: string | null;
  shareSessionId?: string;
}

export function encodeAuth(payload: AuthPayload): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Auth);
  encoding.writeVarString(e, JSON.stringify(payload));
  return encoding.toUint8Array(e);
}

export function encodeOpen(requestId: number, pageId: string): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Open);
  encoding.writeVarUint(e, requestId);
  encoding.writeVarString(e, pageId);
  return encoding.toUint8Array(e);
}

export function encodeSync(handle: number, payload: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Sync);
  encoding.writeVarUint(e, handle);
  encoding.writeVarUint8Array(e, payload);
  return encoding.toUint8Array(e);
}

export function encodeAwareness(handle: number, payload: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Awareness);
  encoding.writeVarUint(e, handle);
  encoding.writeVarUint8Array(e, payload);
  return encoding.toUint8Array(e);
}

export function encodeCloseDocument(handle: number): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Close);
  encoding.writeVarUint(e, handle);
  return encoding.toUint8Array(e);
}

export function encodePing(): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, ClientMessage.Ping);
  return encoding.toUint8Array(e);
}

export type ServerFrame =
  | { type: typeof ServerMessage.AuthAck; ack: AuthAck }
  | { type: typeof ServerMessage.OpenAck; requestId: number; handle: number; role: Role }
  | { type: typeof ServerMessage.Sync; handle: number; payload: Uint8Array }
  | { type: typeof ServerMessage.Awareness; handle: number; payload: Uint8Array }
  | { type: typeof ServerMessage.Closed; handle: number; reason: string }
  | { type: typeof ServerMessage.RoleChanged; handle: number; role: Role }
  | { type: typeof ServerMessage.Pong }
  | { type: typeof ServerMessage.Error; requestId: number; code: string; detail: string };

export class ClientProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientProtocolError';
  }
}

/**
 * Decode a server frame.
 *
 * Throws on anything unrecognised. A server speaking a newer protocol than the
 * client would otherwise be silently misread, and a half-decoded frame applied
 * to a document is worse than a dropped connection.
 */
export function decodeServerFrame(data: Uint8Array): ServerFrame {
  if (data.byteLength === 0) throw new ClientProtocolError('empty frame');
  const d = decoding.createDecoder(data);

  let type: number;
  try {
    type = decoding.readVarUint(d);
  } catch {
    throw new ClientProtocolError('unreadable frame type');
  }

  try {
    switch (type) {
      case ServerMessage.AuthAck:
        return {
          type: ServerMessage.AuthAck,
          ack: JSON.parse(decoding.readVarString(d)) as AuthAck,
        };
      case ServerMessage.OpenAck:
        return {
          type: ServerMessage.OpenAck,
          requestId: decoding.readVarUint(d),
          handle: decoding.readVarUint(d),
          role: decoding.readVarString(d) as Role,
        };
      case ServerMessage.Sync:
        return {
          type: ServerMessage.Sync,
          handle: decoding.readVarUint(d),
          payload: decoding.readVarUint8Array(d),
        };
      case ServerMessage.Awareness:
        return {
          type: ServerMessage.Awareness,
          handle: decoding.readVarUint(d),
          payload: decoding.readVarUint8Array(d),
        };
      case ServerMessage.Closed:
        return {
          type: ServerMessage.Closed,
          handle: decoding.readVarUint(d),
          reason: decoding.readVarString(d),
        };
      case ServerMessage.RoleChanged:
        return {
          type: ServerMessage.RoleChanged,
          handle: decoding.readVarUint(d),
          role: decoding.readVarString(d) as Role,
        };
      case ServerMessage.Pong:
        return { type: ServerMessage.Pong };
      case ServerMessage.Error:
        return {
          type: ServerMessage.Error,
          requestId: decoding.readVarUint(d),
          code: decoding.readVarString(d),
          detail: decoding.readVarString(d),
        };
      default:
        throw new ClientProtocolError(`unknown server frame type ${type}`);
    }
  } catch (err) {
    if (err instanceof ClientProtocolError) throw err;
    throw new ClientProtocolError('malformed frame');
  }
}

export const ROLE_ORDER: readonly Role[] = ['viewer', 'commenter', 'editor', 'admin'];

export const canWrite = (role: Role): boolean =>
  ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf('editor');
