/**
 * SONE — document rooms.
 *
 * One room per open document, shared by every connection that has it open.
 * The room owns the in-memory Y.Doc, applies incoming updates, fans them out
 * to other subscribers, and persists on a debounce.
 *
 * The debounce is the reason this class exists rather than persisting inline:
 * a keystroke produces a Yjs update, and writing to Postgres per keystroke
 * would put a database round trip on the typing path. Instead updates
 * accumulate in memory, are flushed after a short quiet period or a maximum
 * delay, and the materialiser runs once per flush rather than once per
 * keystroke (ADR-0008 notes this is where to optimise, not by diffing).
 *
 * Durability: a flush is at most PERSIST_MAX_DELAY_MS behind the client. A
 * crash in that window loses the tail. That is a deliberate trade and is
 * documented in ADR-0012 — the alternative, a synchronous write per update,
 * makes every keystroke wait for fsync.
 */

import type { Pool } from 'pg';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import { withTransaction } from '../db/pool.js';
import {
  COMPACT_THRESHOLD,
  appendUpdate,
  compactDoc,
  loadDoc,
  pendingUpdateCount,
} from '../doc/docStore.js';
import { markFailed, materializeYDoc } from '../materialize/materialize.js';

/** Quiet period before a flush. Long enough to batch a burst of typing. */
export const PERSIST_DEBOUNCE_MS = 400;
/** Hard ceiling: flush this long after the first unflushed update regardless. */
export const PERSIST_MAX_DELAY_MS = 3_000;
/** A room with no subscribers is torn down after this long. */
export const ROOM_LINGER_MS = 30_000;

export interface RoomSubscriber {
  readonly id: string;
  /** Handle this subscriber uses for the document. */
  handle: number;
  canWrite: boolean;
  send(data: Uint8Array): void;
  sendAwareness(data: Uint8Array): void;
}

export interface RoomOptions {
  pool: Pool;
  pageId: string;
  workspaceId: string;
  /**
   * How long an empty room lingers before teardown. Configurable because the
   * right value differs by deployment — a busy instance benefits from keeping
   * documents warm, a memory-constrained one does not — and because tests need
   * it to be zero.
   */
  lingerMs?: number;
}

export class DocumentRoom {
  readonly pageId: string;
  readonly workspaceId: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;

  private readonly pool: Pool;
  private readonly subscribers = new Map<string, RoomSubscriber>();
  private readonly pendingUpdates: Uint8Array[] = [];

  private debounceTimer: NodeJS.Timeout | null = null;
  private maxDelayTimer: NodeJS.Timeout | null = null;
  private lingerTimer: NodeJS.Timeout | null = null;

  private throughSeq = 0;
  private flushing: Promise<void> | null = null;
  private destroyed = false;
  /**
   * Set when a write failed in a way that can never succeed. The room stops
   * persisting but keeps serving its in-memory document, so connected clients
   * are not cut off mid-sentence by an operator deleting something.
   */
  private poisoned = false;
  private poisonReason: string | null = null;
  /** Actor for the next flush. Best effort: the last writer wins. */
  private lastActorId: string | null = null;

  private readonly lingerMs: number;

  private constructor(opts: RoomOptions, doc: Y.Doc, throughSeq: number) {
    this.lingerMs = opts.lingerMs ?? ROOM_LINGER_MS;
    this.pool = opts.pool;
    this.pageId = opts.pageId;
    this.workspaceId = opts.workspaceId;
    this.doc = doc;
    this.throughSeq = throughSeq;
    this.awareness = new awarenessProtocol.Awareness(doc);
    // The server is not a participant; it must not appear as a cursor.
    this.awareness.setLocalState(null);

    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  static async open(opts: RoomOptions): Promise<DocumentRoom> {
    const { doc, throughSeq } = await loadDoc(opts.pool, opts.pageId);
    return new DocumentRoom(opts, doc, throughSeq);
  }

  // --- subscribers ---------------------------------------------------------

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  addSubscriber(sub: RoomSubscriber): void {
    this.subscribers.set(sub.id, sub);
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
  }

  removeSubscriber(id: string): void {
    const sub = this.subscribers.get(id);
    this.subscribers.delete(id);

    if (sub) {
      // Drop the departing client's awareness state, or their cursor lingers
      // in everyone else's UI until the entry times out.
      const clientIds = [...this.awareness.getStates().keys()].filter(
        (clientId) => this.awareness.meta.get(clientId)?.clock !== undefined &&
          this.subscriberClientIds.get(id)?.has(clientId) === true,
      );
      if (clientIds.length > 0) {
        awarenessProtocol.removeAwarenessStates(this.awareness, clientIds, 'disconnect');
      }
      this.subscriberClientIds.delete(id);
    }
  }

  /** Awareness client ids seen from each subscriber, for cleanup on leave. */
  private readonly subscriberClientIds = new Map<string, Set<number>>();

  /** Update a subscriber's write permission mid-session. */
  setSubscriberWritable(id: string, canWrite: boolean): void {
    const sub = this.subscribers.get(id);
    if (sub) sub.canWrite = canWrite;
  }

  // --- sync ----------------------------------------------------------------

  /**
   * The initial sync step the server sends on open: its state vector, so the
   * client can compute and send only what the server is missing.
   */
  encodeSyncStep1(): Uint8Array {
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.doc);
    return encoding.toUint8Array(encoder);
  }

  /** Full awareness state for a joining client. */
  encodeAwarenessState(): Uint8Array | null {
    const states = this.awareness.getStates();
    if (states.size === 0) return null;
    return awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]);
  }

  /**
   * Handle an inbound y-protocols sync message.
   *
   * Returns a reply to send back to the originating subscriber, or null.
   *
   * `canWrite` is enforced here rather than at the connection layer because
   * this is the only place that knows whether a given message would modify
   * the document: sync step 1 and step 2 are legitimate for a reader, an
   * update message is not. A read-only client that sends an update is
   * refused, not silently ignored — silence would make the client believe its
   * edit landed.
   */
  handleSyncMessage(
    subscriberId: string,
    message: Uint8Array,
    canWrite: boolean,
  ): { reply: Uint8Array | null; rejectedWrite: boolean } {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    if (
      !canWrite &&
      (messageType === syncProtocol.messageYjsUpdate ||
        messageType === syncProtocol.messageYjsSyncStep2)
    ) {
      return { reply: null, rejectedWrite: true };
    }

    // Re-encode the type so readSyncMessage sees a complete message.
    const full = encoding.createEncoder();
    encoding.writeVarUint(full, messageType);
    encoding.writeUint8Array(full, decoding.readTailAsUint8Array(decoder));

    const replyEncoder = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(encoding.toUint8Array(full)),
      replyEncoder,
      this.doc,
      // Transaction origin: marks the update as remote so onDocUpdate does not
      // echo it back to its sender.
      subscriberId,
    );

    const reply = encoding.length(replyEncoder) > 0
      ? encoding.toUint8Array(replyEncoder)
      : null;
    return { reply, rejectedWrite: false };
  }

  /**
   * Attribution for the next flush.
   *
   * Set by the connection layer before each inbound message. Best effort by
   * design: a flush batches updates from several writers and records the last
   * one. Per-update attribution lives in the CRDT itself, where each change
   * carries its originating client id.
   */
  setActor(actorId: string | null): void {
    this.lastActorId = actorId;
  }

  /**
   * Handle an inbound awareness update.
   *
   * Awareness is presence, not document content, so it is never persisted and
   * a read-only client may publish it — a viewer's cursor is useful and
   * harmless.
   */
  handleAwarenessMessage(subscriberId: string, message: Uint8Array): void {
    // Track which awareness client ids came from this subscriber so their
    // cursors can be removed when the connection drops.
    const before = new Set(this.awareness.getStates().keys());
    awarenessProtocol.applyAwarenessUpdate(this.awareness, message, subscriberId);
    const seen = this.subscriberClientIds.get(subscriberId) ?? new Set<number>();
    for (const clientId of this.awareness.getStates().keys()) {
      if (!before.has(clientId)) seen.add(clientId);
    }
    this.subscriberClientIds.set(subscriberId, seen);
  }

  // --- fan-out -------------------------------------------------------------

  private readonly onDocUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    if (this.destroyed) return;

    // Origin 'load' and 'remote-bus' are replays, not new writes; persisting
    // them would duplicate what another instance already stored.
    if (origin !== 'load' && origin !== 'remote-bus') {
      this.pendingUpdates.push(update);
      this.scheduleFlush();
    }

    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const payload = encoding.toUint8Array(encoder);

    for (const sub of this.subscribers.values()) {
      // Skip the originator: it already has this change locally.
      if (sub.id === origin) continue;
      sub.send(payload);
    }
  };

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (this.destroyed) return;
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;

    const payload = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
    for (const sub of this.subscribers.values()) {
      if (sub.id === origin) continue;
      sub.sendAwareness(payload);
    }
  };

  /**
   * Apply an update that arrived from another server instance.
   *
   * Tagged 'remote-bus' so it is fanned out to local subscribers but not
   * persisted again — the instance that received it from a client already did
   * that (ADR-0005).
   */
  applyRemoteUpdate(update: Uint8Array): void {
    if (this.destroyed) return;
    Y.applyUpdate(this.doc, update, 'remote-bus');
  }

  // --- persistence ---------------------------------------------------------

  private scheduleFlush(): void {
    if (this.poisoned) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.flush(), PERSIST_DEBOUNCE_MS);

    // The ceiling timer is armed once and not reset, so continuous typing
    // still gets persisted every PERSIST_MAX_DELAY_MS instead of never.
    if (!this.maxDelayTimer) {
      this.maxDelayTimer = setTimeout(() => void this.flush(), PERSIST_MAX_DELAY_MS);
    }
  }

  /**
   * Persist pending updates and re-project the document.
   *
   * Serialised: a second call while a flush is in flight awaits the first,
   * then runs. Concurrent flushes could interleave appends and materialisation
   * and leave the projection reflecting a sequence that was never stored.
   */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      if (this.pendingUpdates.length === 0) return;
    }
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxDelayTimer) {
      clearTimeout(this.maxDelayTimer);
      this.maxDelayTimer = null;
    }

    if (this.pendingUpdates.length === 0) return;
    if (this.poisoned) {
      // Discard: keeping them would grow without bound.
      this.pendingUpdates.length = 0;
      return;
    }

    // Take the batch before any await, so updates arriving during the write
    // are not lost and are not written twice.
    const batch = this.pendingUpdates.splice(0, this.pendingUpdates.length);
    const merged = Y.mergeUpdates(batch);
    const actorId = this.lastActorId;

    try {
      const seq = await appendUpdate(this.pool, this.pageId, merged, actorId);
      this.throughSeq = seq;

      await withTransaction(this.pool, (client) =>
        materializeYDoc(client, this.pageId, this.doc, {
          throughSeq: seq,
          workspaceId: this.workspaceId,
          actorId,
        }),
      );

      // Compact opportunistically. Cheap to check, and without it loadDoc
      // replays an ever-growing list on every cold open.
      const pending = await pendingUpdateCount(this.pool, this.pageId);
      if (pending >= COMPACT_THRESHOLD) {
        await compactDoc(this.pool, this.pageId);
      }
    } catch (err) {
      if (isPermanentWriteFailure(err)) {
        // The write can never succeed: the workspace or page has been deleted,
        // or the schema no longer matches. Retrying would hold the batch in
        // memory forever and re-fail on every subsequent update, so the room
        // is poisoned instead — it stops persisting and reports itself.
        //
        // The CRDT log is untouched, so nothing already stored is lost. What
        // is lost is the unflushed tail, which had nowhere to go regardless.
        this.poisoned = true;
        this.poisonReason = err instanceof Error ? err.message : String(err);
        console.error(
          `[room ${this.pageId}] permanent write failure, room poisoned:`,
          this.poisonReason,
        );
        return;
      }

      // Transient — connection lost, deadlock, timeout. Put the batch back at
      // the front: the CRDT state is still correct in memory, and dropping it
      // would lose user work.
      this.pendingUpdates.unshift(...batch);
      await withTransaction(this.pool, (client) =>
        markFailed(client, this.pageId, err),
      ).catch(() => {
        // If even recording the failure fails, the database is unreachable and
        // there is nothing useful left to do here.
      });
      throw err;
    }
  }

  get hasPendingWrites(): boolean {
    return this.pendingUpdates.length > 0;
  }

  /** True when the room has given up persisting. Surfaced in /api/health. */
  get isPoisoned(): boolean {
    return this.poisoned;
  }

  get poisonedBecause(): string | null {
    return this.poisonReason;
  }

  get persistedThroughSeq(): number {
    return this.throughSeq;
  }

  // --- lifecycle -----------------------------------------------------------

  /** Schedule teardown. Called when the last subscriber leaves. */
  scheduleLinger(onExpire: () => void): void {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(onExpire, this.lingerMs);
  }

  /** Flush and release. Must be awaited during shutdown or edits are lost. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;

    for (const timer of [this.debounceTimer, this.maxDelayTimer, this.lingerTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.debounceTimer = null;
    this.maxDelayTimer = null;
    this.lingerTimer = null;

    // Flush before marking destroyed so onDocUpdate still behaves normally.
    if (this.pendingUpdates.length > 0) {
      await this.flush().catch((err) => {
        console.error(`[room ${this.pageId}] final flush failed`, err);
      });
    }

    this.destroyed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
    this.subscribers.clear();
    this.subscriberClientIds.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}


/**
 * Is this database error one that retrying can never fix?
 *
 * Postgres SQLSTATE classes:
 *   23xxx  integrity constraint violation — the referenced row is gone
 *   42xxx  syntax or access rule violation — schema mismatch
 *   3D/3F  undefined database or schema
 *
 * Everything else (connection failures, deadlocks, timeouts, disk full) is
 * treated as transient and retried, which is the safer default: retrying a
 * permanent failure wastes memory, but discarding a transient one loses work.
 */
function isPermanentWriteFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return (
    code.startsWith('23') ||
    code.startsWith('42') ||
    code.startsWith('3D') ||
    code.startsWith('3F')
  );
}
