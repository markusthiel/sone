/**
 * SONE — maintenance job.
 *
 * Closes three consequences that earlier ADRs left explicitly open:
 *
 *   ADR-0010  `sessions` and `auth_attempts` grow without bound unless pruned.
 *   ADR-0012  a session revoked without touching a page stays live on an open
 *             WebSocket until the client reconnects, unless revalidation is
 *             swept periodically.
 *   ADR-0002  documents accumulate uncompacted updates, making every cold open
 *             replay a longer list.
 *
 * Runs in-process on a timer rather than as a cron container: one fewer moving
 * part for the operator (the same reasoning as ADR-0005), and the revalidation
 * sweep has to run in the process that holds the connections anyway.
 *
 * Every task is independently guarded. One failing task must not stop the
 * others — the whole point is that these run unattended.
 */

import type { Pool } from 'pg';

import { queryRows } from '../db/pool.js';
import { pruneAuthTables } from '../auth/session.js';
import { pruneShareSessions } from '../auth/share.js';
import { compactDoc } from '../doc/docStore.js';
import { COMPACT_THRESHOLD } from '../doc/docStore.js';
import type { SyncServer } from '../sync/server.js';

export const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** Documents compacted per run. Bounded so a backlog does not stall the loop. */
export const COMPACT_BATCH = 25;

export interface MaintenanceOptions {
  pool: Pool;
  sync?: SyncServer;
  intervalMs?: number;
  log?: (msg: string, meta?: unknown) => void;
}

export interface MaintenanceReport {
  prunedSessions: number;
  prunedAttempts: number;
  prunedShareSessions: number;
  compactedDocuments: number;
  revalidatedConnections: number;
  staleSearchRows: number;
  orphanedPages: number;
  /** Entries whose parent is a page rather than a folder (ADR-0019). */
  entriesInsidePages: number;
  errors: string[];
  durationMs: number;
}

export class Maintenance {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private readonly log: NonNullable<MaintenanceOptions['log']>;

  constructor(private readonly opts: MaintenanceOptions) {
    this.log = opts.log ?? ((msg, meta) => console.log(`[maintenance] ${msg}`, meta ?? ''));
  }

  start(): void {
    if (this.timer) return;
    const interval = this.opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    // unref so a pending timer does not keep the process alive during shutdown.
    this.timer = setInterval(() => void this.runOnce(), interval);
    this.timer.unref();
    this.log(`started, interval ${interval} ms`);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass. Safe to call directly, and does so in tests.
   *
   * Skips if a previous pass is still running: on a large instance a
   * compaction batch can outlast the interval, and overlapping passes would
   * compete for the same documents.
   */
  async runOnce(): Promise<MaintenanceReport> {
    const report: MaintenanceReport = {
      prunedSessions: 0,
      prunedAttempts: 0,
      prunedShareSessions: 0,
      compactedDocuments: 0,
      revalidatedConnections: 0,
      staleSearchRows: 0,
      orphanedPages: 0,
      entriesInsidePages: 0,
      errors: [],
      durationMs: 0,
    };

    if (this.running || this.stopped) {
      report.errors.push('skipped: previous pass still running');
      return report;
    }
    this.running = true;
    const started = Date.now();

    const guard = async (name: string, task: () => Promise<void>): Promise<void> => {
      try {
        await task();
      } catch (err) {
        const message = `${name}: ${err instanceof Error ? err.message : String(err)}`;
        report.errors.push(message);
        this.log(`task failed — ${message}`);
      }
    };

    await guard('prune auth tables', async () => {
      const pruned = await pruneAuthTables(this.opts.pool);
      report.prunedSessions = pruned.sessions;
      report.prunedAttempts = pruned.attempts;
    });

    await guard('prune share sessions', async () => {
      report.prunedShareSessions = await pruneShareSessions(this.opts.pool);
    });

    await guard('revalidate connections', async () => {
      if (!this.opts.sync) return;
      const before = this.opts.sync.stats.connections;
      await this.opts.sync.revalidateAll();
      report.revalidatedConnections = before;
    });

    await guard('compact documents', async () => {
      report.compactedDocuments = await compactBacklog(this.opts.pool);
    });

    // Reported, not fixed: both conditions need an operator decision. A stale
    // search row needs a rematerialise of that workspace; a persistently
    // orphaned page means an interrupted import or a bug. Silently repairing
    // either would hide the cause.
    await guard('report anomalies', async () => {
      const stale = await queryRows<{ n: string }>(
        this.opts.pool,
        `SELECT count(*)::text AS n FROM stale_search_rows`,
      );
      report.staleSearchRows = Number(stale[0]?.n ?? 0);

      const orphans = await queryRows<{ n: string }>(
        this.opts.pool,
        `SELECT count(*)::text AS n FROM orphaned_pages
          WHERE created_at < now() - interval '1 hour'`,
      );
      report.orphanedPages = Number(orphans[0]?.n ?? 0);

      // A page may contain nothing (ADR-0019). The API refuses to create the
      // situation; this notices if a client wrote it directly or an
      // out-of-order update has not settled. Given a grace period for the same
      // reason as orphans: CRDT updates arrive in any order, so a violation
      // that is minutes old is probably still resolving.
      const misplaced = await queryRows<{ n: string }>(
        this.opts.pool,
        `SELECT count(*)::text AS n FROM pages_inside_pages`,
      );
      report.entriesInsidePages = Number(misplaced[0]?.n ?? 0);
    });

    report.durationMs = Date.now() - started;
    this.running = false;

    if (report.staleSearchRows > 0) {
      this.log(
        `${report.staleSearchRows} page(s) have a stale search index; ` +
          `run rematerialize.mjs --workspace <id> for the affected workspaces`,
      );
    }
    if (report.orphanedPages > 0) {
      this.log(
        `${report.orphanedPages} page(s) have been orphaned for over an hour; ` +
          `see the orphaned_pages view`,
      );
    }
    if (report.entriesInsidePages > 0) {
      this.log(
        `${report.entriesInsidePages} entr(ies) sit inside a page rather than a ` +
          `folder; see the pages_inside_pages view`,
      );
    }

    const summary =
      `pruned ${report.prunedSessions} session(s), ${report.prunedAttempts} attempt(s), ` +
      `${report.prunedShareSessions} share session(s); ` +
      `compacted ${report.compactedDocuments} document(s) in ${report.durationMs} ms`;
    this.log(summary);

    return report;
  }
}

/**
 * Compact documents with the largest backlog first.
 *
 * Ordering by backlog rather than by age targets the documents where cold-open
 * cost is actually growing. Bounded per run so one busy instance does not spend
 * every pass compacting.
 */
export async function compactBacklog(
  pool: Pool,
  batchSize = COMPACT_BATCH,
): Promise<number> {
  const candidates = await queryRows<{ doc_id: string; pending: string }>(
    pool,
    `SELECT u.doc_id, count(*)::text AS pending
       FROM doc_updates u
       LEFT JOIN doc_snapshots s ON s.doc_id = u.doc_id
      WHERE u.seq > coalesce(s.through_seq, 0)
      GROUP BY u.doc_id
     HAVING count(*) >= $1
      ORDER BY count(*) DESC
      LIMIT $2`,
    [COMPACT_THRESHOLD, batchSize],
  );

  let compacted = 0;
  for (const candidate of candidates) {
    try {
      if (await compactDoc(pool, candidate.doc_id)) compacted++;
    } catch (err) {
      // One document failing to compact is not worth abandoning the batch;
      // the snapshot is an optimisation, not correctness.
      console.error(`[maintenance] compaction failed for ${candidate.doc_id}`, err);
    }
  }
  return compacted;
}
