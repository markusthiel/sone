/**
 * SONE server — running work that outlives a request (ADR-0044).
 *
 * A workspace export cannot be an HTTP response: it reads every page, packs
 * megabytes and takes longer than any sensible timeout. So it becomes a row,
 * this picks it up, and the result is fetched afterwards.
 *
 * Claiming is `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`, which
 * is the whole reason this is a table rather than an in-process list: two
 * instances behind one address must not both run somebody's export, and
 * `SKIP LOCKED` is how Postgres says "give me one nobody else is holding". An
 * in-memory queue would work perfectly until the day SONE runs twice.
 */

import type { Pool } from 'pg';

import { queryOne } from '../db/pool.js';

export interface Job {
  id: string;
  workspaceId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdBy: string | null;
}

export interface JobContext {
  /** Say what is happening, for somebody watching. */
  report: (progress: string) => Promise<void>;
}

/** What a kind of job does. Returns whatever should be stored as its result. */
export type JobHandler = (
  job: Job,
  ctx: JobContext,
) => Promise<{ result: Record<string, unknown>; expiresAt?: Date }>;

/**
 * How long a finished job's result stays fetchable.
 *
 * A default rather than for ever: an export sitting in the file store is a copy
 * of a workspace nobody remembers making, and the longer it sits the more likely
 * it outlives the permissions that produced it.
 */
export const JOB_RESULT_HOURS = Number(process.env['SONE_JOB_RESULT_HOURS'] ?? 24);

export async function enqueue(
  pool: Pool,
  input: {
    workspaceId: string;
    kind: string;
    payload?: Record<string, unknown>;
    createdBy: string | null;
  },
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO jobs (workspace_id, kind, payload, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.workspaceId, input.kind, input.payload ?? {}, input.createdBy],
  );
  if (!row) throw new Error('job_not_created');
  return row.id;
}

/**
 * Take the oldest queued job nobody else holds, and mark it running.
 *
 * One statement, so there is no window between choosing and claiming. Doing it
 * as a select and then an update would hand the same job to two instances often
 * enough to matter, and the symptom — two exports, one download, occasionally —
 * is the kind nobody reproduces.
 */
export async function claimJob(pool: Pool, kinds: string[]): Promise<Job | null> {
  const row = await queryOne<{
    id: string;
    workspace_id: string;
    kind: string;
    payload: Record<string, unknown>;
    created_by: string | null;
  }>(
    pool,
    `UPDATE jobs
        SET state = 'running',
            started_at = now(),
            attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
         WHERE state = 'queued' AND kind = ANY($1::text[])
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, workspace_id, kind, payload, created_by`,
    [kinds],
  );
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    payload: row.payload,
    createdBy: row.created_by,
  };
}

/**
 * Run one job, if there is one. Returns whether it ran.
 *
 * Failures are recorded on the row rather than thrown: the caller is a timer,
 * and a timer that stops because one job failed is a queue that silently stops
 * working. The error text is stored so somebody can be told *why* their export
 * did not arrive instead of watching it stay at "queued" for ever.
 */
export async function runOneJob(
  pool: Pool,
  handlers: Record<string, JobHandler>,
): Promise<boolean> {
  const job = await claimJob(pool, Object.keys(handlers));
  if (!job) return false;

  const handler = handlers[job.kind];
  if (!handler) {
    // Claimed and unrunnable: a kind this build does not know, which happens
    // when a job outlives a downgrade. Failed with a plain reason rather than
    // left running for ever.
    await pool.query(
      `UPDATE jobs SET state = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [job.id, `unknown job kind: ${job.kind}`],
    );
    return true;
  }

  try {
    const { result, expiresAt } = await handler(job, {
      report: async (progress) => {
        await pool.query(`UPDATE jobs SET progress = $2 WHERE id = $1`, [job.id, progress]);
      },
    });

    await pool.query(
      `UPDATE jobs
          SET state = 'done',
              result = $2,
              progress = NULL,
              finished_at = now(),
              expires_at = $3
        WHERE id = $1`,
      [
        job.id,
        result,
        expiresAt ?? new Date(Date.now() + JOB_RESULT_HOURS * 3600_000),
      ],
    );
  } catch (error) {
    await pool.query(
      `UPDATE jobs SET state = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [job.id, error instanceof Error ? error.message : 'unknown'],
    );
  }
  return true;
}

/**
 * Free the results of jobs that have expired, and forget the rows.
 *
 * `deleteResult` is handed in because this module must not know that a result
 * happens to be a key in a file store — a future job kind whose result is a row
 * elsewhere should not have to change this function.
 */
export async function expireJobs(
  pool: Pool,
  deleteResult: (result: Record<string, unknown>) => Promise<void>,
): Promise<number> {
  const { rows } = await pool.query<{ id: string; result: Record<string, unknown> | null }>(
    `SELECT id, result FROM jobs
      WHERE expires_at IS NOT NULL AND expires_at < now()`,
  );

  for (const row of rows) {
    if (row.result) {
      try {
        await deleteResult(row.result);
      } catch {
        // The row goes anyway. A key that could not be deleted is a file left
        // in storage, which the next pass cannot find because the row is gone —
        // so this is a leak, and the honest place to fix it is the store's own
        // sweep rather than keeping a job row for ever in the hope of a retry.
      }
    }
  }

  const { rowCount } = await pool.query(
    `DELETE FROM jobs WHERE expires_at IS NOT NULL AND expires_at < now()`,
  );
  return rowCount ?? 0;
}
