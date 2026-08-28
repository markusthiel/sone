/**
 * Upgrade machinery tests.
 *
 * The backup round trip is the important one. ADR-0013 makes upgrades
 * forward-only, which is only defensible if restore actually works — so this
 * dumps a real database, wipes it, restores it, and checks the documents
 * still open.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  DOCUMENT_MIGRATIONS,
  DOC_KEYS,
  DocumentVersionError,
  META_KEYS,
  PAGE_KEYS,
  SCHEMA_VERSION,
  appendBlocks,
  documentSchemaVersion,
  isClientSchemaCompatible,
  migrateDocument,
  readBlockTree,
} from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { withTransaction } from '../src/db/pool.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { appendUpdate, loadDoc } from '../src/doc/docStore.js';
import {
  VersionFenceError,
  checkAndRecordVersion,
  compareVersions,
  isMajorUpgrade,
  pendingDocumentMigrations,
  readInstanceMeta,
} from '../src/db/version.js';
import {
  BACKUP_FORMAT_VERSION,
  BackupError,
  MANIFEST_NAME,
  createBackup,
  restoreBackup,
} from '../src/backup/backup.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  testDatabaseUrl,
  uuid,
  type Fixture,
} from './support/db.js';

// --- version comparison ----------------------------------------------------

describe('version comparison', () => {
  test('orders release versions', () => {
    assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
    assert.equal(compareVersions('0.2.0', '0.1.0'), 1);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('1.9.0', '1.10.0'), -1, 'numeric, not lexical');
    assert.equal(compareVersions('2.0.0', '10.0.0'), -1);
  });

  test('pre-release identifiers compare numerically, not lexically', () => {
    // The same question this file already asks of the core version — "numeric,
    // not lexical" — was never asked of the pre-release, and the answer there
    // was wrong. Builds are versioned 0.1.1-dev.<n>.g<sha>, and the whole
    // pre-release was compared as one string, so "dev.10..." sorted below
    // "dev.9...". The tenth build after a tag was refused as a downgrade and a
    // running instance stopped serving.
    assert.equal(
      compareVersions('0.1.1-dev.10.g0d11a0a', '0.1.1-dev.9.g23c9271'),
      1,
      'ten is after nine',
    );
    assert.equal(compareVersions('0.1.1-dev.9.gabc', '0.1.1-dev.10.gabc'), -1);
    assert.equal(compareVersions('0.1.1-dev.100.gabc', '0.1.1-dev.99.gabc'), 1);
  });

  test('a numeric identifier ranks below an alphanumeric one', () => {
    // What semantic versioning specifies, and why "rc" sorts above "1".
    assert.equal(compareVersions('0.1.0-1', '0.1.0-rc'), -1);
    assert.equal(compareVersions('0.1.0-rc', '0.1.0-1'), 1);
  });

  test('fewer identifiers ranks below more, all else equal', () => {
    assert.equal(compareVersions('0.1.0-dev', '0.1.0-dev.1'), -1);
    assert.equal(compareVersions('0.1.0-rc.1', '0.1.0-rc.1.7.gabc'), -1);
  });

  test('a dev build after a release sorts above it', () => {
    assert.equal(compareVersions('0.1.1-dev.1.gabc', '0.1.0'), 1);
    assert.equal(compareVersions('0.1.1-dev.10.gabc', '0.1.1'), -1);
  });

  test('a pre-release precedes its own release', () => {
    assert.equal(compareVersions('0.2.0-dev', '0.2.0'), -1);
    assert.equal(compareVersions('0.2.0-rc.1', '0.2.0'), -1);
    assert.equal(compareVersions('0.2.0-dev', '0.1.9'), 1);
  });

  test('a bare dev build outranks everything', () => {
    // Refusing to start a developer's local build would be obstructive, and no
    // production data is at stake there.
    assert.equal(compareVersions('dev', '99.0.0'), 1);
    assert.equal(compareVersions('0.1.0', 'dev'), -1);
    assert.equal(compareVersions('dev', 'dev'), 0);
  });

  test('handles short and malformed versions without throwing', () => {
    assert.equal(compareVersions('1', '1.0.0'), 0);
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
    assert.equal(typeof compareVersions('garbage', '1.0.0'), 'number');
  });

  test('detects a major boundary', () => {
    assert.equal(isMajorUpgrade('0.9.0', '1.0.0'), true);
    assert.equal(isMajorUpgrade('1.0.0', '1.9.0'), false);
    assert.equal(isMajorUpgrade('1.0.0', '3.0.0'), true);
  });
});

// --- document migrations ---------------------------------------------------

describe('document migrations', () => {
  const makeDoc = (version: number): Y.Doc => {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, version);
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'Doc');
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.idx, 'a0');
    return doc;
  };

  test('a current document is left untouched', () => {
    const doc = makeDoc(SCHEMA_VERSION);
    const before = Y.encodeStateAsUpdate(doc);
    const outcome = migrateDocument(doc);

    assert.equal(outcome.changed, false, 'no write on the common path');
    assert.deepEqual(Array.from(Y.encodeStateAsUpdate(doc)), Array.from(before));
    doc.destroy();
  });

  test('a document with no recorded version is treated as version 1', () => {
    // Documents written before the field existed must not be rejected.
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'Legacy');
    assert.equal(documentSchemaVersion(doc), 1);
    doc.destroy();
  });

  test('a garbage version field is treated as version 1', () => {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 'two');
    assert.equal(documentSchemaVersion(doc), 1);
    doc.destroy();
  });

  test('a document from a newer SONE is refused, not guessed at', () => {
    // The check that makes an accidental downgrade fail loudly.
    const doc = makeDoc(SCHEMA_VERSION + 5);
    const err = (() => {
      try {
        migrateDocument(doc);
        return null;
      } catch (e) {
        return e as DocumentVersionError;
      }
    })();
    assert.ok(err instanceof DocumentVersionError);
    assert.equal(err.code, 'too_new');
    assert.equal(err.documentVersion, SCHEMA_VERSION + 5);
    doc.destroy();
  });

  test('the migration chain has no gaps', () => {
    // A bumped SCHEMA_VERSION without a matching migration leaves documents
    // silently stuck. This test is the guard.
    for (let version = 1; version < SCHEMA_VERSION; version++) {
      const step = DOCUMENT_MIGRATIONS.find((m) => m.from === version);
      assert.ok(step, `missing document migration from version ${version}`);
      assert.equal(step!.to, version + 1, 'migrations must not skip versions');
    }
  });

  test('every migration is idempotent and deterministic', () => {
    // Two clients opening the same unmigrated document must produce identical
    // results, or the merge is nonsense. Vacuously true while the chain is
    // empty; becomes load-bearing with the first entry.
    for (const step of DOCUMENT_MIGRATIONS) {
      const a = makeDoc(step.from);
      const b = makeDoc(step.from);

      step.migrate(a);
      step.migrate(b);
      assert.deepEqual(
        Array.from(Y.encodeStateAsUpdate(a)),
        Array.from(Y.encodeStateAsUpdate(b)),
        `migration ${step.from}->${step.to} is not deterministic`,
      );

      const once = Y.encodeStateAsUpdate(a);
      step.migrate(a);
      assert.deepEqual(
        Array.from(Y.encodeStateAsUpdate(a)),
        Array.from(once),
        `migration ${step.from}->${step.to} is not idempotent`,
      );

      a.destroy();
      b.destroy();
    }
  });

  test('client schema compatibility is exact', () => {
    assert.equal(isClientSchemaCompatible(SCHEMA_VERSION), true);
    assert.equal(isClientSchemaCompatible(SCHEMA_VERSION - 1), false);
    assert.equal(isClientSchemaCompatible(SCHEMA_VERSION + 1), false);
  });
});

// --- version fence ---------------------------------------------------------

describe('version fence (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;

  before(async () => {
    db = await getTestPool();
  });
  after(async () => {
    await closeTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(db);
  });

  test('the first start records the version', async () => {
    const result = await checkAndRecordVersion(db, '0.1.0', 1);
    assert.equal(result.isFirstStart, true);
    assert.equal(result.previous, null);

    const meta = await readInstanceMeta(db);
    assert.equal(meta!.appVersion, '0.1.0');
    assert.ok(meta!.instanceId);
  });

  test('a same-version restart is not reported as an upgrade', async () => {
    await checkAndRecordVersion(db, '0.1.0', 1);
    const again = await checkAndRecordVersion(db, '0.1.0', 1);
    assert.equal(again.isFirstStart, false);
    assert.equal(again.isUpgrade, false);
  });

  test('an upgrade is detected and recorded', async () => {
    await checkAndRecordVersion(db, '0.1.0', 1);
    const result = await checkAndRecordVersion(db, '0.2.0', 1);
    assert.equal(result.isUpgrade, true);
    assert.equal(result.isMajorUpgrade, false);
    assert.equal(result.previous!.appVersion, '0.1.0');
    assert.equal((await readInstanceMeta(db))!.appVersion, '0.2.0');
  });

  test('a major upgrade is flagged', async () => {
    await checkAndRecordVersion(db, '0.9.0', 1);
    const result = await checkAndRecordVersion(db, '1.0.0', 1);
    assert.equal(result.isMajorUpgrade, true);
  });

  test('a downgrade is refused', async () => {
    await checkAndRecordVersion(db, '0.2.0', 1);
    const err = await checkAndRecordVersion(db, '0.1.0', 1)
      .then(() => null)
      .catch((e: VersionFenceError) => e);
    assert.ok(err instanceof VersionFenceError);
    assert.equal(err.code, 'downgrade');
    assert.match(err.message, /0\.2\.0/, 'the message must name the version to restore');
  });

  test('a development build following a pre-release is not a downgrade', () => {
    // This broke a running instance. Pre-release identifiers compare as
    // strings, so "0.1.0-dev.abc" sorts BEFORE "0.1.0-rc.1" — every build of
    // main after tagging a release candidate looked like a downgrade, the
    // server refused to start, and nothing answered at all. Not even
    // /api/version, so the only visible symptom was a blank page.
    //
    // The version the image workflow generates is `git describe` output, which
    // sorts after the tag it follows. This asserts that property directly,
    // because the workflow cannot be tested here but the ordering can.
    assert.ok(
      compareVersions('0.1.0-rc.1-7-g8ff137f', '0.1.0-rc.1') > 0,
      'a describe-style dev version must sort after its tag',
    );
    assert.ok(
      compareVersions('0.1.0-rc.1-7-g8ff137f', '0.1.0-rc.1-2-gabc1234') > 0,
      'more commits since the tag must sort later',
    );
    assert.ok(
      compareVersions('0.1.0', '0.1.0-rc.1-7-g8ff137f') > 0,
      'the release itself must still outrank builds leading up to it',
    );

    // And the shape that caused the outage is still correctly identified as
    // older, so the guard is not simply weakened.
    assert.ok(
      compareVersions('0.1.0-dev.89ecc20', '0.1.0-rc.1') < 0,
      'the old scheme really was a downgrade; the fence was right',
    );
  });

  test('SONE_ALLOW_DOWNGRADE permits a start and warns', async () => {
    // An operator whose version labels are misleading needs a way forward that
    // is not "restore a backup". Deliberate, loud, never a default.
    await checkAndRecordVersion(db, '0.2.0', SCHEMA_VERSION);

    const warnings: string[] = [];
    const result = await checkAndRecordVersion(db, '0.1.0', SCHEMA_VERSION, {
      allowDowngrade: true,
      log: (message) => warnings.push(message),
    });

    assert.ok(result, 'the start must be permitted');
    assert.equal(warnings.length, 1, 'exactly one warning');
    assert.match(warnings[0]!, /SONE_ALLOW_DOWNGRADE/);
    assert.match(warnings[0]!, /data may be lost/, 'must state the risk');
  });

  test('SONE_ALLOW_DOWNGRADE does not bypass the document format check', async () => {
    // That check is about whether the code can read the data, not about a
    // label, so no escape hatch applies to it.
    await checkAndRecordVersion(db, '0.1.0', SCHEMA_VERSION + 5);

    const err = await checkAndRecordVersion(db, '0.1.0', SCHEMA_VERSION, {
      allowDowngrade: true,
      log: () => {},
    })
      .then(() => null)
      .catch((e: unknown) => e);

    assert.ok(err instanceof VersionFenceError);
    assert.equal(err.code, 'schema_regression');
  });

  test('a build that cannot read existing documents is refused', async () => {
    await checkAndRecordVersion(db, '0.2.0', 3);
    const err = await checkAndRecordVersion(db, '0.3.0', 2)
      .then(() => null)
      .catch((e: VersionFenceError) => e);
    assert.ok(err instanceof VersionFenceError);
    assert.equal(err.code, 'schema_regression');
  });

  test('min_app_version refuses a version skip', async () => {
    await checkAndRecordVersion(db, '1.0.0', 1);
    await db.query(`UPDATE instance_meta SET min_app_version = '2.0.0'`);
    const err = await checkAndRecordVersion(db, '1.5.0', 1)
      .then(() => null)
      .catch((e: VersionFenceError) => e);
    assert.ok(err instanceof VersionFenceError);
    assert.equal(err.code, 'too_old');
  });

  test('the recorded document schema version never goes down', async () => {
    await checkAndRecordVersion(db, '0.1.0', 2);
    await checkAndRecordVersion(db, '0.2.0', 2);
    assert.equal((await readInstanceMeta(db))!.documentSchemaVersion, 2);
  });

  test('pending document migrations are reported per workspace', async () => {
    const fx = await seedWorkspace(db);
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'Old');
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.idx, 'a0');
    await withTransaction(db, (client) =>
      materializeYDoc(client, uuid(1), doc, {
        throughSeq: 1,
        workspaceId: fx.workspaceId,
      }),
    );

    const pending = await pendingDocumentMigrations(db, 2);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.schemaVersion, 1);
    assert.equal(pending[0]!.pages, 1);

    // Nothing pending when the current version matches.
    assert.deepEqual(await pendingDocumentMigrations(db, 1), []);
    doc.destroy();
  });
});

// --- backup round trip -----------------------------------------------------

describe('backup and restore (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let fx: Fixture;
  let workDir: string;

  before(async () => {
    db = await getTestPool();
    workDir = await mkdtemp(path.join(tmpdir(), 'sone-backup-test-'));
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    fx = await seedWorkspace(db);
  });

  /** The backup names its directory with a timestamp; find it. */
  async function findArchive(outputDir: string): Promise<string> {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(outputDir);
    const found = entries.find((e) => e.startsWith('sone-'));
    assert.ok(found, `no archive directory in ${outputDir}`);
    return path.join(outputDir, found);
  }

  /**
   * Create a page with one block.
   *
   * `blockId` is explicit because block ids are globally unique — blocks.id is
   * the primary key, not (page_id, id). A client copying a block to another
   * page must regenerate the id; the server refuses a collision rather than
   * silently reassigning it.
   */
  async function makePage(id: string, title: string, blockId: string): Promise<void> {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, title);
    page.set(PAGE_KEYS.idx, 'a0');
    appendBlocks(doc, [{ id: blockId, type: 'paragraph', text: 'content' }]);
    await withTransaction(db, (client) =>
      materializeYDoc(client, id, doc, { throughSeq: 1, workspaceId: fx.workspaceId }),
    );
    await appendUpdate(db, id, Y.encodeStateAsUpdate(doc), null);
    doc.destroy();
  }

  test('a backup records counts and checksums', async () => {
    await makePage(uuid(1), 'First', uuid(501));
    await makePage(uuid(2), 'Second', uuid(502));

    const out = path.join(workDir, 'counts');
    const manifest = await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      log: () => {},
    });

    assert.equal(manifest.backupFormatVersion, BACKUP_FORMAT_VERSION);
    assert.equal(manifest.counts.pages, 2);
    assert.equal(manifest.counts.documents, 2);
    assert.equal(manifest.counts.workspaces, 1);
    assert.match(manifest.database.sha256, /^[0-9a-f]{64}$/);
    assert.ok(manifest.database.bytes > 0);
  });

  test('a full round trip restores documents that still open', async () => {
    // The test that makes forward-only migrations defensible.
    await makePage(uuid(1), 'Survives the round trip', uuid(503));
    await makePage(uuid(2), 'Also survives', uuid(504));

    const out = path.join(workDir, 'roundtrip');
    const manifest = await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      log: () => {},
    });

    const dir = await findArchive(out);

    // Destroy everything, exactly as a disaster would.
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    const gone = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'`,
    );
    assert.equal(gone.rows[0]!.n, '0', 'the database must really be empty');

    const report = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: true,
      log: () => {},
    });
    assert.equal(report.manifest.counts.pages, manifest.counts.pages);

    const pages = await db.query<{ title: string }>(
      `SELECT title FROM pages ORDER BY title`,
    );
    assert.deepEqual(
      pages.rows.map((r) => r.title),
      ['Also survives', 'Survives the round trip'],
    );

    // The CRDT log is what actually matters: a restored projection is
    // worthless if the documents behind it did not come back.
    const loaded = await loadDoc(db, uuid(1));
    assert.equal(
      loaded.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title),
      'Survives the round trip',
    );
    assert.equal(readBlockTree(loaded.doc).blocks[0]?.text, 'content');
    loaded.doc.destroy();
  });

  test('a corrupted archive is refused before anything is touched', async () => {
    await makePage(uuid(1), 'Precious', uuid(505));

    const out = path.join(workDir, 'corrupt');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      log: () => {},
    });

    const dir = await findArchive(out);

    await writeFile(path.join(dir, 'database.dump'), 'truncated', 'utf8');

    const err = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: false,
      log: () => {},
    })
      .then(() => null)
      .catch((e: BackupError) => e);

    assert.ok(err instanceof BackupError);
    assert.equal(err.code, 'checksum_mismatch');

    // The existing data must be intact: refusing up front is the whole point.
    const pages = await db.query<{ title: string }>(`SELECT title FROM pages`);
    assert.equal(pages.rows[0]!.title, 'Precious');
  });

  test('a pg_dump older than the server gives an actionable error', async () => {
    // CI hit this for real: Debian bookworm ships client 15 while the service
    // container runs Postgres 17, and pg_dump refuses to dump a server newer
    // than itself. Its own message says "aborting because of server version
    // mismatch" and nothing about what to do, so the wording is mapped.
    //
    // Reproduced by putting an older pg_dump first on PATH. Skipped when no
    // older client is installed, since the point is the message rather than
    // the platform.
    const { existsSync } = await import('node:fs');
    const olderClient = ['/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/14/bin'].find(
      (dir) => existsSync(`${dir}/pg_dump`),
    );
    if (!olderClient) {
      // Nothing to test against on this machine.
      return;
    }

    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${olderClient}:${originalPath}`;
    try {
      const err = await createBackup({
        pool: db,
        databaseUrl: testDatabaseUrl(),
        outputDir: path.join(workDir, 'mismatch'),
        filesPath: null,
        appVersion: '0.1.0',
        documentSchemaVersion: SCHEMA_VERSION,
        log: () => {},
      })
        .then(() => null)
        .catch((e: BackupError) => e);

      assert.ok(err instanceof BackupError);
      assert.equal(err.code, 'version_mismatch');
      assert.match(err.message, /cannot dump a server newer than itself/);
      assert.match(err.message, /postgresql-client/, 'must name the fix');
      // Both versions are surfaced, so an operator does not have to run
      // pg_dump by hand to find out which is which.
      assert.match(err.message, /The server is .* but pg_dump is /);
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  test('an archive from a newer backup format is refused', async () => {
    const dir = path.join(workDir, 'future');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, MANIFEST_NAME),
      JSON.stringify({
        backupFormatVersion: BACKUP_FORMAT_VERSION + 1,
        database: { file: 'database.dump', bytes: 0, sha256: '' },
      }),
      'utf8',
    );

    const err = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      log: () => {},
    })
      .then(() => null)
      .catch((e: BackupError) => e);
    assert.ok(err instanceof BackupError);
    assert.equal(err.code, 'unknown_format');
  });

  test('restoring into a non-empty database is refused by default', async () => {
    await makePage(uuid(1), 'Existing', uuid(506));

    const out = path.join(workDir, 'nonempty');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      log: () => {},
    });
    const dir = await findArchive(out);

    const err = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: true,
      log: () => {},
    })
      .then(() => null)
      .catch((e: BackupError) => e);
    assert.ok(err instanceof BackupError);
    assert.equal(err.code, 'not_empty');
  });

  test('files are archived and restored', async () => {
    await makePage(uuid(1), 'With attachment', uuid(507));
    const filesDir = path.join(workDir, 'files-src');
    await mkdir(path.join(filesDir, 'ab'), { recursive: true });
    await writeFile(path.join(filesDir, 'ab', 'attachment.bin'), 'payload', 'utf8');

    const out = path.join(workDir, 'withfiles');
    const manifest = await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: filesDir,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      log: () => {},
    });
    assert.ok(manifest.files, 'files must be included');

    const dir = await findArchive(out);

    const restoreTarget = path.join(workDir, 'files-restored');
    const report = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: restoreTarget,
      requireEmpty: false,
      log: () => {},
    });
    assert.equal(report.restoredFiles, true);
    assert.equal(
      await readFile(path.join(restoreTarget, 'ab', 'attachment.bin'), 'utf8'),
      'payload',
    );
  });

  test('a backup without files warns on restore rather than failing silently', async () => {
    await makePage(uuid(1), 'No files', uuid(508));
    const out = path.join(workDir, 'nofiles');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      log: () => {},
    });
    const dir = await findArchive(out);

    const report = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: path.join(workDir, 'target'),
      requireEmpty: false,
      log: () => {},
    });
    assert.ok(
      report.warnings.some((w) => w.includes('no files')),
      'the operator must be told attachments are not in the archive',
    );
  });
});

// --- the migration runner --------------------------------------------------

describe(
  'migration runner (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    test('a migration that does not record itself is recorded by the runner', async () => {
      // This is the failure that stopped a deployed instance booting. 0007
      // applied its changes and never inserted its schema_migrations row, so
      // every restart retried it and failed on "column kind already exists".
      // Nothing answered, and the visible symptom was a blank page.
      //
      // The convention is that each file records itself, and it has no
      // enforcement — so the runner no longer depends on every file
      // remembering.
      const db = await getTestPool();
      const { mkdtemp, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { migrate } = await import('../src/db/migrate.js');

      const dir = await mkdtemp(path.join(tmpdir(), 'sone-migrations-'));

      // A minimal first migration that does create the bookkeeping table,
      // because the runner needs somewhere to record.
      await writeFile(
        path.join(dir, '0001_base.sql'),
        `BEGIN;
         CREATE TABLE IF NOT EXISTS schema_migrations (
           version text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         );
         INSERT INTO schema_migrations (version) VALUES ('0001_base')
           ON CONFLICT (version) DO NOTHING;
         COMMIT;`,
        'utf8',
      );

      // And one that forgets, exactly as 0007 did.
      await writeFile(
        path.join(dir, '0002_forgetful.sql'),
        `CREATE TABLE runner_probe (id integer);`,
        'utf8',
      );

      const messages: string[] = [];
      const first = await migrate(db, dir, (m) => messages.push(m));
      assert.deepEqual(first.applied, ['0001_base', '0002_forgetful']);
      assert.ok(
        messages.some((m) => m.includes('did not record itself')),
        'the omission must be reported, not silently patched',
      );

      // The second run is the one that used to fail: without a recorded row the
      // runner retries, and CREATE TABLE errors on a table that exists.
      const second = await migrate(db, dir, () => {});
      assert.deepEqual(second.applied, [], 'nothing left to apply');
      assert.ok(second.skipped.includes('0002_forgetful'));

      await db.query(`DROP TABLE IF EXISTS runner_probe`);
    });
  },
);
