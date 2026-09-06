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
 * The cheap failure is chosen deliberately, and the restore says so rather than
 * counting it: comparing the extracted tar against the `files` table would be a
 * second inventory to keep correct, for a few wasted kilobytes. This comment
 * used to promise an orphaned-file report that was never written (ADR-0079).
 *
 * **An archive is a directory that has a manifest in it.** The manifest is
 * written last, and the directory is named `.incomplete` until it is — so a
 * backup killed halfway through is visibly not a backup, rather than a
 * directory that looks like one and fails at the moment it is needed.
 */

import { spawn } from 'node:child_process';
import { createHash, hkdfSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

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
  /**
   * Why `files` is null, when it is.
   *
   * `null` files used to mean three different things — the instance keeps its
   * attachments in S3, the directory was empty, or nobody could look at the
   * directory — and the restore had to guess, so it told every operator with a
   * file-less archive to "point this instance at the same bucket" whether or
   * not there had ever been a bucket. The backup knows which it was; it just
   * threw the answer away.
   *
   * Optional, so an archive written before this field still restores.
   */
  fileStorage?: 'local' | 's3' | 'none';
  /**
   * Which `SONE_SECRET_KEY` sealed the data in this archive (ADR-0105).
   *
   * Share tokens, second-factor secrets and mail reply tokens are encrypted or
   * signed with a key that lives in the environment, not in the database — so
   * an archive restored under a different one comes back complete and
   * *silently* missing all three. `decryptShareToken` answers `null` for a
   * wrong key, which is indistinguishable from a link that was never made.
   *
   * Optional, so an archive written before this field still restores — and the
   * restore says it could not check rather than passing quietly, which is the
   * same distinction `fileStorage` above exists for.
   */
  secretKeyFingerprint?: string;
  counts: {
    workspaces: number;
    users: number;
    pages: number;
    documents: number;
  };
}

/**
 * Which `SONE_SECRET_KEY` an archive was sealed under (ADR-0105).
 *
 * Not the key, and nothing a key can be recovered from: HKDF with a purpose
 * string of its own, so this output and the one `shareTokenStore` derives for
 * encryption are independent — knowing this one says nothing about that one.
 * The archive it sits in contains the whole database, so the only thing worth
 * being careful about is not making the *key* recoverable, and this does not.
 *
 * No salt, for the reason `shareTokenStore.keyFrom` gives: the secret is
 * high-entropy by configuration (`loadConfig` refuses anything under 32
 * characters), and a salt would have to be stored beside the value it protects.
 */
const FINGERPRINT_INFO = 'sone/backup/key-fingerprint/v1';

export function secretKeyFingerprint(secretKey: string): string {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secretKey, 'utf8'), Buffer.alloc(0), FINGERPRINT_INFO, 32),
  ).toString('hex');
}

export class BackupError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'pg_dump_missing'
      | 'pg_dump_failed'
      /** The client is older than the server. Actionable; see the message. */
      | 'version_mismatch'
      | 'pg_restore_failed'
      | 'unknown_format'
      | 'checksum_mismatch'
      /** The archive was sealed under a different SONE_SECRET_KEY (ADR-0105). */
      | 'key_mismatch'
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
          `${command} could not be executed: ${err.message}.` +
            // `tar` is also spawned here, and telling somebody to install
            // postgresql-client because tar is missing sends them a day away
            // from the actual problem.
            (command === 'tar'
              ? ''
              : ` Is the postgresql-client package installed in the image?`),
          'pg_dump_missing',
        ),
      );
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim().slice(0, 2000);

      // A version mismatch is the one failure here with a specific, actionable
      // cause, and pg_dump's own wording does not say what to do about it.
      // pg_dump can dump a server of its own version or older, never newer.
      if (/server version mismatch/i.test(detail)) {
        // pg_dump's detail line carries a build suffix in parentheses, so this
        // reads up to the separator rather than matching a bare token:
        //   server version: 17.11 (Debian ...); pg_dump version: 15.19 (...)
        const versions = /server version: ([^;]+); pg_dump version: (.+)/.exec(detail);
        const explanation = versions
          ? `The server is ${versions[1]!.trim()} but pg_dump is ${versions[2]!.trim()}.`
          : 'The installed pg_dump is older than the server.';
        reject(
          new BackupError(
            `${explanation} pg_dump cannot dump a server newer than itself. ` +
              `Install a postgresql-client whose major version is at least the ` +
              `server's. In the SONE image this is pinned to match the Postgres ` +
              `in docker-compose.yml; if you point SONE at a newer external ` +
              `Postgres, the image needs a newer client too.\n\n${detail}`,
            'version_mismatch',
          ),
        );
        return;
      }

      /*
       * Named after what actually ran. `psql` is never spawned here, so that
       * branch was dead and every pg_restore failure was reported as
       * `pg_dump_failed` — a code that sends a reader to the wrong half of the
       * file.
       */
      reject(
        new BackupError(
          `${command} exited with code ${code}: ${detail}`,
          command === 'pg_restore' ? 'pg_restore_failed' : 'pg_dump_failed',
        ),
      );
    });
  });
}

/**
 * The checksum of a file, read as a stream.
 *
 * It used to `readFile` the whole artefact into memory. A dump is the largest
 * thing this project ever produces, and above Node's buffer limit — two
 * gigabytes — that throws outright: the backup of the instance big enough to
 * need one is the backup that cannot be made. Below the limit it still asks a
 * container for as much RAM as the database is large, at both ends, and the
 * restore end is the one that runs on the day something has already gone wrong.
 */
async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
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
  /**
   * The instance's `SONE_SECRET_KEY`, recorded as a fingerprint (ADR-0105).
   *
   * Required rather than optional: a backup that omits something is only
   * allowed to do so on purpose, which is the rule the file-storage branch
   * above was rewritten for, and an archive that cannot say which key sealed it
   * is the case this field exists to end.
   */
  secretKey: string;
  log?: (msg: string) => void;
}

export async function createBackup(opts: BackupOptions): Promise<BackupManifest> {
  const log = opts.log ?? console.log;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalDir = path.join(opts.outputDir, `sone-${stamp}`);
  // Built under a name nothing will mistake for an archive, and renamed once
  // the manifest is in it. See the note at the top of this file.
  const dir = `${finalDir}.incomplete`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  // --- files first. See the note at the top of this file. -----------------
  let files: BackupManifest['files'] = null;
  let fileStorage: NonNullable<BackupManifest['fileStorage']> = opts.filesPath ? 'none' : 's3';
  if (opts.filesPath) {
    /*
     * "Not there" and "cannot look" are different answers.
     *
     * This was one `.catch(() => null)`, so a directory that could not be read
     * — a permission, a volume that failed to mount — produced the same quiet
     * "not present, skipping" as one that genuinely holds nothing, and the
     * backup succeeded without its attachments. A backup that omits things is
     * only allowed to do so on purpose (ADR-0079).
     */
    const exists = await stat(opts.filesPath).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new BackupError(
        `file storage ${opts.filesPath} could not be read: ${
          err instanceof Error ? err.message : String(err)
        }. Refusing to write a backup that would silently omit attachments.`,
        'io',
      );
    });
    if (exists?.isDirectory()) {
      fileStorage = 'local';
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
    /*
     * Loud, and recorded in the manifest.
     *
     * An S3 instance's backup is the database and nothing else, which is a
     * defensible thing to produce and an indefensible thing to produce quietly:
     * the operator finds out on the day they restore, when the attachments are
     * the half that is missing. The bucket is somebody else's backup problem,
     * and this says so at the moment it is being skipped.
     */
    log(
      '[backup] WARNING: attachments are in S3 and are NOT in this archive. ' +
        'The bucket needs a backup of its own; this archive restores the ' +
        'database only.',
    );
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
    fileStorage,
    secretKeyFingerprint: secretKeyFingerprint(opts.secretKey),
    counts,
  };

  await writeFile(
    path.join(dir, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  // The last act, and the one that makes the directory an archive.
  await rm(finalDir, { recursive: true, force: true });
  await rename(dir, finalDir);

  log(
    `[backup] complete: ${finalDir}\n` +
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
  /** This instance's `SONE_SECRET_KEY`, checked against the archive (ADR-0105). */
  secretKey: string;
  /**
   * Restore anyway when the archive was sealed under a different key.
   *
   * Its own flag rather than reusing `requireEmpty`'s `--force`: those are two
   * different risks, and one flag answering both is a flag people pass without
   * reading either. The case it exists for is real — the old key leaked, or is
   * gone, and somebody is restoring knowing what it costs.
   */
  allowDifferentKey?: boolean;
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
  /*
   * A directory with no manifest is not an archive.
   *
   * It used to arrive as a raw ENOENT naming a JSON file, which is a puzzle at
   * the worst possible moment. A backup interrupted before its manifest was
   * written leaves exactly this — and now leaves it under a `.incomplete`
   * name, so the message can say which of the two it is.
   */
  const raw = await readFile(manifestPath, 'utf8').catch(() => null);
  if (raw === null) {
    throw new BackupError(
      `${opts.archiveDir} holds no ${MANIFEST_NAME}, so it is not a SONE archive. ` +
        `A directory whose name ends in .incomplete is a backup that was ` +
        `interrupted before it finished, and cannot be restored.`,
      'unknown_format',
    );
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw) as BackupManifest;
  } catch {
    throw new BackupError(`${manifestPath} is not readable JSON`, 'unknown_format');
  }

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

  /*
   * The key the archive was sealed under (ADR-0105).
   *
   * Checked here, beside the checksums, because it belongs to the same family:
   * everything in this block is a reason to refuse **before** anything is
   * touched. A wrong key discovered after the restore is a database that came
   * back whole and quietly lost every share link, every second factor and every
   * mail reply token — `decryptShareToken` answers `null` rather than throwing,
   * so nothing anywhere reports it.
   *
   * Three states, three answers, deliberately not two: sealed under this key,
   * sealed under another, and an archive too old to say. The middle one refuses
   * and the last one warns, because "not checked" and "checked and fine" are
   * different answers — the argument `fileStorage` was added for.
   */
  if (manifest.secretKeyFingerprint === undefined) {
    warnings.push(
      'this archive predates the key fingerprint, so it could not be checked whether ' +
        'it was sealed with the SONE_SECRET_KEY this instance is using. If share links ' +
        'or second factors stop working after the restore, that is why.',
    );
  } else if (manifest.secretKeyFingerprint !== secretKeyFingerprint(opts.secretKey)) {
    if (!opts.allowDifferentKey) {
      throw new BackupError(
        'this archive was sealed with a different SONE_SECRET_KEY than the one this ' +
          'instance is configured with.\n\n' +
          'The restore would succeed and then silently lose everything sealed with the ' +
          'old key: every share link, every second factor, and every mail reply token. ' +
          'Nothing reports that — a link sealed with another key is indistinguishable ' +
          'from a link that was never made.\n\n' +
          'Set SONE_SECRET_KEY to the value the backed-up instance used. If that key is ' +
          'gone and you are restoring anyway, --different-key proceeds and accepts the ' +
          'loss.',
        'key_mismatch',
      );
    }
    warnings.push(
      'restored under a different SONE_SECRET_KEY than the archive was sealed with. ' +
        'Share links, second factors and mail reply tokens from before the backup will ' +
        'not work; people with a second factor will have to set one up again.',
    );
  }

  if (opts.requireEmpty !== false) {
    const row = await queryOne<{ n: string }>(
      opts.pool,
      `SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'`,
    ).catch(() => null);
    if (row && Number(row.n) > 0) {
      throw new BackupError(
        `target database is not empty (${row.n} table(s)). Restore into a fresh ` +
          `database.\n\n` +
          `--force skips this check; it does NOT empty the database. The restore ` +
          `drops and recreates only what the dump contains, so anything this ` +
          `version of SONE added since the backup was taken stays behind while ` +
          `schema_migrations is rewound — and the next start fails on a column ` +
          `that already exists. Use it to restore over the SAME instance's own ` +
          `data, not to move a database backwards.`,
        'not_empty',
      );
    }
  }

  // Restore the database before the files, mirroring the backup order in
  // reverse: a row without its file is the failure mode to avoid, so the files
  // land last and the window closes on the safe side.
  log('[restore] restoring database');
  /*
   * `--single-transaction`: the restore happens or it does not.
   *
   * Without it, pg_restore carries on past an error and reports the count at
   * the end. It does exit non-zero — I checked that against pg_restore 16
   * rather than believing a claim that it exits 0, and the claim was wrong — so
   * this was never a silent failure. What it was is a *partial* one: the throw
   * arrived after half the objects had been dropped and recreated, leaving a
   * database in a state nothing describes, on the day somebody is already
   * having a bad one. One transaction means the previous state is still there
   * when the message appears.
   *
   * It implies --exit-on-error, and it rules out --jobs, which this has never
   * used.
   */
  await run('pg_restore', [
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
    '--single-transaction',
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
    /*
     * The right sentence for the right reason. This said "if the source used
     * S3 storage, point this instance at the same bucket" to everybody,
     * including instances that had never seen a bucket — advice that sends an
     * operator looking for a configuration that does not exist. The backup
     * knew which case it was and now records it.
     */
    warnings.push(
      manifest.fileStorage === 's3'
        ? 'the source kept attachments in S3, so they are not in this archive: ' +
            'point this instance at that bucket, and make sure the bucket has a ' +
            'backup of its own'
        : manifest.fileStorage === 'none'
          ? 'the source had no attachments at the time of the backup'
          : 'archive contains no files. If the source used S3 storage, point this ' +
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
