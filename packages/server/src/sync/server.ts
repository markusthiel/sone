/**
 * SONE — WebSocket sync server.
 *
 * Brings together the CRDT store, the room layer and the capability model.
 * The security-critical rule it implements is ADR-0006 rule 1: the ACL is
 * re-checked on **every** document open, not once at connection time. A
 * connection authenticated with a token scoped to page A must not be able to
 * ask for page B.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';

import {
  internalDocId,
  readInternalRequest, ROLE_ORDER, type Role } from '@sone/core';
import type { Pool } from 'pg';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  authorizeDocumentOpen,
  effectiveRole,
  loadPageLocation,
  resolveSessionClaims,
  resolveShareTokenClaims,
  revalidateClaims,
  type AccessClaims,
  type ConnectionCredential,
} from '../auth/claims.js';
import { AuthError } from '../auth/password.js';
import { resolveSessionId } from '../auth/session.js';
import { UpdateBus, fetchUpdatesSince } from './bus.js';
import {
  ClientMessage,
  LIMITS,
  ProtocolError,
  SyncError,
  decodeClientMessage,
  encodeAuthAck,
  type AuthPayload,
  encodeAwareness,
  encodeClosed,
  encodeError,
  encodeOpenAck,
  encodePong,
  encodeRoleChanged,
  encodeSync,
  type SyncErrorCode,
} from './protocol.js';
import { DocumentRoom } from './room.js';

const atLeast = (have: Role, need: Role): boolean =>
  ROLE_ORDER.indexOf(have) >= ROLE_ORDER.indexOf(need);

interface OpenDocument {
  handle: number;
  pageId: string;
  role: Role;
  room: DocumentRoom;
  subscriberId: string;
}

/** Per-connection state. */
class Connection {
  readonly id = randomUUID();
  claims: AccessClaims | null = null;
  /**
   * Which credential authenticated this connection, by id.
   *
   * The token itself is deliberately not retained — the server has no reason
   * to hold a plaintext credential. Ids are enough to re-resolve claims, which
   * is what makes revocation take effect on a live connection.
   */
  credential: ConnectionCredential | null = null;
  readonly documents = new Map<number, OpenDocument>();
  readonly handlesByPage = new Map<string, number>();
  private nextHandle = 1;

  /** Sliding-window counter for update rate limiting. */
  private updateTimestamps: number[] = [];
  authTimer: NodeJS.Timeout | null = null;
  idleTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly socket: WebSocket,
    readonly ipPrefix: string | null,
    /**
     * Session token from the upgrade request's cookie.
     *
     * The browser cannot send the HttpOnly cookie in the auth message, but it
     * does send it with the upgrade request, because that is an ordinary
     * same-origin HTTP request. Reading it here is what lets the cookie stay
     * HttpOnly.
     */
    readonly cookieSessionToken: string | null,
  ) {}

  allocateHandle(): number {
    return this.nextHandle++;
  }

  /**
   * Record an update and report whether the rate limit is exceeded.
   *
   * A sliding window rather than a token bucket: bursts while typing are
   * normal and should pass, sustained flooding should not.
   */
  recordUpdate(now: number): boolean {
    const cutoff = now - LIMITS.rateWindowMs;
    this.updateTimestamps = this.updateTimestamps.filter((t) => t > cutoff);
    this.updateTimestamps.push(now);
    const allowed = (LIMITS.maxUpdatesPerSecond * LIMITS.rateWindowMs) / 1000;
    return this.updateTimestamps.length <= allowed;
  }

  send(data: Uint8Array): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(data, { binary: true });
    }
  }
}

export interface SyncServerOptions {
  pool: Pool;
  databaseUrl: string;
  /** Attach to an existing HTTP server, or run standalone. */
  server?: HttpServer;
  path?: string;
  /** Called for structured logging; defaults to console. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
  /** Passed through to rooms. Zero tears an empty room down immediately. */
  roomLingerMs?: number;
}

/**
 * SHA-1, for deriving an internal document's id (ADR-0057).
 *
 * Passed in rather than imported by core: core runs in a browser too, and
 * `node:crypto` is not there — so the algorithm lives in core and the primitive
 * comes from whoever is calling.
 */
const sha1Of = (data: Uint8Array): Uint8Array => new Uint8Array(createHash('sha1').update(data).digest());

export class SyncServer {
  private readonly wss: WebSocketServer;
  private readonly pool: Pool;
  private readonly rooms = new Map<string, DocumentRoom>();
  private readonly roomLoading = new Map<string, Promise<DocumentRoom>>();
  private readonly connections = new Set<Connection>();
  private readonly bus: UpdateBus;
  private readonly log: NonNullable<SyncServerOptions['log']>;
  private shuttingDown = false;

  constructor(private readonly opts: SyncServerOptions) {
    this.pool = opts.pool;
    this.log =
      opts.log ??
      ((level, msg, meta) => {
        const line = `[sync] ${msg}`;
        if (level === 'error') console.error(line, meta ?? '');
        else if (level === 'warn') console.warn(line, meta ?? '');
        else console.log(line, meta ?? '');
      });

    this.wss = opts.server
      ? new WebSocketServer({
          server: opts.server,
          path: opts.path ?? '/sync',
          maxPayload: LIMITS.maxMessageBytes,
        })
      : new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxMessageBytes });

    this.bus = new UpdateBus(opts.databaseUrl);
    this.wss.on('connection', (socket, request) => {
      this.onConnection(socket, request);
    });
  }

  async start(): Promise<void> {
    await this.bus.start();
    this.bus.onUpdate(({ docId, seq }) => {
      void this.onRemoteUpdate(docId, seq);
    });
    this.log('info', 'sync server started');
  }

  /**
   * Apply an update produced by another instance.
   *
   * Fetches from doc_updates rather than trusting the notification payload,
   * which carries ids only. Reconciles by sequence number so a missed
   * notification self-heals on the next one.
   */
  private async onRemoteUpdate(docId: string, seq: number): Promise<void> {
    const room = this.rooms.get(docId);
    if (!room || room.isDestroyed) return;
    if (room.persistedThroughSeq >= seq) return;

    try {
      const updates = await fetchUpdatesSince(this.pool, docId, room.persistedThroughSeq);
      for (const { payload } of updates) {
        room.applyRemoteUpdate(payload);
      }
    } catch (err) {
      this.log('error', `failed to apply remote updates for ${docId}`, err);
    }
  }

  // --- connection lifecycle ------------------------------------------------

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    if (this.shuttingDown) {
      socket.close(1013, 'server shutting down');
      return;
    }

    const conn = new Connection(
      socket,
      ipPrefixOf(request),
      sessionCookieFrom(request),
    );
    this.connections.add(conn);

    // An unauthenticated connection is a free resource for anyone who can
    // reach the port. Drop it if credentials do not arrive promptly.
    conn.authTimer = setTimeout(() => {
      if (!conn.claims) {
        conn.send(encodeError(0, SyncError.NotAuthenticated, 'auth timeout'));
        socket.close(1008, 'auth timeout');
      }
    }, LIMITS.authTimeoutMs);

    this.armIdleTimer(conn);

    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        conn.send(encodeError(0, SyncError.ProtocolViolation, 'binary frames only'));
        return;
      }
      this.armIdleTimer(conn);
      void this.onMessage(conn, toUint8Array(data));
    });

    socket.on('close', () => {
      void this.onClose(conn);
    });

    socket.on('error', (err) => {
      this.log('warn', `socket error on connection ${conn.id}`, err);
    });
  }

  private armIdleTimer(conn: Connection): void {
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    conn.idleTimer = setTimeout(() => {
      conn.socket.close(1001, 'idle');
    }, LIMITS.idleTimeoutMs);
  }

  private async onMessage(conn: Connection, data: Uint8Array): Promise<void> {
    let message;
    try {
      message = decodeClientMessage(data);
    } catch (err) {
      const code = err instanceof ProtocolError ? err.code : SyncError.ProtocolViolation;
      conn.send(encodeError(0, code, err instanceof Error ? err.message : ''));
      // A peer that cannot frame a message correctly will not recover, and
      // keeping it costs a slot.
      conn.socket.close(1002, 'protocol error');
      return;
    }

    if (message.type === ClientMessage.Auth) {
      await this.handleAuth(conn, message.payload);
      return;
    }

    if (!conn.claims) {
      conn.send(encodeError(0, SyncError.NotAuthenticated));
      conn.socket.close(1008, 'not authenticated');
      return;
    }

    switch (message.type) {
      case ClientMessage.Open:
        await this.handleOpen(conn, message.requestId, message.pageId);
        return;
      case ClientMessage.Sync:
        this.handleSync(conn, message.handle, message.payload);
        return;
      case ClientMessage.Awareness:
        this.handleAwareness(conn, message.handle, message.payload);
        return;
      case ClientMessage.Close:
        this.handleCloseDocument(conn, message.handle);
        return;
      case ClientMessage.Ping:
        conn.send(encodePong());
        return;
    }
  }

  private async handleAuth(conn: Connection, payload: AuthPayload): Promise<void> {
    if (conn.claims) {
      // Re-authenticating mid-connection would leave already-open documents
      // holding roles from the previous identity.
      conn.send(encodeError(0, SyncError.ProtocolViolation, 'already authenticated'));
      conn.socket.close(1002, 'already authenticated');
      return;
    }

    // No explicit token means "use the upgrade request's cookie".
    const sessionToken = payload.sessionToken ?? conn.cookieSessionToken;

    if (!sessionToken && !payload.shareToken) {
      conn.send(encodeError(0, SyncError.AuthFailed, 'no credential'));
      conn.socket.close(1008, 'auth failed');
      return;
    }

    try {
      if (sessionToken && !payload.shareToken) {
        const claims = await resolveSessionClaims(
          this.pool,
          sessionToken,
          payload.workspaceId,
        );
        if (!claims) {
          conn.send(encodeError(0, SyncError.AuthFailed));
          conn.socket.close(1008, 'auth failed');
          return;
        }
        const session = await resolveSessionId(this.pool, sessionToken);
        if (!session) {
          conn.send(encodeError(0, SyncError.AuthFailed));
          conn.socket.close(1008, 'auth failed');
          return;
        }
        conn.claims = claims;
        conn.credential = { kind: 'session', sessionId: session };
        conn.send(
          encodeAuthAck({
            principalKind: claims.principal.kind,
            displayName: claims.principal.displayName,
            workspaceRole: claims.workspaceRole,
          }),
        );
      } else {
        const resolved = await resolveShareTokenClaims(this.pool, payload.shareToken!, {
          displayName: payload.displayName ?? null,
          password: payload.sharePassword ?? null,
          ipPrefix: conn.ipPrefix,
          existingShareSessionId: payload.shareSessionId ?? null,
        });
        if (!resolved) {
          conn.send(encodeError(0, SyncError.AuthFailed));
          conn.socket.close(1008, 'auth failed');
          return;
        }
        if (resolved.passwordRequired) {
          // Not a failure: the client must prompt and retry. The connection
          // stays open but unauthenticated, and the auth timer still applies.
          conn.send(encodeError(0, SyncError.AuthFailed, 'password_required'));
          return;
        }
        conn.claims = resolved.claims;
        const principal = resolved.claims.principal;
        const grant = resolved.claims.grants[0];
        if (principal.kind === 'anonymous' && grant?.tokenId) {
          conn.credential = {
            kind: 'share',
            shareTokenId: grant.tokenId,
            shareSessionId: principal.sessionId,
          };
        }
        conn.send(
          encodeAuthAck({
            principalKind: principal.kind,
            displayName: principal.displayName,
            workspaceRole: null,
            ...(principal.kind === 'anonymous'
              ? { shareSessionId: principal.sessionId }
              : {}),
          }),
        );
      }

      if (conn.authTimer) {
        clearTimeout(conn.authTimer);
        conn.authTimer = null;
      }
    } catch (err) {
      const code = err instanceof AuthError ? SyncError.AuthFailed : SyncError.Internal;
      if (!(err instanceof AuthError)) {
        this.log('error', 'auth threw', err);
      }
      conn.send(encodeError(0, code));
      conn.socket.close(1008, 'auth failed');
    }
  }

  /**
   * Open a document.
   *
   * The authorisation call here is the one that matters. It runs for every
   * open, including documents reached from an already-open page, because a
   * share token's scope is a subtree and the client is free to ask for
   * anything.
   */
  private async handleOpen(
    conn: Connection,
    requestId: number,
    asked: string,
  ): Promise<void> {
    /*
     * A page, or a page's internal comments (ADR-0057).
     *
     * The suffix rather than a field in the open message: the message is
     * `[Open, requestId, pageId]` on the wire, and a boolean would change that
     * shape and cost a protocol version for one bit.
     *
     * `pageId` below is the *page*, which is what everything authorises
     * against; `docId` is what the room is keyed by, and the two differ only
     * for an internal request.
     */
    const { pageId, internal } = readInternalRequest(asked);

    if (conn.documents.size >= LIMITS.maxDocumentsPerConnection) {
      conn.send(encodeError(requestId, SyncError.TooManyDocuments));
      return;
    }

    // Idempotent: asking twice returns the existing handle rather than
    // creating a second subscription to the same room.
    // Keyed by what was asked for, so a page and its internal comments are two
    // handles rather than one that returns whichever was opened first.
    const existing = conn.handlesByPage.get(asked);
    if (existing !== undefined) {
      const doc = conn.documents.get(existing);
      if (doc) {
        conn.send(encodeOpenAck(requestId, existing, doc.role));
        return;
      }
    }

    let role: Role;
    let workspaceId: string;
    try {
      const authorized = await authorizeDocumentOpen(this.pool, conn.claims!, pageId);
      role = authorized.role;
      workspaceId = authorized.page.workspaceId;

      /*
       * Internal comments require membership, not read access.
       *
       * The page's own room accepts anybody with `viewer`, which includes a
       * share-link visitor — and that is the whole reason this document exists.
       * Refused rather than served empty: a room that opens and stays empty is
       * a room somebody spends an afternoon debugging (ADR-0057).
       */
      if (
        internal &&
        (conn.claims!.principal.kind !== 'user' || conn.claims!.workspaceRole === null)
      ) {
        conn.send(encodeError(requestId, SyncError.NotAuthorized));
        return;
      }
    } catch (err) {
      if (err instanceof AuthError) {
        // Same response whether the page is missing or forbidden: the
        // distinction tells a caller which pages exist.
        conn.send(encodeError(requestId, SyncError.NotAuthorized));
        return;
      }
      this.log('error', `open failed for ${pageId}`, err);
      conn.send(encodeError(requestId, SyncError.Internal));
      return;
    }

    let room: DocumentRoom;
    try {
      room = await this.acquireRoom(
        internal ? internalDocId(pageId, sha1Of) : pageId,
        workspaceId,
      );
    } catch (err) {
      this.log('error', `failed to load room ${pageId}`, err);
      conn.send(encodeError(requestId, SyncError.Internal));
      return;
    }

    const handle = conn.allocateHandle();
    const subscriberId = `${conn.id}:${handle}`;
    const canWrite = atLeast(role, 'editor');

    room.addSubscriber({
      id: subscriberId,
      handle,
      canWrite,
      send: (payload) => conn.send(encodeSync(handle, payload)),
      sendAwareness: (payload) => conn.send(encodeAwareness(handle, payload)),
    });

    conn.documents.set(handle, { handle, pageId, role, room, subscriberId });
    conn.handlesByPage.set(asked, handle);

    conn.send(encodeOpenAck(requestId, handle, role));
    // Sync step 1 immediately: the client cannot compute its delta without the
    // server's state vector.
    conn.send(encodeSync(handle, room.encodeSyncStep1()));

    const awareness = room.encodeAwarenessState();
    if (awareness) conn.send(encodeAwareness(handle, awareness));
  }

  /**
   * Get or create a room, without duplicating work under concurrent opens.
   *
   * Two clients opening the same cold document simultaneously must share one
   * room. Without the in-flight promise map, both would load a Y.Doc and one
   * would be silently discarded along with any updates applied to it.
   */
  private async acquireRoom(pageId: string, workspaceId: string): Promise<DocumentRoom> {
    const existing = this.rooms.get(pageId);
    if (existing && !existing.isDestroyed) return existing;

    const loading = this.roomLoading.get(pageId);
    if (loading) return loading;

    const promise = DocumentRoom.open({
      pool: this.pool,
      pageId,
      workspaceId,
      ...(this.opts.roomLingerMs !== undefined
        ? { lingerMs: this.opts.roomLingerMs }
        : {}),
    })
      .then((room) => {
        this.rooms.set(pageId, room);
        this.roomLoading.delete(pageId);
        return room;
      })
      .catch((err) => {
        this.roomLoading.delete(pageId);
        throw err;
      });

    this.roomLoading.set(pageId, promise);
    return promise;
  }

  private handleSync(conn: Connection, handle: number, payload: Uint8Array): void {
    const doc = conn.documents.get(handle);
    if (!doc) {
      conn.send(encodeError(0, SyncError.UnknownHandle));
      return;
    }

    if (!conn.recordUpdate(Date.now())) {
      conn.send(encodeError(0, SyncError.RateLimited));
      return;
    }

    const canWrite = atLeast(doc.role, 'editor');
    doc.room.setActor(actorIdOf(conn.claims!));

    const { reply, rejectedWrite } = doc.room.handleSyncMessage(
      doc.subscriberId,
      payload,
      canWrite,
    );

    if (rejectedWrite) {
      // Explicit refusal, not silence: a client whose edit is dropped without
      // notice believes it succeeded and will show diverged content.
      conn.send(encodeError(0, SyncError.ReadOnly));
      return;
    }
    if (reply) conn.send(encodeSync(handle, reply));
  }

  private handleAwareness(conn: Connection, handle: number, payload: Uint8Array): void {
    const doc = conn.documents.get(handle);
    if (!doc) {
      conn.send(encodeError(0, SyncError.UnknownHandle));
      return;
    }
    // Presence is permitted for readers: a viewer's cursor is useful and
    // touches no document state.
    doc.room.handleAwarenessMessage(doc.subscriberId, payload);
  }

  private handleCloseDocument(conn: Connection, handle: number): void {
    const doc = conn.documents.get(handle);
    if (!doc) return;
    doc.room.removeSubscriber(doc.subscriberId);
    conn.documents.delete(handle);
    conn.handlesByPage.delete(doc.pageId);
    this.maybeRetireRoom(doc.room);
  }

  private maybeRetireRoom(room: DocumentRoom): void {
    if (room.subscriberCount > 0 || room.isDestroyed) return;
    room.scheduleLinger(() => {
      if (room.subscriberCount > 0) return;
      this.rooms.delete(room.pageId);
      void room.destroy().catch((err) => {
        this.log('error', `room teardown failed for ${room.pageId}`, err);
      });
    });
  }

  private async onClose(conn: Connection): Promise<void> {
    this.connections.delete(conn);
    for (const timer of [conn.authTimer, conn.idleTimer]) {
      if (timer) clearTimeout(timer);
    }

    for (const doc of conn.documents.values()) {
      doc.room.removeSubscriber(doc.subscriberId);
      this.maybeRetireRoom(doc.room);
    }
    conn.documents.clear();
    conn.handlesByPage.clear();
  }

  // --- revocation ----------------------------------------------------------

  /**
   * Force-close documents whose access has been revoked.
   *
   * Called after a share link is revoked or a permission is removed.
   * Revocation that only affects the next connection is not revocation: an
   * anonymous editor with an open socket would keep writing.
   */
  async revokeAccess(pageId: string): Promise<void> {
    for (const conn of [...this.connections]) {
      if (!conn.handlesByPage.has(pageId)) continue;
      await this.revalidateConnection(conn);
    }
  }

  /**
   * Re-resolve a connection's claims and close anything it may no longer see.
   *
   * This is the piece that makes revocation real. Claims are a snapshot from
   * authentication time, so without re-resolution a revoked share link keeps
   * working until the client happens to reconnect — which for a WebSocket may
   * be hours. Re-resolution works from credential ids, never the token.
   *
   * Also downgrades in place: a connection whose role drops from editor to
   * viewer keeps the document open and is told, rather than being disconnected.
   */
  async revalidateConnection(conn: Connection): Promise<void> {
    if (!conn.credential || !conn.claims) return;

    let claims: AccessClaims | null;
    try {
      claims = await revalidateClaims(
        this.pool,
        conn.credential,
        conn.claims.workspaceId,
      );
    } catch (err) {
      this.log('error', `revalidation failed for connection ${conn.id}`, err);
      return;
    }

    if (!claims) {
      // The credential itself is gone: session revoked, link revoked, user
      // disabled, membership removed.
      for (const doc of [...conn.documents.values()]) {
        conn.send(encodeClosed(doc.handle, SyncError.NotAuthorized));
        this.handleCloseDocument(conn, doc.handle);
      }
      conn.send(encodeError(0, SyncError.NotAuthorized));
      conn.socket.close(1008, 'access revoked');
      return;
    }

    conn.claims = claims;

    for (const doc of [...conn.documents.values()]) {
      const page = await loadPageLocation(this.pool, doc.pageId);
      const role = page ? effectiveRole(claims, page) : null;

      if (role === null) {
        conn.send(encodeClosed(doc.handle, SyncError.NotAuthorized));
        this.handleCloseDocument(conn, doc.handle);
        continue;
      }

      if (role !== doc.role) {
        doc.role = role;
        doc.room.setSubscriberWritable(doc.subscriberId, atLeast(role, 'editor'));
        conn.send(encodeRoleChanged(doc.handle, role));
      }
    }
  }

  /** Revalidate every connection. Called by the periodic sweep. */
  async revalidateAll(): Promise<void> {
    for (const conn of [...this.connections]) {
      await this.revalidateConnection(conn);
    }
  }

  // --- shutdown ------------------------------------------------------------

  /**
   * Flush every room and close cleanly.
   *
   * Must be awaited on SIGTERM. Rooms hold up to PERSIST_MAX_DELAY_MS of
   * unpersisted edits, and exiting without this loses them — which during a
   * routine container restart would be user-visible data loss.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    for (const conn of this.connections) {
      conn.socket.close(1001, 'server shutting down');
    }

    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    const results = await Promise.allSettled(rooms.map((room) => room.destroy()));
    for (const result of results) {
      if (result.status === 'rejected') {
        this.log('error', 'room failed to flush during shutdown', result.reason);
      }
    }

    await this.bus.stop();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    this.log('info', 'sync server stopped');
  }

  /**
   * Flush and release every room, keeping the server accepting connections.
   *
   * Used by tests between cases, and by an operator draining an instance
   * before a restart without dropping live connections.
   */
  async drainRooms(): Promise<void> {
    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    const results = await Promise.allSettled(rooms.map((room) => room.destroy()));
    for (const result of results) {
      if (result.status === 'rejected') {
        this.log('error', 'room failed to flush during drain', result.reason);
      }
    }
  }

  /** Rooms that have given up persisting. Surfaced by the health endpoint. */
  get poisonedRooms(): Array<{ pageId: string; reason: string | null }> {
    return [...this.rooms.values()]
      .filter((room) => room.isPoisoned)
      .map((room) => ({ pageId: room.pageId, reason: room.poisonedBecause }));
  }

  /** Handle an HTTP upgrade when running in noServer mode. */
  handleUpgrade(
    request: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  get stats(): { connections: number; rooms: number } {
    return { connections: this.connections.size, rooms: this.rooms.size };
  }
}

// --- helpers ---------------------------------------------------------------

function actorIdOf(claims: AccessClaims): string | null {
  const principal = claims.principal;
  return principal.kind === 'anonymous' ? null : principal.userId;
}

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(0);
}

/**
 * Session token from the upgrade request's cookie.
 *
 * Duplicating the cookie name rather than importing from http/auth.ts keeps the
 * sync server independent of the HTTP layer; the constant is asserted equal in
 * a test so the two cannot drift.
 */
function sessionCookieFrom(request: IncomingMessage): string | null {
  const header = request.headers['cookie'];
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    if (part.slice(0, eq).trim() !== 'sone_session') continue;
    const value = part.slice(eq + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/**
 * Truncate the client address before it is stored.
 *
 * /24 for IPv4 and /48 for IPv6: enough to rate-limit and to show an operator
 * roughly where a session came from, not enough to be a tracking identifier.
 */
function ipPrefixOf(request: IncomingMessage): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  const raw =
    (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded?.[0]) ??
    request.socket.remoteAddress ??
    null;
  if (!raw) return null;

  const address = raw.trim().replace(/^::ffff:/, '');
  if (address.includes(':')) {
    const groups = address.split(':').slice(0, 3);
    return `${groups.join(':')}::/48`;
  }
  const octets = address.split('.');
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

export { SyncError, type SyncErrorCode };
