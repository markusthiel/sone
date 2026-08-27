/**
 * SONE — the version fence.
 *
 * Checked before the server serves any traffic. Its job is to turn three
 * silent, data-corrupting mistakes into one clear refusal to start:
 * a downgrade, a version skip the migration chain cannot cover, and two
 * different versions running against one database.
 *
 * The bargain behind ADR-0013's "forward-only" is that nobody can accidentally
 * go backwards. This is where that is enforced.
 */

import type { Pool } from 'pg';

import { queryOne } from './pool.js';

export class VersionFenceError extends Error {
  constructor(
    message: string,
    readonly code: 'downgrade' | 'too_old' | 'schema_regression',
  ) {
    super(message);
    this.name = 'VersionFenceError';
  }
}

export interface InstanceMeta {
  appVersion: string;
  documentSchemaVersion: number;
  minAppVersion: string;
  instanceId: string;
  firstStartedAt: Date;
  lastStartedAt: Date;
}

/**
 * Compare two version strings.
 *
 * Handles the `-dev` and `-rc.1` suffixes SONE uses: a pre-release sorts
 * before its own release, so 0.2.0-dev < 0.2.0. `dev` with no numeric part at
 * all — a build from a working tree with no SONE_VERSION set — is treated as
 * newer than everything, because refusing to start a developer's local build
 * would be obstructive and no data is at stake there.
 */
export function compareVersions(a: string, b: string): number {
  if (a === b) return 0;
  if (a === 'dev') return 1;
  if (b === 'dev') return -1;

  const parse = (v: string): { parts: number[]; pre: string | null } => {
    const [core, ...rest] = v.split('-');
    const parts = (core ?? '').split('.').map((p) => Number.parseInt(p, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, pre: rest.length > 0 ? rest.join('-') : null };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i++) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  // Same numeric version: a pre-release precedes the release.
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

export const isMajorUpgrade = (from: string, to: string): boolean => {
  const major = (v: string) => Number.parseInt(v.split('.')[0] ?? '0', 10) || 0;
  return major(to) > major(from);
};

export interface FenceResult {
  /** Null on a database that has never been started against. */
  previous: InstanceMeta | null;
  isFirstStart: boolean;
  isUpgrade: boolean;
  isMajorUpgrade: boolean;
}

/**
 * Check compatibility and record this start.
 *
 * Throws rather than warning. A downgrade that is allowed to proceed writes
 * old-format data into a new-format database, and there is no automatic
 * recovery from that — only a backup restore.
 */
export interface FenceOptions {
  /**
   * Permit a version that appears older than the one last recorded.
   *
   * The downgrade check exists because migrations are forward-only, so it is
   * not a formality. But it compares version *strings*, and a version string
   * can be wrong — a build labelled `0.1.0-dev.abc` sorts before
   * `0.1.0-rc.1`, so following development after tagging a release candidate
   * looked like a downgrade and the server refused to start. Nothing answered,
   * not even /api/version, and the only visible symptom was a blank page.
   *
   * An operator in that position needs a way forward that is not "restore a
   * backup". This is that way: deliberate, logged loudly, and never a default.
   *
   * The document schema regression check is NOT bypassable, because that one
   * is about whether the code can read the data rather than about a label.
   */
  allowDowngrade?: boolean;
  log?: (message: string) => void;
}

export async function checkAndRecordVersion(
  pool: Pool,
  appVersion: string,
  documentSchemaVersion: number,
  options: FenceOptions = {},
): Promise<FenceResult> {
  const previous = await readInstanceMeta(pool);

  if (!previous) {
    await pool.query(
      `INSERT INTO instance_meta (app_version, document_schema_version)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE
         SET app_version = EXCLUDED.app_version,
             document_schema_version = EXCLUDED.document_schema_version,
             last_started_at = now()`,
      [appVersion, documentSchemaVersion],
    );
    return {
      previous: null,
      isFirstStart: true,
      isUpgrade: false,
      isMajorUpgrade: false,
    };
  }

  // --- downgrade -----------------------------------------------------------

  if (compareVersions(appVersion, previous.appVersion) < 0) {
    if (!options.allowDowngrade) {
      throw new VersionFenceError(
        `this database was last used by SONE ${previous.appVersion}, but this is ` +
          `${appVersion}. Downgrading is not supported: migrations are ` +
          `forward-only and documents may already be at a newer schema version. ` +
          `Restore a backup taken before the upgrade, or run ${previous.appVersion} ` +
          `or newer.\n\n` +
          `If the version numbers are misleading rather than the code being ` +
          `older — a development build following a release candidate, for ` +
          `instance — set SONE_ALLOW_DOWNGRADE=true for one start. The ` +
          `document format check still applies and is not bypassable.`,
        'downgrade',
      );
    }

    // Loud, because it disables a guard that protects data, and because
    // somebody reading logs later needs to know it was disabled.
    (options.log ?? console.warn)(
      `WARNING: SONE_ALLOW_DOWNGRADE is set. Starting ${appVersion} against a ` +
        `database last used by ${previous.appVersion}. Migrations are ` +
        `forward-only; if this build is genuinely older, data may be lost.`,
    );
  }

  // --- document schema regression -----------------------------------------

  if (documentSchemaVersion < previous.documentSchemaVersion) {
    throw new VersionFenceError(
      `documents in this database may be at schema version ` +
        `${previous.documentSchemaVersion}, but this build supports only ` +
        `${documentSchemaVersion}. It cannot read them.`,
      'schema_regression',
    );
  }

  // --- version skip --------------------------------------------------------

  if (compareVersions(appVersion, previous.minAppVersion) < 0) {
    throw new VersionFenceError(
      `this database requires SONE ${previous.minAppVersion} or newer; this is ${appVersion}.`,
      'too_old',
    );
  }

  const isUpgrade = compareVersions(appVersion, previous.appVersion) > 0;

  await pool.query(
    `UPDATE instance_meta
        SET app_version = $1,
            document_schema_version = greatest(document_schema_version, $2),
            last_started_at = now()`,
    [appVersion, documentSchemaVersion],
  );

  return {
    previous,
    isFirstStart: false,
    isUpgrade,
    isMajorUpgrade: isUpgrade && isMajorUpgrade(previous.appVersion, appVersion),
  };
}

export async function readInstanceMeta(pool: Pool): Promise<InstanceMeta | null> {
  const row = await queryOne<{
    app_version: string;
    document_schema_version: number;
    min_app_version: string;
    instance_id: string;
    first_started_at: Date;
    last_started_at: Date;
  }>(
    pool,
    `SELECT app_version, document_schema_version, min_app_version,
            instance_id, first_started_at, last_started_at
       FROM instance_meta`,
  );
  if (!row) return null;
  return {
    appVersion: row.app_version,
    documentSchemaVersion: row.document_schema_version,
    minAppVersion: row.min_app_version,
    instanceId: row.instance_id,
    firstStartedAt: row.first_started_at,
    lastStartedAt: row.last_started_at,
  };
}

/**
 * How many documents are still on an older schema version.
 *
 * Documents migrate lazily on open, so after an upgrade this number falls over
 * days as people visit their pages. Surfaced because an unopened document stays
 * at its old version indefinitely, and an operator retiring an old version
 * needs to know whether that is finished.
 */
export async function pendingDocumentMigrations(
  pool: Pool,
  currentSchemaVersion: number,
): Promise<Array<{ workspaceId: string; schemaVersion: number; pages: number }>> {
  const { rows } = await pool.query<{
    workspace_id: string;
    schema_version: number;
    pages: string;
  }>(
    `SELECT workspace_id, schema_version, pages::text
       FROM document_schema_census
      WHERE schema_version < $1
      ORDER BY schema_version ASC`,
    [currentSchemaVersion],
  );
  return rows.map((r) => ({
    workspaceId: r.workspace_id,
    schemaVersion: r.schema_version,
    pages: Number(r.pages),
  }));
}
