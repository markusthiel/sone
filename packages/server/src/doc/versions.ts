/**
 * SONE server — a page's versions (ADR-0047).
 *
 * Kept on purpose. The update log is a sync mechanism with a short memory by
 * design — compaction folds it into one state and deletes what it folded in — so
 * a history derived from it would end at the last compaction and say nothing
 * about it. These are states recorded before that happens.
 */

import type { Pool, PoolClient } from 'pg';
import * as Y from 'yjs';

import { queryOne, queryRows } from '../db/pool.js';

export interface VersionRow {
  id: string;
  throughSeq: number;
  takenAt: Date;
  authors: string[];
  reason: 'quiet' | 'compaction' | 'restore';
}

/**
 * Record the document as it stands.
 *
 * Takes an open document rather than loading one, because the caller that
 * matters most already has it open and is about to destroy its past —
 * `compactDoc`, in the same transaction as the deletion.
 *
 * Idempotent per sequence: two versions at the same point are the same moment,
 * and a compaction that runs twice with nothing in between should not produce
 * two identical entries.
 */
export async function takeVersion(
  db: Pool | PoolClient,
  docId: string,
  doc: Y.Doc,
  throughSeq: number,
  reason: VersionRow['reason'],
  authors: string[] = [],
): Promise<void> {
  const state = Y.encodeStateAsUpdateV2(doc);
  await db.query(
    `INSERT INTO page_versions (doc_id, through_seq, state, authors, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (doc_id, through_seq) DO NOTHING`,
    [docId, throughSeq, Buffer.from(state), authors, reason],
  );
}

/** Who has written since the last version, for the entry's own label. */
export async function authorsSince(
  db: Pool | PoolClient,
  docId: string,
  sinceSeq: number,
): Promise<string[]> {
  const rows = await queryRows<{ actor_id: string | null }>(
    db,
    `SELECT DISTINCT actor_id FROM doc_updates
      WHERE doc_id = $1 AND seq > $2 AND actor_id IS NOT NULL`,
    [docId, sinceSeq],
  );
  return rows.map((row) => row.actor_id).filter((id): id is string => id !== null);
}

export async function lastVersionSeq(
  db: Pool | PoolClient,
  docId: string,
): Promise<number | null> {
  const row = await queryOne<{ through_seq: string }>(
    db,
    `SELECT through_seq FROM page_versions WHERE doc_id = $1
      ORDER BY through_seq DESC LIMIT 1`,
    [docId],
  );
  return row ? Number(row.through_seq) : null;
}

/**
 * The versions of a page, newest first.
 *
 * Without their states: a list of twenty documents is megabytes, and a list is
 * read far more often than a version is opened.
 */
export async function listVersions(
  db: Pool | PoolClient,
  docId: string,
  limit = 100,
): Promise<VersionRow[]> {
  const rows = await queryRows<{
    id: string;
    through_seq: string;
    taken_at: Date;
    authors: string[];
    reason: VersionRow['reason'];
  }>(
    db,
    `SELECT id, through_seq, taken_at, authors, reason
       FROM page_versions
      WHERE doc_id = $1
      ORDER BY taken_at DESC, through_seq DESC
      LIMIT $2`,
    [docId, limit],
  );

  return rows.map((row) => ({
    id: String(row.id),
    throughSeq: Number(row.through_seq),
    takenAt: row.taken_at,
    authors: row.authors,
    reason: row.reason,
  }));
}

/**
 * One version, as a document.
 *
 * `gc: false` deliberately: this document exists to be read as it was, and
 * garbage collection would drop the deleted content that the state carries —
 * which for a past state is precisely the part somebody is looking for.
 */
export async function loadVersion(
  db: Pool | PoolClient,
  docId: string,
  versionId: string,
): Promise<{ doc: Y.Doc; row: VersionRow } | null> {
  const row = await queryOne<{
    id: string;
    through_seq: string;
    taken_at: Date;
    authors: string[];
    reason: VersionRow['reason'];
    state: Buffer;
  }>(
    db,
    `SELECT id, through_seq, taken_at, authors, reason, state
       FROM page_versions WHERE doc_id = $1 AND id = $2`,
    [docId, versionId],
  );
  if (!row) return null;

  const doc = new Y.Doc({ gc: false });
  Y.applyUpdateV2(doc, new Uint8Array(row.state));

  return {
    doc,
    row: {
      id: String(row.id),
      throughSeq: Number(row.through_seq),
      takenAt: row.taken_at,
      authors: row.authors,
      reason: row.reason,
    },
  };
}

/**
 * How long versions are kept, in days.
 *
 * A retention window is a promise, so it is a setting and the interface says
 * what it is rather than letting somebody find the limit when they need it.
 */
export const VERSION_RETENTION_DAYS = Number(
  process.env['SONE_VERSION_RETENTION_DAYS'] ?? 90,
);

/**
 * Thin the versions of every page.
 *
 * Everything from the last day, one per hour for the last week, one per day
 * after that, and nothing beyond the window. Written as one statement per band
 * rather than one pass, because "keep the newest in each bucket" is what SQL is
 * good at and what a loop over every page in the instance is not.
 */
export async function thinVersions(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `WITH ranked AS (
       SELECT id,
              doc_id,
              taken_at,
              reason,
              -- The bucket this version falls in, coarser the older it is.
              CASE
                WHEN taken_at > now() - interval '1 day' THEN id::text
                WHEN taken_at > now() - interval '7 days'
                  THEN doc_id::text || date_trunc('hour', taken_at)::text
                ELSE doc_id::text || date_trunc('day', taken_at)::text
              END AS bucket,
              row_number() OVER (
                PARTITION BY doc_id,
                  CASE
                    WHEN taken_at > now() - interval '1 day' THEN id::text
                    WHEN taken_at > now() - interval '7 days'
                      THEN doc_id::text || date_trunc('hour', taken_at)::text
                    ELSE doc_id::text || date_trunc('day', taken_at)::text
                  END
                ORDER BY taken_at DESC, id DESC
              ) AS rank
         FROM page_versions
     )
     DELETE FROM page_versions v
      USING ranked r
      WHERE v.id = r.id
        AND (
          r.rank > 1
          OR r.taken_at < now() - ($1 || ' days')::interval
        )
        -- A restore is a fact about what somebody did, not a sample of what the
        -- page looked like. Thinning it away would hide the one version whose
        -- existence somebody might have to account for.
        AND r.reason <> 'restore'`,
    [VERSION_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}
