/**
 * SONE — removing content that belongs to no page any more (ADR-0106).
 *
 * The companion to `deleteDocuments.ts`, and the half ADR-0080 named and left:
 * that one keeps a deletion from leaving content behind, this one removes what
 * was left behind before it existed. An instance that purged a workspace under
 * an older build is still holding every byte of every page that was in it.
 *
 * **This is the query ADR-0080 called "one mistake away from deleting live
 * data"**, so it is written to be wrong in the safe direction:
 *
 * - It works from `orphaned_documents`, which anti-joins the *whole* legitimate
 *   set — page ids and their derived internal-comment ids — rather than
 *   guessing at a shape.
 * - It takes an age, and defaults to a generous one. A document with no page is
 *   not necessarily an orphan: `createEntry` appends the first update before
 *   materialising the page, in a separate transaction, so a document seconds
 *   old may simply be arriving ahead of its row.
 * - **It reports by default and removes only when told.** ADR-0080 asked for
 *   exactly that, and it is the difference between a number somebody can check
 *   against their own history and a delete they find out about afterwards.
 */

import type { Pool } from 'pg';

import { queryRows, withTransaction } from '../db/pool.js';

export interface SweepOptions {
  /**
   * How old the newest write must be. Defaults to a week.
   *
   * Not an hour, which is what the anomaly counts use: those produce a number
   * for somebody to read, and this deletes. The interesting population is years
   * old, so a generous window costs nothing and puts a great deal of distance
   * between the sweep and anything still in flight.
   */
  olderThanHours?: number;
  /** Report only. The default, deliberately. */
  apply?: boolean;
  /** Stop after this many documents, so a first run is inspectable. */
  limit?: number;
}

export interface SweepReport {
  /** Documents matching the condition — found, whether or not they were removed. */
  documents: number;
  updates: number;
  snapshots: number;
  applied: boolean;
  /** A few ids, so the report can be checked against an instance's own history. */
  sample: string[];
}

const SAMPLE = 20;

export async function sweepOrphanDocuments(
  pool: Pool,
  opts: SweepOptions = {},
): Promise<SweepReport> {
  const hours = Math.max(1, Number.isFinite(opts.olderThanHours) ? opts.olderThanHours! : 24 * 7);
  const limit = Math.max(1, opts.limit ?? 100_000);

  /*
   * Chosen once, then acted on, rather than the view being evaluated twice.
   *
   * Two evaluations could disagree — a page created between them would make a
   * document stop being an orphan — and the second one is the delete. So the
   * ids are fixed here and everything below refers to them.
   */
  const found = await queryRows<{ doc_id: string }>(
    pool,
    `SELECT doc_id FROM orphaned_documents
      WHERE last_written < now() - make_interval(hours => $1)
      ORDER BY last_written
      LIMIT $2`,
    [hours, limit],
  );
  const docIds = found.map((row) => row.doc_id);

  if (docIds.length === 0) {
    return { documents: 0, updates: 0, snapshots: 0, applied: opts.apply === true, sample: [] };
  }

  const counts = await queryRows<{ updates: string; snapshots: string }>(
    pool,
    `SELECT
       (SELECT count(*)::text FROM doc_updates WHERE doc_id = ANY($1::uuid[])) AS updates,
       (SELECT count(*)::text FROM doc_snapshots WHERE doc_id = ANY($1::uuid[])) AS snapshots`,
    [docIds],
  );

  const report: SweepReport = {
    documents: docIds.length,
    updates: Number(counts[0]?.updates ?? 0),
    snapshots: Number(counts[0]?.snapshots ?? 0),
    applied: opts.apply === true,
    sample: docIds.slice(0, SAMPLE),
  };

  if (opts.apply !== true) return report;

  // Both tables together, for the reason `deleteDocumentsFor` takes a client:
  // updates removed without their snapshot is the same bug in a smaller window.
  await withTransaction(pool, async (client) => {
    await client.query(`DELETE FROM doc_updates WHERE doc_id = ANY($1::uuid[])`, [docIds]);
    await client.query(`DELETE FROM doc_snapshots WHERE doc_id = ANY($1::uuid[])`, [docIds]);
  });

  return report;
}
