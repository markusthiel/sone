/**
 * SONE — rebuild the projection from the CRDTs.
 *
 * ADR-0002 promises that every relational table outside doc_updates and
 * doc_snapshots is rebuildable. This is where that promise is kept, and it is
 * the recovery path for every materialiser bug — which is why it must exist
 * from day one and be exercised, not written later when it is needed.
 *
 * Ordering matters. Ancestor paths and relation join rows reference other
 * pages, so a page projected before its parent gets a provisional result. The
 * cascade queue handles that, but processing roots first makes the common case
 * a single pass.
 */

import type { Pool } from 'pg';

import { queryRows, withTransaction } from '../db/pool.js';
import { loadDoc, listDocIds } from '../doc/docStore.js';
import { materializeYDoc, markFailed } from './materialize.js';
import { readDocument } from './readDocument.js';

export interface RebuildOptions {
  /** Limit to one workspace. Omit to rebuild everything. */
  workspaceId?: string;
  /** Only pages currently marked stale or failed. */
  onlyPending?: boolean;
  /** Stop after this many pages. Useful for a smoke test on a large instance. */
  limit?: number;
  log?: (msg: string) => void;
}

export interface RebuildReport {
  processed: number;
  failed: Array<{ pageId: string; error: string }>;
  warnings: Array<{ pageId: string; warning: string }>;
  durationMs: number;
}

/**
 * Resolve the workspace for a document.
 *
 * The workspace is not in the CRDT — it is an instance-level fact — so it
 * comes from the existing page row. A document with no page row and no
 * recorded workspace cannot be placed, and is reported rather than guessed at.
 */
async function resolveWorkspace(pool: Pool, pageId: string): Promise<string | null> {
  const rows = await queryRows<{ workspace_id: string }>(
    pool,
    `SELECT workspace_id FROM pages WHERE id = $1`,
    [pageId],
  );
  return rows[0]?.workspace_id ?? null;
}

/** Order documents so parents come before children where known. */
async function orderByDepth(pool: Pool, docIds: string[]): Promise<string[]> {
  const rows = await queryRows<{ id: string; depth: number }>(
    pool,
    `SELECT id, coalesce(array_length(ancestor_ids, 1), 0) AS depth
       FROM pages
      WHERE id = ANY($1::uuid[])`,
    [docIds],
  );
  const depth = new Map(rows.map((r) => [r.id, r.depth]));
  // Unknown pages (no row yet) go last: they will be placed provisionally and
  // fixed by the cascade.
  return [...docIds].sort(
    (a, b) => (depth.get(a) ?? 9999) - (depth.get(b) ?? 9999) || (a < b ? -1 : 1),
  );
}

export async function rebuild(
  pool: Pool,
  opts: RebuildOptions = {},
): Promise<RebuildReport> {
  const log = opts.log ?? console.log;
  const started = Date.now();

  let docIds: string[];
  if (opts.onlyPending) {
    const rows = await queryRows<{ page_id: string }>(
      pool,
      `SELECT page_id FROM materialization_state
        WHERE status <> 'ok'
        ORDER BY materialized_at ASC`,
    );
    docIds = rows.map((r) => r.page_id);
  } else if (opts.workspaceId) {
    const rows = await queryRows<{ id: string }>(
      pool,
      `SELECT id FROM pages WHERE workspace_id = $1`,
      [opts.workspaceId],
    );
    docIds = rows.map((r) => r.id);
  } else {
    docIds = await listDocIds(pool);
  }

  docIds = await orderByDepth(pool, docIds);
  if (opts.limit !== undefined) docIds = docIds.slice(0, opts.limit);

  log(`[rebuild] ${docIds.length} document(s) to process`);

  const report: RebuildReport = {
    processed: 0,
    failed: [],
    warnings: [],
    durationMs: 0,
  };

  // Pages queued by a cascade (a moved page's subtree, or a collection's rows
  // after a field change). Processed after the main pass, deduplicated, and
  // bounded so a pathological cycle cannot spin forever.
  const queue: string[] = [];
  const seenInQueue = new Set<string>();
  const MAX_CASCADE_PASSES = 3;

  const processOne = async (pageId: string): Promise<void> => {
    const workspaceId = await resolveWorkspace(pool, pageId);
    if (!workspaceId) {
      report.failed.push({
        pageId,
        error:
          'no page row and no resolvable workspace; document is orphaned. ' +
          'Attach it to a workspace before rebuilding.',
      });
      return;
    }

    const { doc, throughSeq } = await loadDoc(pool, pageId);
    try {
      const parsed = readDocument(doc);
      const result = await withTransaction(pool, (client) =>
        materializeYDoc(client, pageId, doc, { throughSeq, workspaceId }),
      );
      report.processed++;
      for (const warning of result.warnings) {
        report.warnings.push({ pageId, warning });
      }
      for (const id of result.cascade) {
        if (!seenInQueue.has(id)) {
          seenInQueue.add(id);
          queue.push(id);
        }
      }
      if (parsed.blocks.length === 0) {
        report.warnings.push({ pageId, warning: 'document contains no blocks' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ pageId, error: message });
      // Record the failure so the page is visibly broken rather than silently
      // stale, but keep the previous projection.
      await withTransaction(pool, (client) => markFailed(client, pageId, err));
      log(`[rebuild] FAILED ${pageId}: ${message}`);
    } finally {
      doc.destroy();
    }
  };

  for (const [i, pageId] of docIds.entries()) {
    await processOne(pageId);
    if ((i + 1) % 100 === 0) {
      log(`[rebuild] ${i + 1}/${docIds.length}`);
    }
  }

  for (let pass = 0; pass < MAX_CASCADE_PASSES && queue.length > 0; pass++) {
    const batch = queue.splice(0, queue.length);
    log(`[rebuild] cascade pass ${pass + 1}: ${batch.length} document(s)`);
    for (const pageId of batch) await processOne(pageId);
  }

  if (queue.length > 0) {
    log(
      `[rebuild] WARNING: ${queue.length} document(s) still queued after ` +
        `${MAX_CASCADE_PASSES} cascade passes; they are marked stale`,
    );
  }

  report.durationMs = Date.now() - started;
  log(
    `[rebuild] done: ${report.processed} processed, ${report.failed.length} failed, ` +
      `${report.warnings.length} warning(s), ${report.durationMs} ms`,
  );
  return report;
}
