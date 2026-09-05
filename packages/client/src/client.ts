/**
 * SONE client — the assembled client.
 *
 * Wires the connection to the store so callers deal with one object. Kept
 * separate from both so each stays testable in isolation.
 */

import type * as Y from 'yjs';
import {
  SyncConnection,
  type ConnectionFailure,
  type ConnectionOptions,
  type ConnectionState,
} from './connection.js';
import { DocumentStore, type PageHandle, type PresenceState } from './store.js';

export interface SoneClientOptions extends ConnectionOptions {
  presence?: Partial<PresenceState>;
  /**
   * Keep a copy of each document locally.
   *
   * Passed through to the store, which is where the reasoning lives. Omitting
   * it means no local copy — the right answer for anybody on a machine that is
   * not theirs.
   */
  persist?: (docId: string, doc: Y.Doc) => { destroy: () => void } | null;
  onStateChange?: (state: ConnectionState) => void;
  onFatal?: (code: string, detail: string) => void;
  onPasswordRequired?: () => void;
  /** Persist the anonymous share session so presence survives a reload. */
  onShareSession?: (shareSessionId: string) => void;
  /**
   * A connection attempt failed, with why.
   *
   * Passed through so the interface can say what is wrong instead of showing an
   * indefinite "Syncing…" for a connection that was never established.
   */
  onConnectionTrouble?: (failure: ConnectionFailure) => void;
}

export class SoneClient {
  readonly connection: SyncConnection;
  readonly store: DocumentStore;

  /**
   * Who wants to hear about a nudge, by scope (ADR-0093).
   *
   * A subscription rather than a constructor callback, and that is the whole
   * design decision here: the client is created where the workspace is known
   * and the bell lives several components away, so a callback passed at
   * construction would have to be threaded down through everything in between —
   * or, worse, would tempt somebody to build a second client for the bell.
   */
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(opts: SoneClientOptions) {
    // Constructed in this order because the store needs the connection, and
    // the connection's callbacks need the store. The store is created first
    // with a reference filled in immediately after.
    let store!: DocumentStore;

    this.connection = new SyncConnection(opts, {
      onFrame: (frame) => store.handleFrame(frame),
      // Every authentication, including the first: documents opened while the
      // connection was still coming up have to be re-issued.
      onAuthenticated: () => store.handleAuthenticated(),
      ...(opts.onConnectionTrouble
        ? { onConnectionTrouble: opts.onConnectionTrouble }
        : {}),
      onReconnect: () => store.handleReconnect(),
      onNotify: (scope) => this.emitNotify(scope),
      onStateChange: (state, previous) => {
        // A transition away from ready means every document is stale until the
        // handshake runs again.
        if (previous === 'ready' && state !== 'ready') {
          store.handleDisconnect();
        }
        opts.onStateChange?.(state);
      },
      onFatal: (code, detail) => {
        // Documents must be told, or handles stay in 'opening' and the UI
        // spins instead of reporting that access is gone.
        store.handleFatal(code);
        opts.onFatal?.(code, detail);
      },
      ...(opts.onPasswordRequired ? { onPasswordRequired: opts.onPasswordRequired } : {}),
      ...(opts.onShareSession ? { onShareSession: opts.onShareSession } : {}),
    });

    store = new DocumentStore({
      connection: this.connection,
      ...(opts.presence ? { presence: opts.presence } : {}),
      ...(opts.log ? { log: opts.log } : {}),
    });
    this.store = store;
  }

  /**
   * Be told when the server says something in `scope` changed.
   *
   * Returns the unsubscribe, so a component that mounts twice does not end up
   * refetching twice per nudge.
   */
  onNotify(scope: string, handler: () => void): () => void {
    let set = this.listeners.get(scope);
    if (!set) {
      set = new Set();
      this.listeners.set(scope, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(scope);
    };
  }

  private emitNotify(scope: string): void {
    for (const handler of this.listeners.get(scope) ?? []) {
      try {
        handler();
      } catch {
        // A listener that throws is a bug in that listener; it must not stop
        // the others being told, and it must not take the socket down.
      }
    }
  }

  connect(): void {
    this.connection.connect();
  }

  openPage(pageId: string): PageHandle {
    return this.store.open(pageId);
  }

  get state(): ConnectionState {
    return this.connection.currentState;
  }

  /** True when there are local changes the server has not acknowledged. */
  /**
   * Why the connection is not established, if it is not.
   *
   * Surfaced so the interface can say something specific. "Syncing…" for "the
   * sync server was never reached" suggests progress that is not happening and
   * hides the one fact somebody could act on.
   */
  get connectionFailure(): ConnectionFailure | null {
    return this.connection.failure;
  }

  get hasUnsyncedChanges(): boolean {
    return this.store.stats.unsynced > 0;
  }

  close(): void {
    this.connection.close();
    this.store.destroy();
    this.listeners.clear();
  }
}
