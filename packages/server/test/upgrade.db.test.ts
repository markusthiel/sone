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
  documentSchemaVersion,
  isClientSchemaCompatible,
  migrateDocument,
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
  TEST_DATABASE_URL,
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
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

  async function makePage(id: string, title: string): Promise<void> {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, title);
    page.set(PAGE_KEYS.idx, 'a0');
    doc.getMap(DOC_KEYS.blocks).set('b1', 'content');
    await withTransaction(db, (client) =>
      materializeYDoc(client, id, doc, { throughSeq: 1, workspaceId: fx.workspaceId }),
    );
    await appendUpdate(db, id, Y.encodeStateAsUpdate(doc), null);
    doc.destroy();
  }

  test('a backup records counts and checksums', async () => {
    await makePage(uuid(1), 'First');
    await makePage(uuid(2), 'Second');

    const out = path.join(workDir, 'counts');
    const manifest = await createBackup({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
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
    await makePage(uuid(1), 'Survives the round trip');
    await makePage(uuid(2), 'Also survives');

    const out = path.join(workDir, 'roundtrip');
    const manifest = await createBackup({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
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
      databaseUrl: TEST_DATABASE_URL!,
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
    assert.equal(loaded.doc.getMap(DOC_KEYS.blocks).get('b1'), 'content');
    loaded.doc.destroy();
  });

  test('a corrupted archive is refused before anything is touched', async () => {
    await makePage(uuid(1), 'Precious');

    const out = path.join(workDir, 'corrupt');
    await createBackup({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
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
      databaseUrl: TEST_DATABASE_URL!,
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
      databaseUrl: TEST_DATABASE_URL!,
      filesPath: null,
      log: () => {},
    })
      .then(() => null)
      .catch((e: BackupError) => e);
    assert.ok(err instanceof BackupError);
    assert.equal(err.code, 'unknown_format');
  });

  test('restoring into a non-empty database is refused by default', async () => {
    await makePage(uuid(1), 'Existing');

    const out = path.join(workDir, 'nonempty');
    await createBackup({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
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
      databaseUrl: TEST_DATABASE_URL!,
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
    await makePage(uuid(1), 'With attachment');
    const filesDir = path.join(workDir, 'files-src');
    await mkdir(path.join(filesDir, 'ab'), { recursive: true });
    await writeFile(path.join(filesDir, 'ab', 'attachment.bin'), 'payload', 'utf8');

    const out = path.join(workDir, 'withfiles');
    const manifest = await createBackup({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
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
      databaseUrl: TEST_DATABASE_URL!,
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
    await makePage(uuid(1), 'No files');
    const out = path.join(workDir, 'nofiles');
    await createBackup({
      pool: db,
      databaseUrl: TEST_DATABASE_URL!,
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
      databaseUrl: TEST_DATABASE_URL!,
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
