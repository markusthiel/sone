/**
 * SONE client — the document store.
 *
 * Owns the Y.Docs, drives the Yjs sync handshake, and survives reconnects.
 * No React, no DOM (ADR-0016): every interesting bug in a local-first client
 * is in here, and this way it can be tested without a renderer.
 *
 * ## Refcounting
 *
 * Two components opening the same page must share one Y.Doc. Opening returns a
 * handle; the document is released when the last handle is released. Without
 * refcounting, a sidebar preview and the main editor would hold two divergent
 * copies of the same page.
 *
 * ## The handshake
 *
 * y-protocols is bidirectional and this is easy to get wrong. The server sends
 * its step 1 (state vector) on open, which tells the client what to *send*.
 * The client must send its own step 1 to learn what it is *missing*. A client
 * that only answers the server's step 1 stays empty forever — a bug that
 * actually happened here, caught by a server test.
 *
 * ## Offline
 *
 * Edits made while disconnected accumulate in the local Y.Doc. On reconnect the
 * handshake exchanges state vectors and both sides converge; nothing needs an
 * explicit queue, which is the point of using CRDTs. What does need care is
 * that a document must not be *dropped* while offline, so releasing the last
 * handle keeps unsynced state until it has been acknowledged.
 */

import { docChannel } from '@sone/core';
import * as awarenessProtocol from 'y-protocols/awareness';

import { recordAttribution } from './attribution.js';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import {
  ServerMessage,
  canWrite,
  encodeAwareness,
  encodeCloseDocument,
  encodeOpen,
  encodeSync,
  type Role,
  type ServerFrame,
} from './protocol.js';
import type { SyncConnection } from './connection.js';

export type DocumentStatus =
  /** Requested, waiting for the server. */
  | 'opening'
  /** Handshake in flight; content may be incomplete. */
  | 'syncing'
  /** In sync with the server. */
  | 'synced'
  /** Local edits not yet acknowledged, or connection down. */
  | 'offline'
  /** Access refused or revoked. */
  | 'denied';

/**
 * Presence, plus the shape y-prosemirror insists on.
 *
 * The editor's caret labels read `user.name` and `user.color` from each
 * awareness state — a field this project does not otherwise have, since it calls
 * the same things `displayName` and `color`. Without it the label showed nothing
 * useful and the caret was drawn in y-prosemirror's fallback orange, so every
 * collaborator looked identical and unnamed.
 *
 * Published as a copy rather than by renaming the presence fields: `displayName`
 * is what the rest of the application calls it, and one library's expectation is
 * not a reason to rename a model. The copy lives here, at the single point where
 * presence is published, so the two cannot drift.
 */
export function withEditorUser(presence: Partial<PresenceState>): Record<string, unknown> {
  return {
    ...presence,
    user: {
      // Empty counts as missing. `??` alone let an empty display name through —
      // and an account can have one, since a name is not required at setup —
      // which would draw a coloured label with nothing in it.
      name:
        typeof presence.displayName === 'string' && presence.displayName !== ''
          ? presence.displayName
          : 'Someone',
      // y-prosemirror replaces anything that is not a 6-digit hex colour with
      // its own orange, which is what made every caret the same colour.
      color: /^#[0-9a-f]{6}$/i.test(presence.color ?? '') ? presence.color : '#8e8e8e',
    },
  };
}

export interface PresenceState {
  displayName: string;
  color: string;
  userId: string | null;
  isAnonymous: boolean;
  /** Editor-specific cursor payload; opaque here. */
  cursor?: unknown;
}

export interface PageHandle {
  readonly pageId: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly status: DocumentStatus;
  readonly role: Role | null;
  readonly canEdit: boolean;
  /** Other participants, excluding this client. */
  peers(): PresenceState[];
  setPresence(state: Partial<PresenceState> | null): void;
  subscribe(listener: (handle: PageHandle) => void): () => void;
  release(): void;
}

interface Entry {
  pageId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  refCount: number;
  handle: number | null;
  requestId: number | null;
  role: Role | null;
  status: DocumentStatus;
  /** True once the server has acknowledged everything we sent. */
  synced: boolean;
  listeners: Set<(handle: PageHandle) => void>;
  /** Unsubscribe the doc/awareness observers, on teardown. */
  detach: () => void;
  /** The local copy, if one is being kept. Destroyed with the entry. */
  persistence: { destroy: () => void } | null;
}

export interface StoreOptions {
  connection: SyncConnection;
  /** Presence identity for this client. */
  presence?: Partial<PresenceState>;
  /**
   * Keep a copy of each document locally.
   *
   * Injected rather than imported, for two reasons. The store has no business
   * knowing about IndexedDB — it is a browser API, and this package is used in
   * tests under Node where it does not exist. And whether to keep a local copy
   * at all is a decision about the person, not about syncing: a guest on a
   * borrowed machine should not leave documents behind, so the caller decides
   * and can decline by not passing this.
   *
   * Returning null declines for one document. The returned handle is destroyed
   * when the document is released.
   */
  persist?: (docId: string, doc: Y.Doc) => { destroy: () => void } | null;
  /**
   * Record who wrote what.
   *
   * On unless switched off (ADR-0022). Anonymous visitors are never recorded —
   * they have no user id to record against, and attributing to "a guest" would
   * make one contributor out of several people.
   */
  attribution?: boolean;
  log?: (msg: string, meta?: unknown) => void;
}

export class DocumentStore {
  private readonly entries = new Map<string, Entry>();
  private readonly byHandle = new Map<number, Entry>();
  private readonly byRequest = new Map<number, Entry>();
  private nextRequestId = 1;
  private readonly log: NonNullable<StoreOptions['log']>;

  constructor(private readonly opts: StoreOptions) {
    this.log = opts.log ?? (() => {});
  }

  /** Wire the store to its connection. Call once. */
  attach(): void {
    // Handled through explicit methods rather than a constructor callback so
    // the store can be constructed before the connection is opened.
  }

  handleFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case ServerMessage.OpenAck:
        this.onOpenAck(frame.requestId, frame.handle, frame.role);
        return;
      case ServerMessage.Sync:
        this.onSync(frame.handle, frame.payload);
        return;
      case ServerMessage.Awareness:
        this.onAwareness(frame.handle, frame.payload);
        return;
      case ServerMessage.Closed:
        this.onClosed(frame.handle, frame.reason);
        return;
      case ServerMessage.RoleChanged:
        this.onRoleChanged(frame.handle, frame.role);
        return;
      case ServerMessage.Error:
        this.onError(frame.requestId, frame.code);
        return;
      default:
        return;
    }
  }

  /**
   * Reopen every document after a reconnect.
   *
   * Handles are per-connection, so the old ones are meaningless. The Y.Docs
   * are kept — that is what makes offline edits survive: the handshake will
   * reconcile them with whatever the server has.
   */
  handleReconnect(): void {
    this.byHandle.clear();
    this.byRequest.clear();
    for (const entry of this.entries.values()) {
      entry.handle = null;
      entry.requestId = null;
      this.setStatus(entry, 'opening');
      this.requestOpen(entry);
    }
  }

  /** Mark everything offline when the connection drops. */
  handleDisconnect(): void {
    for (const entry of this.entries.values()) {
      entry.synced = false;
      this.setStatus(entry, 'offline');
    }
  }

  /**
   * The connection has failed unrecoverably.
   *
   * Every document is inaccessible, and saying so matters: without this a
   * revoked share link leaves handles stuck in 'opening' forever, and the UI
   * shows a spinner instead of telling the user their access is gone. Found by
   * an end-to-end test doing exactly that.
   */
  handleFatal(code: string): void {
    this.byHandle.clear();
    this.byRequest.clear();
    for (const entry of this.entries.values()) {
      entry.handle = null;
      entry.requestId = null;
      entry.role = null;
      this.setStatus(entry, code === 'auth_failed' ? 'denied' : 'offline');
    }
  }

  open(pageId: string): PageHandle {
    const existing = this.entries.get(pageId);
    if (existing) {
      existing.refCount++;
      return this.makeHandle(existing);
    }

    const doc = new Y.Doc({ guid: docChannel(pageId) });
    const awareness = new awarenessProtocol.Awareness(doc);
    if (this.opts.presence) {
      awareness.setLocalState(withEditorUser(this.opts.presence));
    }

    // Local first, before anything from the server arrives.
    //
    // The order matters and is the reason no merge logic is needed anywhere:
    // both the stored copy and the server's updates are applied to the same
    // Y.Doc, and a CRDT's whole job is that applying them in any order reaches
    // the same document. There is nothing to compare and no conflict for
    // anybody to resolve — which is the part of "offline editing" that is
    // usually hard and here is free.
    const persistence = this.opts.persist?.(docChannel(pageId), doc) ?? null;

    // Record this session against the person editing (ADR-0022).
    //
    // Before anything is applied, so the mapping is in place for the first
    // keystroke rather than for everything after the second. Attribution is not
    // retroactive: an edit made before the mapping exists can never be
    // attributed, because the information was simply not captured.
    recordAttribution(doc, {
      userId: this.opts.presence?.userId ?? null,
      enabled: this.opts.attribution !== false,
    });

    const entry: Entry = {
      pageId,
      doc,
      awareness,
      persistence,
      refCount: 1,
      handle: null,
      requestId: null,
      role: null,
      status: 'opening',
      synced: false,
      listeners: new Set(),
      detach: () => {},
    };

    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      // 'remote' updates came from the server; echoing them back would loop.
      if (origin === 'remote') return;
      if (entry.handle === null) {
        // Offline edit. Kept in the doc; the reconnect handshake carries it.
        entry.synced = false;
        this.setStatus(entry, 'offline');
        return;
      }
      const inner = encoding.createEncoder();
      syncProtocol.writeUpdate(inner, update);
      const sent = this.opts.connection.send(
        encodeSync(entry.handle, encoding.toUint8Array(inner)),
      );
      if (!sent) {
        entry.synced = false;
        this.setStatus(entry, 'offline');
      }
    };

    const onAwarenessUpdate = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ): void => {
      if (origin === 'remote') return;
      if (entry.handle === null) return;
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (changed.length === 0) return;
      this.opts.connection.send(
        encodeAwareness(
          entry.handle,
          awarenessProtocol.encodeAwarenessUpdate(entry.awareness, changed),
        ),
      );
    };

    doc.on('update', onUpdate);
    awareness.on('update', onAwarenessUpdate);
    entry.detach = () => {
      doc.off('update', onUpdate);
      awareness.off('update', onAwarenessUpdate);
    };

    this.entries.set(pageId, entry);
    this.requestOpen(entry);
    return this.makeHandle(entry);
  }

  private requestOpen(entry: Entry): void {
    const requestId = this.nextRequestId++;
    entry.requestId = requestId;
    this.byRequest.set(requestId, entry);

    if (!this.opts.connection.send(encodeOpen(requestId, entry.pageId))) {
      // The connection is not ready, so the frame was dropped. Marked pending
      // and re-issued by handleAuthenticated.
      //
      // The comment here used to say handleReconnect would re-issue it. That
      // was false: onReconnect deliberately does not fire on the first connect,
      // so a document opened during the first few hundred milliseconds — which
      // is exactly when a freshly created page is opened — waited forever.
      // Header said "Syncing…", page said "Opening…", nothing happened.
      entry.requestId = null;
      this.byRequest.delete(requestId);
      this.setStatus(entry, 'opening');
    }
  }

  /**
   * The connection has authenticated, for the first time or again.
   *
   * Re-issues an open for every document that does not have a live handle. On a
   * first connect that is whatever was opened while connecting; after a
   * reconnect it is everything, because handles are per-connection.
   */
  handleAuthenticated(): void {
    for (const entry of this.entries.values()) {
      if (entry.handle !== null) continue;
      if (entry.requestId !== null) continue;
      this.setStatus(entry, 'opening');
      this.requestOpen(entry);
    }
  }

  private onOpenAck(requestId: number, handle: number, role: Role): void {
    const entry = this.byRequest.get(requestId);
    if (!entry) return;
    this.byRequest.delete(requestId);

    entry.handle = handle;
    entry.role = role;
    this.byHandle.set(handle, entry);
    this.setStatus(entry, 'syncing');

    // Both halves of the handshake. The server's step 1 tells us what to send;
    // ours tells it what to send us. Sending only one leaves this document
    // permanently empty — see the note at the top of this file.
    const step1 = encoding.createEncoder();
    syncProtocol.writeSyncStep1(step1, entry.doc);
    this.opts.connection.send(encodeSync(handle, encoding.toUint8Array(step1)));

    // Republish our presence: awareness state is per-connection on the server.
    const local = entry.awareness.getLocalState();
    if (local) {
      this.opts.connection.send(
        encodeAwareness(
          handle,
          awarenessProtocol.encodeAwarenessUpdate(entry.awareness, [entry.doc.clientID]),
        ),
      );
    }
  }

  private onSync(handle: number, payload: Uint8Array): void {
    const entry = this.byHandle.get(handle);
    if (!entry) return;

    const reply = encoding.createEncoder();
    const messageType = syncProtocol.readSyncMessage(
      decoding.createDecoder(payload),
      reply,
      entry.doc,
      'remote',
    );

    if (encoding.length(reply) > 0) {
      this.opts.connection.send(encodeSync(handle, encoding.toUint8Array(reply)));
    }

    // Step 2 is the server answering our step 1: at that point we have
    // everything it had. Not a durability guarantee — the server persists on a
    // debounce (ADR-0012) — but it is the point where content is complete.
    if (messageType === syncProtocol.messageYjsSyncStep2) {
      entry.synced = true;
      this.setStatus(entry, 'synced');
    } else if (entry.status === 'syncing' && entry.synced) {
      this.setStatus(entry, 'synced');
    }
  }

  private onAwareness(handle: number, payload: Uint8Array): void {
    const entry = this.byHandle.get(handle);
    if (!entry) return;
    awarenessProtocol.applyAwarenessUpdate(entry.awareness, payload, 'remote');
    this.notify(entry);
  }

  private onClosed(handle: number, reason: string): void {
    const entry = this.byHandle.get(handle);
    if (!entry) return;
    this.byHandle.delete(handle);
    entry.handle = null;
    entry.role = null;
    this.setStatus(entry, reason === 'not_authorized' ? 'denied' : 'offline');
  }

  private onRoleChanged(handle: number, role: Role): void {
    const entry = this.byHandle.get(handle);
    if (!entry) return;
    entry.role = role;
    this.notify(entry);
  }

  private onError(requestId: number, code: string): void {
    if (requestId === 0) return;
    const entry = this.byRequest.get(requestId);
    if (!entry) return;
    this.byRequest.delete(requestId);
    entry.requestId = null;
    // 'not_authorized' covers both a missing page and a forbidden one; the
    // server does not distinguish them, and neither can we.
    this.setStatus(entry, code === 'not_authorized' ? 'denied' : 'offline');
  }

  private setStatus(entry: Entry, status: DocumentStatus): void {
    if (entry.status === status) return;
    entry.status = status;
    this.notify(entry);
  }

  private notify(entry: Entry): void {
    const handle = this.makeHandle(entry, false);
    for (const listener of entry.listeners) {
      try {
        listener(handle);
      } catch (err) {
        this.log('listener threw', err);
      }
    }
  }

  /**
   * @param counted whether this handle holds a reference. Notification handles
   * do not, or every status change would leak a reference.
   */
  private makeHandle(entry: Entry, counted = true): PageHandle {
    let released = false;
    const store = this;

    return {
      pageId: entry.pageId,
      doc: entry.doc,
      awareness: entry.awareness,
      get status() {
        return entry.status;
      },
      get role() {
        return entry.role;
      },
      get canEdit() {
        return entry.role !== null && canWrite(entry.role);
      },
      peers() {
        const states: PresenceState[] = [];
        for (const [clientId, state] of entry.awareness.getStates()) {
          if (clientId === entry.doc.clientID) continue;
          if (state) states.push(state as PresenceState);
        }
        return states;
      },
      setPresence(state) {
        if (state === null) {
          entry.awareness.setLocalState(null);
          return;
        }
        // Through withEditorUser again, not a plain merge.
        //
        // A plain merge updated `displayName` and left the `user` copy at
        // whatever it was — so somebody who supplied their name after
        // connecting showed the right initial in the avatars, which read
        // `displayName`, and "Someone" beside their caret, which reads
        // `user.name`. Two fields describing one thing, updated in one place
        // only.
        entry.awareness.setLocalState(
          withEditorUser({
            ...(entry.awareness.getLocalState() ?? {}),
            ...state,
          } as Partial<PresenceState>),
        );
      },
      subscribe(listener) {
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
      release() {
        if (!counted || released) return;
        released = true;
        store.releaseEntry(entry);
      },
    };
  }

  private releaseEntry(entry: Entry): void {
    entry.refCount--;
    if (entry.refCount > 0) return;

    // Refuse to discard unsynced work. The handle is gone from the caller's
    // point of view, but the document stays in memory until the server has it
    // — dropping it here would silently lose an offline edit.
    if (!entry.synced) {
      this.log(
        `page ${entry.pageId} released with unsynced changes; keeping it in memory`,
      );
      return;
    }

    if (entry.handle !== null) {
      this.opts.connection.send(encodeCloseDocument(entry.handle));
      this.byHandle.delete(entry.handle);
    }
    if (entry.requestId !== null) this.byRequest.delete(entry.requestId);

    entry.detach();
    // Before the doc: the local copy observes it, and destroying the document
    // first would leave an observer on a destroyed target.
    entry.persistence?.destroy();
    entry.awareness.destroy();
    entry.doc.destroy();
    entry.listeners.clear();
    this.entries.delete(entry.pageId);
  }

  /** Pages held in memory, including those kept for unsynced changes. */
  get openPages(): string[] {
    return [...this.entries.keys()];
  }

  get stats(): { open: number; unsynced: number } {
    let unsynced = 0;
    for (const entry of this.entries.values()) {
      if (!entry.synced) unsynced++;
    }
    return { open: this.entries.size, unsynced };
  }

  /** Tear everything down. Unsynced changes are lost; callers must warn first. */
  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.detach();
      entry.awareness.destroy();
      entry.doc.destroy();
      entry.listeners.clear();
    }
    this.entries.clear();
    this.byHandle.clear();
    this.byRequest.clear();
  }
}
