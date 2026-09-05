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
  ACCESS_SCOPE,
  LIMITS,
  NotifyScope,
  WORKSPACE_SCOPES,
  ProtocolError,
  SyncError,
  decodeClientMessage,
  encodeAuthAck,
  type AuthPayload,
  encodeAwareness,
  encodeClosed,
  encodeError,
  encodeNotify,
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
  /**
   * The account this connection belongs to, once authenticated (ADR-0093).
   *
   * Held beside the claims rather than read out of them at close time: claims
   * are replaced by revalidation, and a connection removed from the index under
   * a key it is no longer filed under stays there for the life of the process.
   */
  accountId: string | null = null;
  /**
   * The workspace this connection authenticated for (ADR-0096).
   *
   * Held for the same reason as the account above: claims are replaced by
   * revalidation, and a connection removed from an index under a key it is no
   * longer filed under stays there for the life of the process.
   */
  workspaceId: string | null = null;
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
  /**
   * Authenticated connections by person (ADR-0093).
   *
   * The rest of this server is indexed by document, which is why the bell could
   * not be pushed to: a notification is about a **person**, and the page they
   * happen to have open is unrelated to it — usually it is not even the page the
   * notification points at.
   *
   * A set per person rather than a connection, because a person is not a
   * connection: the phone in their hand and the tab on their desk are two, and a
   * badge that appears on one of them is the reported bug wearing a hat.
   */
  private readonly byUser = new Map<string, Set<Connection>>();
  /**
   * Authenticated connections by workspace (ADR-0096).
   *
   * The second index, and the pair is the point: an inbox belongs to a person
   * and a page tree belongs to a workspace, so a nudge about one cannot be
   * addressed the way a nudge about the other is. A connection authenticates
   * for exactly one workspace, which is what makes this a plain map rather than
   * a question.
   */
  private readonly byWorkspace = new Map<string, Set<Connection>>();
  /** Workspaces being revalidated, and those asked for again while one ran. */
  private readonly revalidating = new Set<string>();
  private readonly revalidateAgain = new Set<string>();
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
    this.bus.onInboxChanged(({ userId }) => {
      this.notifyPerson(userId, NotifyScope.Inbox);
    });
    this.bus.onWorkspaceChanged(({ workspaceId, scope }) => {
      /*
       * Checked against the protocol's own list before it goes on the wire
       * (ADR-0097).
       *
       * The scope arrives in a NOTIFY payload written by a trigger — our own
       * SQL, and still not this process. An allow-list is one line, and a
       * string that reached clients because a migration typed it is a contract
       * nobody agreed to.
       */
      /*
       * One scope is for this server rather than for a client (ADR-0099).
       *
       * Claims are resolved once, at authentication, and a document open checks
       * against that snapshot. So a grant given or taken away while somebody is
       * connected reached the tree — fetched per request over HTTP — and not
       * the connection that serves the documents the tree points at.
       */
      if (scope === ACCESS_SCOPE) {
        void this.revalidateWorkspace(workspaceId);
        return;
      }
      if (!WORKSPACE_SCOPES.includes(scope)) {
        this.log('warn', `ignoring unknown workspace scope ${scope}`);
        return;
      }
      this.notifyWorkspace(workspaceId, scope);
    });
    this.log('info', 'sync server started');
  }

  /**
   * Tell somebody that something they count has changed.
   *
   * A nudge and nothing else: no count, no excerpt. The client refetches the
   * list it already owns and counts that, which is the rule ADR-0092 arrived at
   * after a badge and a list spent a release disagreeing — and putting the
   * number on the wire here would recreate the disagreement with a faster
   * courier.
   *
   * Nobody is looked up in the database on this path. The index is built from
   * claims that were resolved at authentication and re-resolved on revocation,
   * so a notification for a person with no connection here costs a map miss.
   */
  private notifyPerson(userId: string, scope: string): void {
    const conns = this.byUser.get(userId);
    if (!conns) return;
    const frame = encodeNotify(scope);
    for (const conn of conns) conn.send(frame);
  }

  /**
   * Tell everybody with this workspace open that one of its lists changed
   * (ADR-0096, ADR-0097).
   *
   * Everybody, without asking who may see the change — because the frame does
   * not carry the change. It says which list to fetch again, and the route that
   * serves that list is the one place that decides what each of them gets back.
   * Filtering here would mean this server resolving a page's access per
   * connection, which is a second answer to a question those routes already
   * answer (ADR-0086).
   */
  private notifyWorkspace(workspaceId: string, scope: string): void {
    const conns = this.byWorkspace.get(workspaceId);
    if (!conns) return;
    const frame = encodeNotify(scope);
    for (const conn of conns) conn.send(frame);
  }

  /** Index an authenticated connection under whoever it belongs to. */
  private rememberPerson(conn: Connection): void {
    /*
     * The workspace first, because everybody has one.
     *
     * A share-link visitor has no account and therefore no inbox (ADR-0046),
     * and they do have a tree: the list of what the link reaches. So the two
     * indexes are filled under different conditions, and the early return below
     * used to skip both.
     */
    const workspaceId = conn.claims?.workspaceId;
    if (workspaceId) {
      conn.workspaceId = workspaceId;
      let group = this.byWorkspace.get(workspaceId);
      if (!group) {
        group = new Set();
        this.byWorkspace.set(workspaceId, group);
      }
      group.add(conn);
    }

    const userId = accountOf(conn.claims);
    if (!userId) return;
    conn.accountId = userId;
    let conns = this.byUser.get(userId);
    if (!conns) {
      conns = new Set();
      this.byUser.set(userId, conns);
    }
    conns.add(conn);
  }

  private forgetPerson(conn: Connection): void {
    if (conn.workspaceId) {
      const group = this.byWorkspace.get(conn.workspaceId);
      if (group) {
        group.delete(conn);
        if (group.size === 0) this.byWorkspace.delete(conn.workspaceId);
      }
      conn.workspaceId = null;
    }

    if (!conn.accountId) return;
    const conns = this.byUser.get(conn.accountId);
    if (!conns) return;
    conns.delete(conn);
    // Emptied rather than left behind: this map is keyed by every person who has
    // ever connected to this instance, and a set that is never removed is a leak
    // that only shows up on an instance that has been up for a month.
    if (conns.size === 0) this.byUser.delete(conn.accountId);
    conn.accountId = null;
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
          /*
           * The cookie that came with the upgrade request (ADR-0101).
           *
           * A share token and a session token are mutually exclusive in the
           * auth message, and the **cookie** travels regardless — so somebody
           * signed in who opens a link that requires an account is admitted
           * here for the same reason the HTTP route admits them.
           */
          signedIn: Boolean(conn.cookieSessionToken),
        });
        if (!resolved) {
          conn.send(encodeError(0, SyncError.AuthFailed));
          conn.socket.close(1008, 'auth failed');
          return;
        }
        if (resolved.signInRequired) {
          /*
           * The link admits people with accounts, and this connection presented
           * only the link (ADR-0101).
           *
           * Refused rather than admitted with empty claims: those would
           * authenticate a connection that may do nothing, which is a session
           * somebody then has to explain. The browser reaches
           * `GET /api/share/:token` before it opens this socket and is told
           * there, in a sentence.
           */
          conn.send(encodeError(0, SyncError.AuthFailed, 'sign_in_required'));
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

      // After both branches, so the one rule covers a session and a share link
      // alike: whoever has an account is reachable, whoever does not is not
      // filed under anything (ADR-0093).
      this.rememberPerson(conn);

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
      room = internal
        ? // The room is keyed by the derived id and told which page it belongs
          // to: without the second the projection ran as a page's and created
          // one (ADR-0057).
          await this.acquireRoom(internalDocId(pageId, sha1Of), workspaceId, pageId)
        : await this.acquireRoom(pageId, workspaceId);
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
  private async acquireRoom(
    pageId: string,
    workspaceId: string,
    /** The page whose internal comments this document holds (ADR-0057). */
    commentsFor?: string,
  ): Promise<DocumentRoom> {
    const existing = this.rooms.get(pageId);
    if (existing && !existing.isDestroyed) return existing;

    const loading = this.roomLoading.get(pageId);
    if (loading) return loading;

    const promise = DocumentRoom.open({
      ...(commentsFor === undefined ? {} : { commentsFor }),
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
    /*
     * Only somebody who could have written it.
     *
     * This ran unconditionally, so a reader opening the page — which sends a
     * sync step like anybody else — became the actor of the next flush. The
     * actor is what the projection records as "who edited this" and what a
     * mention was compared against, so a reader could take the credit for
     * somebody else's paragraph and, worse, silently swallow their own mention
     * (ADR-0091).
     *
     * Still best-effort: a flush covers several people's edits and keeps one
     * actor, which the room says plainly. But "the last person who could write"
     * is a defensible approximation and "the last person who said anything" is
     * not one.
     */
    if (canWrite) doc.room.setActor(actorIdOf(conn.claims!));

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
    this.forgetPerson(conn);
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
   * Re-resolve everybody connected to a workspace whose access rules moved.
   *
   * This replaced `revokeAccess(pageId)`, which was written for exactly this
   * job — "revocation that only affects the next connection is not revocation:
   * an anonymous editor with an open socket would keep writing" — and was
   * **called by nothing** (ADR-0099). The only refresh in the system was the
   * maintenance sweep, every five minutes.
   *
   * By workspace rather than by page, because the trigger that sets this off
   * says which workspace and deliberately not which page: a grant on a folder
   * changes access to everything under it, and a page moved changes what its
   * whole subtree inherits. Working out the affected pages here would be a
   * second answer to a question `effectiveRole` already answers per document,
   * which is what `revalidateConnection` then asks.
   *
   * **Coalesced**, because an import can write a subtree's permissions as many
   * statements and each one is a nudge: a revalidation in flight absorbs the
   * ones that arrive during it, and one more runs afterwards to cover whatever
   * changed while it was working.
   */
  async revalidateWorkspace(workspaceId: string): Promise<void> {
    if (this.revalidating.has(workspaceId)) {
      this.revalidateAgain.add(workspaceId);
      return;
    }
    this.revalidating.add(workspaceId);
    try {
      for (const conn of [...(this.byWorkspace.get(workspaceId) ?? [])]) {
        await this.revalidateConnection(conn);
      }
    } catch (err) {
      this.log('error', `revalidating workspace ${workspaceId} failed`, err);
    } finally {
      this.revalidating.delete(workspaceId);
    }
    if (this.revalidateAgain.delete(workspaceId)) {
      await this.revalidateWorkspace(workspaceId);
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

/**
 * The account behind a connection, or none.
 *
 * The same question `actorIdOf` asks, kept as its own function because it is
 * asked for a different reason and the two would not move together: an actor is
 * about who wrote something, this is about who to tell. A share-link visitor has
 * no account and therefore no inbox (ADR-0046) — filing them under a placeholder
 * key is the shape both of the last fortnight's guest bugs had.
 */
function accountOf(claims: AccessClaims | null): string | null {
  if (!claims) return null;
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
