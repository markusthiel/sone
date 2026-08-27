/**
 * SONE client — the sync connection.
 *
 * One WebSocket, many documents (ADR-0012). This class owns the socket, the
 * authentication handshake, reconnection, and routing frames to whoever is
 * interested. It knows nothing about Yjs — that is the store's job — so the
 * reconnection logic can be tested without documents.
 *
 * ## Reconnection
 *
 * Exponential backoff with full jitter. Jitter is not decoration: without it,
 * a server restart makes every client reconnect at the same instant, and the
 * thundering herd can keep an instance down that would otherwise have come
 * back. Full jitter (a random delay in `[0, cap]`) spreads them better than
 * the usual "base plus a bit of noise".
 *
 * ## What the caller must handle
 *
 * A reconnect is not transparent. Document handles are per-connection, so
 * every open document must be reopened and re-handshaked after one. The store
 * subscribes to `onReconnect` for exactly that.
 */

import {
  ClientProtocolError,
  PROTOCOL_VERSION,
  ServerMessage,
  decodeServerFrame,
  encodeAuth,
  encodePing,
  type AuthAck,
  type AuthPayload,
  type ServerFrame,
} from './protocol.js';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  /** Authenticated; documents may be opened. */
  | 'ready'
  | 'reconnecting'
  /** Closed deliberately, or by an unrecoverable error. Will not retry. */
  | 'closed';

export interface Credentials {
  workspaceId: string;
  /**
   * Omit both to authenticate with the session cookie, which is what a browser
   * does: the cookie is HttpOnly and travels with the upgrade request.
   * `sessionToken` exists for non-browser clients and tests.
   */
  sessionToken?: string;
  shareToken?: string;
  displayName?: string;
  sharePassword?: string;
  /** Reuse an anonymous session so presence stays stable across reconnects. */
  shareSessionId?: string;
}

/**
 * Minimal WebSocket surface.
 *
 * Declared rather than imported from DOM types so the client can be driven by
 * a stub in tests and by `ws` in Node without either being a dependency.
 */
export interface SocketLike {
  readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  binaryType?: string;
}

export type SocketFactory = (url: string) => SocketLike;

export interface ConnectionOptions {
  url: string;
  credentials: Credentials;
  /** Injected in tests; defaults to the platform WebSocket. */
  socketFactory?: SocketFactory;
  /** First retry delay. Doubles up to maxBackoffMs. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Keepalive interval. Zero disables it. */
  pingIntervalMs?: number;
  /** Injected in tests so backoff is deterministic. */
  random?: () => number;
  log?: (msg: string, meta?: unknown) => void;
}

export const DEFAULT_BASE_BACKOFF_MS = 500;
export const DEFAULT_MAX_BACKOFF_MS = 30_000;
export const DEFAULT_PING_INTERVAL_MS = 30_000;

/**
 * Error codes that mean retrying is pointless.
 *
 * A bad credential does not become good by waiting, and retrying it forever
 * both wastes the server's rate-limit budget and hides the real problem from
 * the user behind a spinner.
 */
const FATAL_ERROR_CODES = new Set(['auth_failed', 'protocol_violation']);

export interface ConnectionEvents {
  onStateChange?: (state: ConnectionState, previous: ConnectionState) => void;
  onFrame?: (frame: ServerFrame) => void;
  /** Fired after a successful re-authentication, never on the first connect. */
  onReconnect?: () => void;
  /** Fatal: the connection will not retry. */
  onFatal?: (code: string, detail: string) => void;
  /** Anonymous share session id, so the caller can persist it. */
  onShareSession?: (shareSessionId: string) => void;
  /** A password-protected share link needs a password. */
  onPasswordRequired?: () => void;
}

export class SyncConnection {
  private socket: SocketLike | null = null;
  private state: ConnectionState = 'idle';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private hasConnectedBefore = false;
  private deliberatelyClosed = false;

  private readonly socketFactory: SocketFactory;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly pingIntervalMs: number;
  private readonly random: () => number;
  private readonly log: NonNullable<ConnectionOptions['log']>;

  authAck: AuthAck | null = null;

  constructor(
    private readonly opts: ConnectionOptions,
    private readonly events: ConnectionEvents = {},
  ) {
    this.socketFactory =
      opts.socketFactory ??
      ((url) => {
        const Ctor = (globalThis as { WebSocket?: new (u: string) => SocketLike })
          .WebSocket;
        if (!Ctor) {
          throw new Error(
            'no WebSocket implementation available; pass socketFactory explicitly',
          );
        }
        const socket = new Ctor(url);
        // Without this the browser hands us Blobs and every frame needs an
        // async read before it can be decoded.
        socket.binaryType = 'arraybuffer';
        return socket;
      });
    this.baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.random = opts.random ?? Math.random;
    this.log = opts.log ?? (() => {});
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  get isReady(): boolean {
    return this.state === 'ready';
  }

  private setState(next: ConnectionState): void {
    if (next === this.state) return;
    const previous = this.state;
    this.state = next;
    this.events.onStateChange?.(next, previous);
  }

  connect(): void {
    if (this.state === 'connecting' || this.state === 'authenticating') return;
    if (this.state === 'ready') return;

    this.deliberatelyClosed = false;
    this.clearReconnectTimer();
    this.setState('connecting');

    let socket: SocketLike;
    try {
      socket = this.socketFactory(this.opts.url);
    } catch (err) {
      this.log('socket construction failed', err);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.setState('authenticating');
      this.sendAuth();
    };

    socket.onmessage = (event) => {
      const data = toUint8Array(event.data);
      if (!data) return;
      try {
        this.handleFrame(decodeServerFrame(data));
      } catch (err) {
        if (err instanceof ClientProtocolError) {
          // A frame we cannot parse means the server speaks a protocol we do
          // not. Reconnecting will not help; a reload after a deploy will.
          this.log('protocol error, closing', err);
          this.fatal('protocol_violation', err.message);
          return;
        }
        this.log('frame handling threw', err);
      }
    };

    socket.onerror = (event) => {
      this.log('socket error', event);
    };

    socket.onclose = (event) => {
      this.stopPing();
      this.socket = null;
      if (this.deliberatelyClosed || this.state === 'closed') {
        this.setState('closed');
        return;
      }
      this.log(`socket closed (${event.code ?? 'no code'})`);
      this.scheduleReconnect();
    };
  }

  private sendAuth(): void {
    const payload: AuthPayload = {
      protocolVersion: PROTOCOL_VERSION,
      workspaceId: this.opts.credentials.workspaceId,
    };
    const c = this.opts.credentials;
    if (c.sessionToken) payload.sessionToken = c.sessionToken;
    if (c.shareToken) payload.shareToken = c.shareToken;
    if (c.displayName) payload.displayName = c.displayName;
    if (c.sharePassword) payload.sharePassword = c.sharePassword;
    if (c.shareSessionId) payload.shareSessionId = c.shareSessionId;
    this.sendRaw(encodeAuth(payload));
  }

  private handleFrame(frame: ServerFrame): void {
    if (frame.type === ServerMessage.AuthAck) {
      this.authAck = frame.ack;
      this.attempt = 0;
      this.setState('ready');
      this.startPing();

      if (frame.ack.shareSessionId) {
        this.events.onShareSession?.(frame.ack.shareSessionId);
      }
      if (this.hasConnectedBefore) {
        // Handles are per-connection, so every open document must be reopened.
        this.events.onReconnect?.();
      }
      this.hasConnectedBefore = true;
      return;
    }

    if (frame.type === ServerMessage.Error && frame.requestId === 0) {
      if (frame.detail === 'password_required') {
        // Not a failure: the socket stays open for a retry with a password.
        this.events.onPasswordRequired?.();
        return;
      }
      if (FATAL_ERROR_CODES.has(frame.code)) {
        this.fatal(frame.code, frame.detail);
        return;
      }
    }

    if (frame.type === ServerMessage.Pong) return;

    this.events.onFrame?.(frame);
  }

  /** Retry authentication on the same socket, after a password prompt. */
  retryAuth(sharePassword: string): void {
    (this.opts.credentials as Credentials).sharePassword = sharePassword;
    if (this.state === 'authenticating' && this.socket) {
      this.sendAuth();
    } else {
      this.connect();
    }
  }

  send(data: Uint8Array): boolean {
    if (this.state !== 'ready') return false;
    return this.sendRaw(data);
  }

  private sendRaw(data: Uint8Array): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(data);
      return true;
    } catch (err) {
      this.log('send failed', err);
      return false;
    }
  }

  /**
   * Backoff delay for the current attempt.
   *
   * Full jitter: a uniform random value in `[0, min(cap, base * 2^n)]`. A
   * server restart otherwise brings every client back at the same moment, and
   * the herd can hold down an instance that would have recovered.
   */
  backoffDelay(attempt = this.attempt): number {
    const ceiling = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** attempt);
    return Math.floor(this.random() * ceiling);
  }

  private scheduleReconnect(): void {
    if (this.deliberatelyClosed) {
      this.setState('closed');
      return;
    }
    this.setState('reconnecting');
    const delay = this.backoffDelay();
    this.attempt++;
    this.log(`reconnecting in ${delay} ms (attempt ${this.attempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    if (this.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      this.sendRaw(encodePing());
    }, this.pingIntervalMs);
    // Do not hold a Node process open on the keepalive alone.
    (this.pingTimer as { unref?: () => void }).unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private fatal(code: string, detail: string): void {
    this.deliberatelyClosed = true;
    this.clearReconnectTimer();
    this.stopPing();
    this.setState('closed');
    this.socket?.close(1008, code);
    this.socket = null;
    this.events.onFatal?.(code, detail);
  }

  close(): void {
    this.deliberatelyClosed = true;
    this.clearReconnectTimer();
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    this.setState('closed');
    socket?.close(1000, 'client closed');
  }
}

function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // A string frame is a protocol violation on this channel; the server only
  // sends binary. Ignored rather than guessed at.
  return null;
}
