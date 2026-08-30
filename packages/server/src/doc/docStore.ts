/**
 * SONE — CRDT document store.
 *
 * The authoritative layer (ADR-0002). A document is the merge of its snapshot
 * plus every update after it. Updates are append-only; compaction folds a run
 * of them into a new snapshot and deletes the folded rows in one transaction.
 *
 * Nothing here interprets document contents. That is readDocument's job.
 */

import type { Pool, PoolClient } from 'pg';
import * as Y from 'yjs';

import { queryOne, queryRows, withTransaction } from '../db/pool.js';
import { USERS_KEY, liveClientIds } from '@sone/core';

/** Fold updates into a snapshot once this many have accumulated. */
export const COMPACT_THRESHOLD = 200;

export interface LoadedDoc {
  doc: Y.Doc;
  /** Highest seq applied. 0 means the document does not exist yet. */
  throughSeq: number;
  updateCount: number;
}

interface SnapshotRow {
  through_seq: string;
  state: Buffer;
}

interface UpdateRow {
  seq: string;
  payload: Buffer;
}

/**
 * Load a document.
 *
 * Returns an empty Y.Doc with throughSeq 0 when nothing is stored, so callers
 * do not branch on existence.
 */
export async function loadDoc(db: Pool | PoolClient, docId: string): Promise<LoadedDoc> {
  const doc = new Y.Doc({ guid: docId });

  const snapshot = await queryOne<SnapshotRow>(
    db,
    `SELECT through_seq, state FROM doc_snapshots WHERE doc_id = $1`,
    [docId],
  );

  let throughSeq = 0;
  if (snapshot) {
    throughSeq = Number(snapshot.through_seq);
    Y.applyUpdateV2(doc, new Uint8Array(snapshot.state));
  }

  const updates = await queryRows<UpdateRow>(
    db,
    `SELECT seq, payload
       FROM doc_updates
      WHERE doc_id = $1 AND seq > $2
      ORDER BY seq ASC`,
    [docId, throughSeq],
  );

  // One transaction for all updates: Yjs fires observers per transaction, and
  // applying two hundred updates individually is measurably slower.
  doc.transact(() => {
    for (const row of updates) {
      Y.applyUpdate(doc, new Uint8Array(row.payload));
    }
  }, 'load');

  const last = updates.at(-1);
  if (last) throughSeq = Number(last.seq);

  return { doc, throughSeq, updateCount: updates.length };
}

/**
 * Append an update.
 *
 * Returns the assigned sequence number. The LISTEN/NOTIFY trigger on
 * doc_updates publishes it to peer instances (ADR-0005); the payload carries
 * ids only, never content, because NOTIFY is capped at 8000 bytes.
 */
export async function appendUpdate(
  db: Pool | PoolClient,
  docId: string,
  update: Uint8Array,
  actorId: string | null,
): Promise<number> {
  const row = await queryOne<{ seq: string }>(
    db,
    `INSERT INTO doc_updates (doc_id, seq, payload, actor_id)
     VALUES ($1, nextval('doc_update_seq'), $2, $3)
     RETURNING seq`,
    [docId, Buffer.from(update), actorId],
  );
  if (!row) throw new Error(`failed to append update for doc ${docId}`);
  return Number(row.seq);
}

/**
 * Fold accumulated updates into a snapshot.
 *
 * Safe to call concurrently: the delete is bounded by the seq that was read,
 * so a competing append is never discarded. Uses V2 encoding for snapshots
 * (smaller) while incremental updates stay V1, which is what clients speak.
 */
export async function compactDoc(pool: Pool, docId: string): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    // Lock the snapshot row so two instances do not compact the same document
    // at once. A document with no snapshot yet takes the advisory lock path.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `sone:compact:${docId}`,
    ]);

    const { doc, throughSeq, updateCount } = await loadDoc(client, docId);
    if (updateCount === 0) return false;

    const state = Y.encodeStateAsUpdateV2(doc);
    const stateVector = Y.encodeStateVector(doc);

    await client.query(
      `INSERT INTO doc_snapshots (doc_id, through_seq, state, state_vector, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (doc_id) DO UPDATE
         SET through_seq = EXCLUDED.through_seq,
             state = EXCLUDED.state,
             state_vector = EXCLUDED.state_vector,
             updated_at = now()`,
      [docId, throughSeq, Buffer.from(state), Buffer.from(stateVector)],
    );

    // Bounded by the seq actually folded in — anything appended after the read
    // survives.
    await client.query(`DELETE FROM doc_updates WHERE doc_id = $1 AND seq <= $2`, [
      docId,
      throughSeq,
    ]);

    doc.destroy();
    return true;
  });
}

/** Number of un-compacted updates, used to decide when to compact. */
export async function pendingUpdateCount(
  db: Pool | PoolClient,
  docId: string,
): Promise<number> {
  const row = await queryOne<{ n: string }>(
    db,
    `SELECT count(*)::text AS n
       FROM doc_updates u
      WHERE u.doc_id = $1
        AND u.seq > coalesce(
              (SELECT s.through_seq FROM doc_snapshots s WHERE s.doc_id = $1), 0)`,
    [docId],
  );
  return row ? Number(row.n) : 0;
}

/** Every document id known to the store. Used by the rebuild command. */
export async function listDocIds(db: Pool | PoolClient): Promise<string[]> {
  const rows = await queryRows<{ doc_id: string }>(
    db,
    `SELECT doc_id FROM doc_snapshots
     UNION
     SELECT DISTINCT doc_id FROM doc_updates
     ORDER BY doc_id`,
  );
  return rows.map((r) => r.doc_id);
}

/**
 * Apply a change to a document from the server.
 *
 * Loads the document, runs the mutation, and appends **only the resulting
 * delta** to the log — not the whole state. Appending a full state would work
 * but would grow the log by the size of the document on every rename, and
 * compaction would be doing nothing but cleaning up after this function.
 *
 * The delta is captured with `Y.encodeStateAsUpdate(doc, stateVector)` against
 * the vector taken before the mutation, which is exactly "what changed here".
 *
 * Concurrency: this does not lock. Yjs updates commute, so a rename racing an
 * edit from a connected client converges rather than one overwriting the other
 * — that is the property CRDTs are for, and taking a lock here would give up
 * on it for no gain. What it does mean is that the returned title is what *this*
 * call wrote, and a concurrent rename elsewhere may win; last-writer-wins on a
 * single map key is the documented Yjs behaviour and the right semantics for a
 * title.
 *
 * A live sync room holding the same document will receive this through the
 * update bus like any other change, so a rename appears immediately in every
 * open client without this function knowing anything about connections.
 */
export async function applyToDocument(
  pool: Pool,
  docId: string,
  mutate: (doc: Y.Doc) => void,
  actorId: string | null,
): Promise<{ seq: number; changed: boolean }> {
  const loaded = await loadDoc(pool, docId);
  const doc = loaded.doc;

  try {
    const before = Y.encodeStateVector(doc);
    // A snapshot is the state vector *and* the delete set, and both halves
    // matter here.
    //
    // This compared state vectors alone, and a deletion does not advance one:
    // removing a key from a Y.Map marks the existing item deleted rather than
    // creating a new one. So every delete reported `changed: false`, no
    // materialisation ran, and the projection kept a column that the document
    // no longer had — a removed column stayed in every table until something
    // else happened to rebuild it.
    const beforeSnapshot = Y.encodeSnapshot(Y.snapshot(doc));
    mutate(doc);

    // Pruned in the same transaction as the change that made it possible.
    //
    // A separate pass would be a second write and a second chance for the
    // document to be modified in between; here, whatever the mutation removed
    // is accounted for before anybody sees the result (ADR-0022).
    pruneAttribution(doc);

    const delta = Y.encodeStateAsUpdate(doc, before);

    // An update with no changes still encodes to a few bytes, so emptiness is
    // decided by comparing snapshots rather than by length.
    const changed = !equalUint8(beforeSnapshot, Y.encodeSnapshot(Y.snapshot(doc)));
    if (!changed) {
      return { seq: loaded.throughSeq, changed: false };
    }

    const seq = await appendUpdate(pool, docId, delta, actorId);
    return { seq, changed: true };
  } finally {
    doc.destroy();
  }
}

function equalUint8(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Drop attribution for people whose writing is no longer in the document.
 *
 * ADR-0022's second half, and the reason the first half was written the way it
 * was: attribution is derived and prunable, so a mapping entry may go once
 * nothing of that person's text is left. Doing so makes content unattributed
 * rather than touching content — safe in a way the tombstones underneath are
 * not, because a CRDT must keep deletions for ever and an annotation costs a
 * label.
 *
 * The point is not tidiness. It is that deleted text should not keep somebody's
 * name in the record: writing something and removing it should leave no trace
 * of having written it, which is what somebody deleting a sentence assumes has
 * happened.
 *
 * Server-side only, and not by preference. A live `Y.PermanentUserData`
 * observes the mapping map and throws when an entry is removed from under it —
 * so this is safe here, where a document is loaded from storage and written
 * back, and would not be in a client that still has the observer attached.
 */
export function pruneAttribution(doc: Y.Doc): number {
  const users = doc.getMap(USERS_KEY);
  if (users.size === 0) return 0;

  const live = liveClientIds(doc);
  let removed = 0;

  doc.transact(() => {
    for (const [userId, value] of [...users.entries()]) {
      const ids = value instanceof Y.Map ? value.get('ids') : null;
      const list = ids instanceof Y.Array ? (ids.toArray() as unknown[]) : [];

      // Kept if any of their client ids still holds live content. One is
      // enough: a person who wrote two sentences and deleted one is still an
      // author of the other.
      const stillHere = list.some(
        (entry) => typeof entry === 'number' && live.has(entry),
      );
      if (stillHere) continue;

      users.delete(userId);
      removed += 1;
    }
  });

  return removed;
}
