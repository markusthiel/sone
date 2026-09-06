/**
 * SONE — removing bytes that belong to no row (ADR-0109).
 *
 * The other half of `doc/sweepOrphanDocuments.ts`, and the last thing ADR-0080
 * named and left: purging a deleted workspace removes the `files` rows by
 * cascade and leaves every attachment on the disk, permanently.
 *
 * ## Three places hold a storage key, and missing one deletes live data
 *
 *   `files.storage_key`      attachments
 *   `users.avatar_key`       profile pictures — **not in the files table**
 *   `jobs.result->>'key'`    a workspace export waiting to be downloaded
 *
 * The avatar is the one the application points at. `files/routes.ts`, on
 * replacing a picture: *"The previous one is left in storage for the orphan
 * sweep rather than deleted here."* A sweep that read only `files` would take
 * every avatar on the instance — invited to it by the comment asking for it.
 *
 * The export is the one that hides: an archive's key is inside a `jsonb`
 * column, because "an archive is a file, and a bytea column holding a workspace
 * is a backup nobody chose to take".
 *
 * ## And two properties of the storage itself
 *
 * **Keys are content hashes**, so one file can have many rows: the question is
 * "does *any* row name this key", never "does this row still exist". Deleting
 * per row is the mistake the avatar comment describes avoiding on replace.
 *
 * **The store lists only what it wrote.** A `lost+found`, a dotfile, a mount
 * somebody made underneath — none of it came through `put`, and none of it is
 * a candidate. `FileStore.list` draws that line at the key pattern.
 *
 * Reports by default, like the document sweep, and for the same reason: this
 * removes somebody's attachments, and the number it prints is one an operator
 * can check against their own history first.
 */

import type { Pool } from 'pg';

import { queryRows } from '../db/pool.js';
import type { FileStore } from './store.js';

export interface SweepFilesOptions {
  /**
   * How old the file must be. A week by default.
   *
   * Not a formality: `store.put` happens *before* the `INSERT INTO files`, so
   * between the two a live upload has bytes and no row — the same window
   * `createEntry` has, and the same reason the document sweep waits (ADR-0106).
   */
  olderThanHours?: number;
  /** Report only. The default, deliberately. */
  apply?: boolean;
  limit?: number;
}

export interface SweepFilesReport {
  files: number;
  bytes: number;
  applied: boolean;
  sample: string[];
}

const SAMPLE = 20;

export async function sweepOrphanFiles(
  pool: Pool,
  store: FileStore,
  opts: SweepFilesOptions = {},
): Promise<SweepFilesReport> {
  const hours = Math.max(0, Number.isFinite(opts.olderThanHours) ? opts.olderThanHours! : 24 * 7);
  const limit = Math.max(1, opts.limit ?? 100_000);

  /*
   * Every key the database still names, in one set.
   *
   * Read *before* the listing, deliberately. A row written while this runs then
   * appears in the set and its file is not a candidate; the other order would
   * let a file arrive after the listing and be judged against a set that
   * predates it. Both orders are wrong for something, and this one is wrong in
   * the direction of keeping a file.
   */
  const rows = await queryRows<{ key: string }>(
    pool,
    `SELECT storage_key AS key FROM files
      UNION
     SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL
      UNION
     -- An export archive, while the job that made it still exists. The
     -- maintenance job deletes these when they expire; until then they are
     -- somebody's download.
     SELECT result->>'key' FROM jobs WHERE result ? 'key'`,
  );
  const live = new Set(rows.map((row) => row.key));

  const cutoff = Date.now() - hours * 3_600_000;
  const orphans = (await store.list())
    .filter((one) => !live.has(one.key) && one.modifiedAt.getTime() < cutoff)
    .sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime())
    .slice(0, limit);

  const report: SweepFilesReport = {
    files: orphans.length,
    bytes: orphans.reduce((total, one) => total + one.sizeBytes, 0),
    applied: opts.apply === true,
    sample: orphans.slice(0, SAMPLE).map((one) => one.key),
  };

  if (opts.apply !== true) return report;

  for (const one of orphans) await store.delete(one.key);
  return report;
}
