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

import { queryRows, withTransaction } from '../db/pool.js';
import { pruneAuthTables } from '../auth/session.js';
import { pruneShareSessions } from '../auth/share.js';
import { deleteDocumentsFor } from '../doc/deleteDocuments.js';
import { compactDoc, loadDoc } from '../doc/docStore.js';
import { expireJobs } from '../jobs/runner.js';
import {
  authorsSince,
  lastVersionSeq,
  takeVersion,
  thinVersions,
} from '../doc/versions.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { COMPACT_THRESHOLD } from '../doc/docStore.js';
import type { SyncServer } from '../sync/server.js';

export const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** Documents compacted per run. Bounded so a backlog does not stall the loop. */
export const COMPACT_BATCH = 25;

/**
 * How many times a failed projection is retried before it is left alone.
 *
 * Bounded, because a document that cannot be read is usually a bug rather than
 * a hiccup, and retrying it every five minutes forever fills the log with the
 * same message and hides everything else. After this it waits for a person —
 * which the admin screen now offers a button for.
 */
export const MAX_PROJECTION_ATTEMPTS = 6;

/** Projections retried per pass. */
export const RETRY_BATCH = 20;

/**
 * How long to wait before the next attempt, given how many have failed.
 *
 * Exponential from a minute to about an hour. A transient failure — a lock, a
 * dependency still starting — clears on the first retry; a real one should not
 * be hammered.
 *
 * **This is the definition; the rule that runs is the SQL in
 * `retryFailedProjections`**, which computes the same curve with
 * `least(power(2, ...), 60) * interval '1 minute'` so the database does the
 * filtering rather than fetching every failure and discarding most of them.
 *
 * Two copies of one rule is the arrangement this project keeps finding and
 * removing (ADR-0077, ADR-0078), and for a while this was the worse version of
 * it: the function had two tests and no callers, so the suite proved the copy
 * nobody runs. Rather than delete it and leave the SQL unchecked, the test now
 * asserts the two agree — it is the shipped expression that is under test, and
 * this is the readable statement of what it should say (ADR-0080).
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
}

export interface MaintenanceOptions {
  /**
   * How long a deleted workspace is kept before it is removed.
   *
   * Cited as ADR-0027 here and in two other places; ADR-0027 is about the
   * administration screens and contains no retention decision (ADR-0080). The
   * rule's only record is `docs/deployment.md`.
   *
   * A month by default: long enough for somebody to notice a mistake, short
   * enough that "deleted" means what people take it to mean.
   */
  workspaceRetentionDays?: number;
  pool: Pool;
  sync?: SyncServer;
  intervalMs?: number;
  /**
   * Where a job's result was stored, so an expired one can be freed.
   *
   * Optional, and the expiry step is skipped without it: a maintenance job in a
   * test that never wrote a file has nothing to free, and requiring the store
   * would make every existing caller pass one for a step it does not use.
   */
  store?: { delete: (key: string) => Promise<void> };
  log?: (msg: string, meta?: unknown) => void;
}

export interface MaintenanceReport {
  prunedSessions: number;
  prunedAttempts: number;
  prunedShareSessions: number;
  /** Workspaces marked for deletion long enough ago to be removed. */
  purgedWorkspaces: number;
  compactedDocuments: number;
  /** Pages a version was taken of because their sitting ended (ADR-0047). */
  versionedDocuments: number;
  /** Versions dropped by thinning. */
  thinnedVersions: number;
  /** Job results whose time was up (ADR-0044). */
  expiredJobs: number;
  /** Failed projections attempted again this pass. */
  retriedProjections: number;
  /** Of those, the ones that succeeded. */
  recoveredProjections: number;
  /** Failures that have exhausted their retries and need a person. */
  abandonedProjections: number;
  revalidatedConnections: number;
  staleSearchRows: number;
  orphanedPages: number;
  /** Entries whose parent is a page rather than a folder (ADR-0019). */
  entriesInsidePages: number;
  /**
   * CRDT documents belonging to no page (ADR-0106).
   *
   * Counted, never swept here. It is a report for the same reason the two above
   * it are — the cause needs an operator, not a repair — and for one more: this
   * is the deletion ADR-0080 called "one mistake away from deleting live data",
   * so the thing that performs it is a script somebody runs and reads, not a
   * task that runs every five minutes while nobody is looking.
   */
  orphanedDocuments: number;
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
      purgedWorkspaces: 0,
      compactedDocuments: 0,
      versionedDocuments: 0,
      thinnedVersions: 0,
      expiredJobs: 0,
      retriedProjections: 0,
      recoveredProjections: 0,
      abandonedProjections: 0,
      revalidatedConnections: 0,
      staleSearchRows: 0,
      orphanedPages: 0,
      entriesInsidePages: 0,
      orphanedDocuments: 0,
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

    await guard('purge deleted workspaces', async () => {
      report.purgedWorkspaces = await purgeDeletedWorkspaces(
        this.opts.pool,
        this.opts.workspaceRetentionDays ?? 30,
      );
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

    await guard('retry failed projections', async () => {
      const result = await retryFailedProjections(this.opts.pool);
      report.retriedProjections = result.retried;
      report.recoveredProjections = result.recovered;
      report.abandonedProjections = result.abandoned;
    });

    /*
     * A version of every page whose sitting has ended (ADR-0047).
     *
     * Before compaction in this list, deliberately: compaction takes its own
     * version, and one taken here first means the entry is labelled as the end
     * of somebody's writing rather than as a housekeeping artefact. The same
     * state either way; a different answer to "why does this version exist".
     */
    await guard('version quiet documents', async () => {
      report.versionedDocuments = await versionQuietDocuments(this.opts.pool);
    });

    await guard('compact documents', async () => {
      const outcome = await compactBacklog(this.opts.pool);
      report.compactedDocuments = outcome.compacted;
      for (const failure of outcome.failures) {
        report.errors.push(`compact documents — ${failure}`);
      }
    });

    // Freeing what expired jobs left behind. Here rather than in the runner's
    // timer, because it is housekeeping and the runner's job is to run work.
    await guard('expire job results', async () => {
      report.expiredJobs = await expireJobs(this.opts.pool, async (result) => {
        const key = result['key'];
        if (typeof key === 'string' && this.opts.store) await this.opts.store.delete(key);
      });
    });

    await guard('thin versions', async () => {
      report.thinnedVersions = await thinVersions(this.opts.pool);
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
        // The condition the comment above has always described and the query
        // never had (migration 0056, ADR-0080).
        `SELECT count(*)::text AS n FROM pages_inside_pages
          WHERE created_at < now() - interval '1 hour'`,
      );
      report.entriesInsidePages = Number(misplaced[0]?.n ?? 0);

      // Content whose page is gone: what a purge left behind before ADR-0080,
      // or a page creation that failed between its first update and its
      // materialisation. An hour's grace like the two above, and for a sharper
      // version of the same reason — `createEntry` writes the update outside
      // the transaction that writes the row, so a document seconds old with no
      // page is ordinary rather than orphaned (ADR-0106).
      const strays = await queryRows<{ n: string }>(
        this.opts.pool,
        `SELECT count(*)::text AS n FROM orphaned_documents
          WHERE last_written < now() - interval '1 hour'`,
      );
      report.orphanedDocuments = Number(strays[0]?.n ?? 0);
    });

    report.durationMs = Date.now() - started;
    this.running = false;

    if (report.recoveredProjections > 0) {
      this.log(`${report.recoveredProjections} projection(s) recovered on retry`);
    }
    if (report.abandonedProjections > 0) {
      this.log(
        `${report.abandonedProjections} page(s) have failed to project ` +
          `${MAX_PROJECTION_ATTEMPTS} times and will not be retried automatically; ` +
          `see Settings → Maintenance`,
      );
    }
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
    if (report.orphanedDocuments > 0) {
      // Names the script, because unlike the three above it there is one, and
      // an operator reading this line is the person who decides to run it.
      this.log(
        `${report.orphanedDocuments} document(s) belong to no page — content left ` +
          `by a purge from before ADR-0080; see the orphaned_documents view, and ` +
          `sweep-orphan-documents.mjs to remove it`,
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

export interface RetryResult {
  retried: number;
  recovered: number;
  abandoned: number;
}

/**
 * Try failed projections again.
 *
 * This gap was worth closing: `attempts` has been counted since the first
 * migration and nothing ever read it, so a page whose document the projection
 * could not read stayed failed until somebody ran a script. It still synced and
 * still opened — it was simply missing from search and from the tree, which is
 * the kind of failure nobody notices until they go looking for something.
 *
 * Retried with a growing delay and a hard limit, so a genuinely broken document
 * is attempted a few times and then left for a person rather than filling the
 * log forever.
 */
/**
 * How long a page has to be quiet before its sitting counts as ended.
 *
 * The gap between "still writing" and "finished for now". Too short and the list
 * is keystrokes; too long and a version is never taken for somebody who works in
 * short bursts.
 */
export const QUIET_MINUTES = Number(process.env['SONE_VERSION_QUIET_MINUTES'] ?? 10);

/**
 * Take a version of every page that has changed and then gone quiet.
 *
 * "Changed" means there are updates past the last version; "quiet" means nothing
 * for a while. A page nobody has touched since its last version is skipped —
 * otherwise this would write an identical state every time it ran, which is how
 * a history table outgrows the documents it describes.
 */
export async function versionQuietDocuments(pool: Pool): Promise<number> {
  const candidates = await queryRows<{ doc_id: string; last_seq: string }>(
    pool,
    `SELECT u.doc_id, max(u.seq)::text AS last_seq
       FROM doc_updates u
       JOIN pages p ON p.id = u.doc_id
      WHERE p.archived_at IS NULL
      GROUP BY u.doc_id
     HAVING max(u.created_at) < now() - ($1 || ' minutes')::interval
        AND max(u.seq) > coalesce(
              (SELECT max(v.through_seq) FROM page_versions v WHERE v.doc_id = u.doc_id),
              0)
      LIMIT 50`,
    [QUIET_MINUTES],
  );

  let taken = 0;
  for (const row of candidates) {
    // One at a time and each on its own: a document that fails to load must not
    // stop the others, which is the same guard every task in this job has.
    try {
      const since = (await lastVersionSeq(pool, row.doc_id)) ?? 0;
      const loaded = await loadDoc(pool, row.doc_id);
      try {
        await takeVersion(
          pool,
          row.doc_id,
          loaded.doc,
          loaded.throughSeq,
          'quiet',
          await authorsSince(pool, row.doc_id, since),
        );
        taken += 1;
      } finally {
        loaded.doc.destroy();
      }
    } catch {
      // Reported by the job's own guard on the next pass if it persists.
    }
  }
  return taken;
}

export async function retryFailedProjections(
  pool: Pool,
  batchSize = RETRY_BATCH,
): Promise<RetryResult> {
  const result: RetryResult = { retried: 0, recovered: 0, abandoned: 0 };

  const abandoned = await queryRows<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM materialization_state
      WHERE status = 'failed' AND attempts >= $1`,
    [MAX_PROJECTION_ATTEMPTS],
  );
  result.abandoned = Number(abandoned[0]?.n ?? 0);

  const due = await queryRows<{ page_id: string; workspace_id: string; attempts: number }>(
    pool,
    `SELECT m.page_id, p.workspace_id, m.attempts
       FROM materialization_state m
       JOIN pages p ON p.id = m.page_id
      WHERE m.status = 'failed'
        AND m.attempts < $1
        -- The delay grows with the attempt count, computed here so the query
        -- does the filtering rather than fetching everything and discarding.
        AND m.materialized_at < now() - (least(power(2, greatest(m.attempts - 1, 0)), 60)
                                         * interval '1 minute')
      ORDER BY m.materialized_at
      LIMIT $2`,
    [MAX_PROJECTION_ATTEMPTS, batchSize],
  );

  for (const row of due) {
    result.retried += 1;
    try {
      await rematerialize(pool, row.page_id, row.workspace_id);

      const after = await queryRows<{ status: string }>(
        pool,
        `SELECT status FROM materialization_state WHERE page_id = $1`,
        [row.page_id],
      );
      if (after[0]?.status === 'ok') result.recovered += 1;
    } catch {
      // materializePage records its own failure and bumps attempts. Swallowed
      // here so one unreadable document does not stop the rest of the batch —
      // which is the whole point of retrying in a loop.
    }
  }

  return result;
}

/**
 * Compact documents with the largest backlog first.
 *
 * Ordering by backlog rather than by age targets the documents where cold-open
 * cost is actually growing. Bounded per run so one busy instance does not spend
 * every pass compacting.
 */
export interface CompactionOutcome {
  compacted: number;
  /** One line per document that would not compact. Reported, not just logged. */
  failures: string[];
}

export async function compactBacklog(
  pool: Pool,
  batchSize = COMPACT_BATCH,
): Promise<CompactionOutcome> {
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
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      if (await compactDoc(pool, candidate.doc_id)) compacted++;
    } catch (err) {
      /*
       * One document failing to compact is not worth abandoning the batch; the
       * snapshot is an optimisation, not correctness. But it *is* worth
       * reporting: this wrote to `console.error` and nowhere else, so a pass in
       * which all twenty-five compactions failed returned `errors: []` and the
       * administration panel said "compacted 0 documents" — which is also what
       * a healthy instance with nothing to compact says (ADR-0080).
       *
       * The batch is ordered by backlog size, so a document that always fails
       * sits at the top of it forever and starves the live ones. That is
       * invisible without this line.
       */
      const message = `${candidate.doc_id}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[maintenance] compaction failed for ${message}`);
      failures.push(message);
    }
  }
  return { compacted, failures };
}

/**
 * Remove workspaces marked for deletion long enough ago.
 *
 * Deleting one marks it and takes it out of sight; this is the half that
 * actually removes it. Keeping the data forever was also a decision,
 * and not one anybody made deliberately.
 *
 * The retention period is what makes the mark useful: somebody who deletes the
 * wrong workspace has a month to notice, and after that it is gone in the way
 * "deleted" is normally understood — which matters when somebody asks whether
 * their notes are still on this server.
 *
 * Most of it follows by cascade: pages, members, invitations, groups and page
 * grants all reference the workspace. **The documents do not**, and this said
 * they did (ADR-0080). `doc_updates` and `doc_snapshots` carry no foreign key
 * to `pages`, so a bare `DELETE FROM workspaces` removed every page row and
 * left every page's content in the database permanently — unreachable by any
 * view or route, and directly contradicting the paragraph above about what
 * "deleted" means when somebody asks whether their notes are still here. They
 * are removed explicitly now, through the one function that also knows about a
 * page's internal comments document.
 *
 * Files on disk are still left alone rather than deleted here, where a mistake
 * would take somebody else's attachment with it. There is no orphan sweep to
 * leave them to, whatever the previous version of this comment said; that is
 * named in ADR-0080 rather than quietly implied.
 */
export async function purgeDeletedWorkspaces(
  pool: Pool,
  retentionDays: number,
): Promise<number> {
  return withTransaction(pool, async (client) => {
    /*
     * The pages are read before the workspaces go, because afterwards there is
     * nothing left to ask which documents belonged to them — the cascade has
     * already removed the only link. One transaction, so a failure between the
     * two leaves the workspace marked and intact rather than emptied of its
     * content and still listed.
     */
    const doomed = await queryRows<{ id: string }>(
      client,
      `SELECT p.id
         FROM pages p
         JOIN workspaces w ON w.id = p.workspace_id
        WHERE w.deleted_at IS NOT NULL
          AND w.deleted_at < now() - ($1 || ' days')::interval
          AND w.personal_for IS NULL`,
      [String(Math.max(1, retentionDays))],
    );
    await deleteDocumentsFor(
      client,
      doomed.map((row) => row.id),
    );

    const result = await client.query(
      `DELETE FROM workspaces
        WHERE deleted_at IS NOT NULL
          AND deleted_at < now() - ($1 || ' days')::interval
          -- Never a personal one, whatever its mark says. It goes with its
          -- account, and an account is removed elsewhere.
          AND personal_for IS NULL`,
      [String(Math.max(1, retentionDays))],
    );
    return result.rowCount ?? 0;
  });
}
