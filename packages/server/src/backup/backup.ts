/**
 * SONE — backup and restore.
 *
 * ADR-0013 makes upgrades forward-only, which is only defensible if a backup
 * restore is a real, tested path rather than a sentence in a README. This is
 * that path.
 *
 * **Ordering matters and is not arbitrary.** Files are archived before the
 * database:
 *
 *   files first  -> a file uploaded during the backup may end up in the
 *                   archive without a database row. Result: an orphaned file,
 *                   wasting a few kilobytes. Harmless.
 *   database first -> a file uploaded during the backup would have a row but
 *                   no file. Result: a page referencing an attachment that
 *                   does not exist. User-visible corruption.
 *
 * The cheap failure is chosen deliberately. An orphaned-file report is part of
 * the restore output so the harmless case is still visible.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Pool } from 'pg';

import { queryOne } from '../db/pool.js';
import { readInstanceMeta } from '../db/version.js';

export const MANIFEST_NAME = 'sone-backup.json';
/** Bumped if the archive layout changes, so a restore can refuse an unknown one. */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  backupFormatVersion: number;
  createdAt: string;
  /** Application version that produced the backup. */
  appVersion: string;
  documentSchemaVersion: number;
  /** Highest applied migration, so a restore can check the target. */
  migration: string | null;
  instanceId: string | null;
  database: { file: string; bytes: number; sha256: string };
  files: { file: string; bytes: number; sha256: string; count: number } | null;
  counts: {
    workspaces: number;
    users: number;
    pages: number;
    documents: number;
  };
}

export class BackupError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'pg_dump_missing'
      | 'pg_dump_failed'
      | 'psql_failed'
      | 'unknown_format'
      | 'checksum_mismatch'
      | 'not_empty'
      | 'io',
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

async function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'inherit', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(
        new BackupError(
          `${command} could not be executed: ${err.message}. ` +
            `Is the postgresql-client package installed in the image?`,
          'pg_dump_missing',
        ),
      );
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new BackupError(
            `${command} exited with code ${code}: ${stderr.trim().slice(0, 2000)}`,
            command === 'psql' ? 'psql_failed' : 'pg_dump_failed',
          ),
        );
      }
    });
  });
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

export interface BackupOptions {
  pool: Pool;
  databaseUrl: string;
  /** Directory the archive is written into. Created if absent. */
  outputDir: string;
  /** Local file storage path, or null when using S3. */
  filesPath: string | null;
  appVersion: string;
  documentSchemaVersion: number;
  log?: (msg: string) => void;
}

export async function createBackup(opts: BackupOptions): Promise<BackupManifest> {
  const log = opts.log ?? console.log;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(opts.outputDir, `sone-${stamp}`);
  await mkdir(dir, { recursive: true });

  // --- files first. See the note at the top of this file. -----------------
  let files: BackupManifest['files'] = null;
  if (opts.filesPath) {
    const exists = await stat(opts.filesPath).catch(() => null);
    if (exists?.isDirectory()) {
      const archive = path.join(dir, 'files.tar.gz');
      log('[backup] archiving files');
      await run('tar', ['-czf', archive, '-C', opts.filesPath, '.']);
      const info = await stat(archive);
      const count = await countFiles(opts.pool);
      files = {
        file: 'files.tar.gz',
        bytes: info.size,
        sha256: await sha256File(archive),
        count,
      };
    } else {
      log(`[backup] file storage ${opts.filesPath} not present, skipping`);
    }
  } else {
    log('[backup] S3 storage in use; files are not included in this archive');
  }

  // --- database ------------------------------------------------------------
  const dumpFile = path.join(dir, 'database.dump');
  log('[backup] dumping database');
  // Custom format: compressed, and restorable with pg_restore in parallel.
  // --no-owner and --no-privileges so the dump restores into a database whose
  // role names differ, which they will on someone else's deployment.
  await run('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    dumpFile,
    opts.databaseUrl,
  ]);

  const dumpInfo = await stat(dumpFile);
  const meta = await readInstanceMeta(opts.pool);
  const counts = await gatherCounts(opts.pool);
  const migration = await queryOne<{ latest: string }>(
    opts.pool,
    `SELECT max(version) AS latest FROM schema_migrations`,
  );

  const manifest: BackupManifest = {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: opts.appVersion,
    documentSchemaVersion: opts.documentSchemaVersion,
    migration: migration?.latest ?? null,
    instanceId: meta?.instanceId ?? null,
    database: {
      file: 'database.dump',
      bytes: dumpInfo.size,
      sha256: await sha256File(dumpFile),
    },
    files,
    counts,
  };

  await writeFile(
    path.join(dir, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  log(
    `[backup] complete: ${dir}\n` +
      `          ${counts.pages} page(s), ${counts.documents} document(s), ` +
      `${counts.users} user(s) in ${counts.workspaces} workspace(s)`,
  );
  return manifest;
}

async function gatherCounts(pool: Pool): Promise<BackupManifest['counts']> {
  const row = await queryOne<{
    workspaces: string;
    users: string;
    pages: string;
    documents: string;
  }>(
    pool,
    `SELECT (SELECT count(*) FROM workspaces)::text AS workspaces,
            (SELECT count(*) FROM users)::text      AS users,
            (SELECT count(*) FROM pages)::text      AS pages,
            (SELECT count(*) FROM (
               SELECT doc_id FROM doc_snapshots
               UNION SELECT DISTINCT doc_id FROM doc_updates) d)::text AS documents`,
  );
  return {
    workspaces: Number(row?.workspaces ?? 0),
    users: Number(row?.users ?? 0),
    pages: Number(row?.pages ?? 0),
    documents: Number(row?.documents ?? 0),
  };
}

async function countFiles(pool: Pool): Promise<number> {
  const row = await queryOne<{ n: string }>(pool, `SELECT count(*)::text AS n FROM files`);
  return Number(row?.n ?? 0);
}

export interface RestoreOptions {
  archiveDir: string;
  databaseUrl: string;
  filesPath: string | null;
  /** Refuse unless the target database is empty. */
  requireEmpty?: boolean;
  pool: Pool;
  log?: (msg: string) => void;
}

export interface RestoreReport {
  manifest: BackupManifest;
  restoredFiles: boolean;
  warnings: string[];
}

/**
 * Restore an archive.
 *
 * Verifies checksums before touching anything: a truncated archive discovered
 * halfway through a restore is worse than one refused up front, because by then
 * the previous state is gone.
 */
export async function restoreBackup(opts: RestoreOptions): Promise<RestoreReport> {
  const log = opts.log ?? console.log;
  const warnings: string[] = [];

  const manifestPath = path.join(opts.archiveDir, MANIFEST_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;

  if (manifest.backupFormatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      `archive uses backup format ${manifest.backupFormatVersion}, this build understands ` +
        `up to ${BACKUP_FORMAT_VERSION}. Restore with the version of SONE that created it.`,
      'unknown_format',
    );
  }

  log('[restore] verifying checksums');
  const dumpFile = path.join(opts.archiveDir, manifest.database.file);
  const dumpHash = await sha256File(dumpFile);
  if (dumpHash !== manifest.database.sha256) {
    throw new BackupError(
      `database dump checksum mismatch: archive is corrupt or truncated`,
      'checksum_mismatch',
    );
  }
  if (manifest.files) {
    const archive = path.join(opts.archiveDir, manifest.files.file);
    if ((await sha256File(archive)) !== manifest.files.sha256) {
      throw new BackupError(`file archive checksum mismatch`, 'checksum_mismatch');
    }
  }

  if (opts.requireEmpty !== false) {
    const row = await queryOne<{ n: string }>(
      opts.pool,
      `SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'`,
    ).catch(() => null);
    if (row && Number(row.n) > 0) {
      throw new BackupError(
        `target database is not empty (${row.n} table(s)). Restore into a fresh ` +
          `database, or pass --force to drop and recreate the public schema.`,
        'not_empty',
      );
    }
  }

  // Restore the database before the files, mirroring the backup order in
  // reverse: a row without its file is the failure mode to avoid, so the files
  // land last and the window closes on the safe side.
  log('[restore] restoring database');
  await run('pg_restore', [
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
    '--dbname',
    opts.databaseUrl,
    dumpFile,
  ]);

  let restoredFiles = false;
  if (manifest.files && opts.filesPath) {
    log('[restore] restoring files');
    await mkdir(opts.filesPath, { recursive: true });
    await run('tar', [
      '-xzf',
      path.join(opts.archiveDir, manifest.files.file),
      '-C',
      opts.filesPath,
    ]);
    restoredFiles = true;
  } else if (manifest.files && !opts.filesPath) {
    warnings.push(
      'archive contains files but no local file storage path is configured; ' +
        'attachments will be missing',
    );
  } else if (!manifest.files) {
    warnings.push(
      'archive contains no files. If the source used S3 storage, point this ' +
        'instance at the same bucket.',
    );
  }

  log(
    `[restore] complete. Source: SONE ${manifest.appVersion}, ` +
      `document schema v${manifest.documentSchemaVersion}, ` +
      `migration ${manifest.migration ?? 'unknown'}`,
  );
  if (manifest.appVersion !== 'dev') {
    log(
      `[restore] start SONE ${manifest.appVersion} or newer; migrations will ` +
        `run automatically on start.`,
    );
  }

  return { manifest, restoredFiles, warnings };
}
