/**
 * SONE client — the assembled client.
 *
 * Wires the connection to the store so callers deal with one object. Kept
 * separate from both so each stays testable in isolation.
 */

import {
  SyncConnection,
  type ConnectionFailure,
  type ConnectionOptions,
  type ConnectionState,
} from './connection.js';
import { DocumentStore, type PageHandle, type PresenceState } from './store.js';

export interface SoneClientOptions extends ConnectionOptions {
  presence?: Partial<PresenceState>;
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

  constructor(opts: SoneClientOptions) {
    // Constructed in this order because the store needs the connection, and
    // the connection's callbacks need the store. The store is created first
    // with a reference filled in immediately after.
    let store!: DocumentStore;

    this.connection = new SyncConnection(opts, {
      onFrame: (frame) => store.handleFrame(frame),
      ...(opts.onConnectionTrouble
        ? { onConnectionTrouble: opts.onConnectionTrouble }
        : {}),
      onReconnect: () => store.handleReconnect(),
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
  }
}
