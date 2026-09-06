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
  secretKeyFingerprint,
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
    // A fixed client id, so two documents built the same way encode the same
    // bytes. Yjs puts the client id in every update, so without this the
    // determinism check below compares two random numbers and fails the moment
    // the chain stops being empty — which is what happened when it did.
    const doc = new Y.Doc({ guid: 'fixture' });
    doc.clientID = 1;
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
  /*
   * Two keys, both plausible (ADR-0105).
   *
   * Long enough that `loadConfig` would accept either — the point is two valid
   * keys, not a valid one and a broken one.
   */
  const KEY_A = 'first-instance-secret-key-of-sufficient-length-aaaa';
  const KEY_B = 'second-instance-secret-key-of-sufficient-length-bbb';

  const fingerprintOf = (secret: string): string => secretKeyFingerprint(secret);

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
      secretKey: KEY_A,
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
      secretKey: KEY_A,
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
      secretKey: KEY_A,
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
      secretKey: KEY_A,
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
      secretKey: KEY_A,
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

  // --- the key the archive was sealed under (ADR-0105) ---------------------

  /**
   * Everything `SONE_SECRET_KEY` seals, sealed.
   *
   * A share token is the cheapest of the three to prove — `decryptShareToken`
   * answers `null` for a wrong key, which is the silence this whole section is
   * about. TOTP secrets and mail reply tokens fail the same way and are not
   * repeated here.
   */
  async function sealShareToken(secret: string): Promise<Buffer> {
    const { encryptShareToken } = await import('../src/auth/shareTokenStore.js');
    return encryptShareToken('a-share-token-worth-keeping', secret);
  }

  test('a wrong key loses what was sealed, and says nothing at all', async () => {
    /*
     * The damage, first, because the refusal below is only worth having if this
     * is true.
     *
     * `decryptShareToken` returns `null` rather than throwing, on purpose: a
     * stored value that will not decrypt is a link that does not resolve. With
     * the right key it is a token; with the wrong one it is indistinguishable
     * from a link that was never made — no error, no log line, nothing to
     * diagnose. A restore under the wrong key does this to every share link,
     * every second factor and every mail reply token, one account at a time.
     */
    const { decryptShareToken } = await import('../src/auth/shareTokenStore.js');
    const sealed = await sealShareToken(KEY_A);

    assert.equal(decryptShareToken(sealed, KEY_A), 'a-share-token-worth-keeping');
    assert.equal(decryptShareToken(sealed, KEY_B), null, 'and not a word about it');
  });

  test('a backup records which key sealed it', async () => {
    await makePage(uuid(1), 'Sealed', uuid(511));

    const manifest = await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: path.join(workDir, 'fingerprint'),
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      secretKey: KEY_A,
      log: () => {},
    });

    assert.match(manifest.secretKeyFingerprint ?? '', /^[0-9a-f]{64}$/);
    assert.notEqual(
      manifest.secretKeyFingerprint,
      fingerprintOf(KEY_B),
      'and a different key gives a different one',
    );
    assert.ok(
      !JSON.stringify(manifest).includes(KEY_A),
      'the key itself is nowhere in the archive',
    );
  });

  test('restoring under a different key is refused, and the message says what breaks', async () => {
    await makePage(uuid(1), 'Sealed', uuid(512));

    const out = path.join(workDir, 'wrongkey');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      secretKey: KEY_A,
      log: () => {},
    });
    const dir = await findArchive(out);

    const err = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: false,
      secretKey: KEY_B,
      log: () => {},
    })
      .then(() => null)
      .catch((e: BackupError) => e);

    assert.ok(err instanceof BackupError);
    assert.equal(err.code, 'key_mismatch');
    // Named, because the operator who sees this is the one who can still go and
    // find the old key — and in five minutes they will not remember which of
    // the three things stopped working.
    assert.match(err.message, /share link/i);
    assert.match(err.message, /second factor/i);
    assert.match(err.message, /SONE_SECRET_KEY/);

    // And nothing was touched, like every other refusal in this file.
    const pages = await db.query<{ title: string }>(`SELECT title FROM pages`);
    assert.equal(pages.rows[0]!.title, 'Sealed');
  });

  test('the right key restores without a word about it', async () => {
    // The counterweight. A check that fires on the ordinary case is a check
    // somebody turns off.
    await makePage(uuid(1), 'Sealed', uuid(513));

    const out = path.join(workDir, 'rightkey');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      secretKey: KEY_A,
      log: () => {},
    });
    const dir = await findArchive(out);
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

    const report = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: true,
      secretKey: KEY_A,
      log: () => {},
    });

    assert.deepEqual(
      report.warnings.filter((one) => /key/i.test(one)),
      [],
      'nothing to say when the key matches',
    );
  });

  test('a deliberate rotation is possible, and warns rather than passing quietly', async () => {
    /*
     * The case the refusal must not make impossible: the old key leaked, or is
     * gone, and somebody is restoring anyway, knowing what it costs.
     *
     * A flag of its own rather than reusing `--force`, which exists for the
     * empty-database check and whose message is careful to say what it does
     * *not* do. Two different risks answered by one flag is one flag people
     * pass without reading either.
     */
    await makePage(uuid(1), 'Sealed', uuid(514));

    const out = path.join(workDir, 'rotate');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      secretKey: KEY_A,
      log: () => {},
    });
    const dir = await findArchive(out);
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

    const report = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: true,
      secretKey: KEY_B,
      allowDifferentKey: true,
      log: () => {},
    });

    assert.ok(
      report.warnings.some((one) => /key/i.test(one)),
      'it happened, and it is in the report',
    );
    const pages = await db.query<{ title: string }>(`SELECT title FROM pages`);
    assert.equal(pages.rows[0]!.title, 'Sealed', 'and the restore went through');
  });

  test('an archive from before this field still restores, and says it could not check', async () => {
    /*
     * `secretKeyFingerprint` is optional for the same reason `fileStorage` is:
     * an archive written by an older build has none, and refusing it would turn
     * a missing check into a lost backup.
     *
     * It warns rather than passing silently — "not checked" and "checked and
     * fine" are different answers, which is the argument `fileStorage` itself
     * was added for.
     */
    await makePage(uuid(1), 'Old archive', uuid(515));

    const out = path.join(workDir, 'nofingerprint');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      secretKey: KEY_A,
      log: () => {},
    });
    const dir = await findArchive(out);

    // Rewritten as an older build would have written it.
    const manifestPath = path.join(dir, MANIFEST_NAME);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest['secretKeyFingerprint'];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    const report = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: true,
      secretKey: KEY_B,
      log: () => {},
    });

    assert.ok(
      report.warnings.some((one) => /key/i.test(one)),
      'the absence of the check is itself reported',
    );
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
        secretKey: KEY_A,
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
      secretKey: KEY_A,
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
      secretKey: KEY_A,
      log: () => {},
    });
    const dir = await findArchive(out);

    const err = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: null,
      requireEmpty: true,
      secretKey: KEY_A,
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
      secretKey: KEY_A,
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
      secretKey: KEY_A,
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
      secretKey: KEY_A,
      log: () => {},
    });
    const dir = await findArchive(out);

    const report = await restoreBackup({
      pool: db,
      archiveDir: dir,
      databaseUrl: testDatabaseUrl(),
      filesPath: path.join(workDir, 'target'),
      requireEmpty: false,
      secretKey: KEY_A,
      log: () => {},
    });
    /*
     * The intent is unchanged — the operator must be told attachments are not
     * in the archive — and the wording is not: `filesPath: null` means S3, and
     * the warning now says so instead of "archive contains no files. If the
     * source used S3 storage…", which was addressed to everybody and accurate
     * for one of them (ADR-0079).
     */
    assert.ok(
      report.warnings.some((w) => /S3/.test(w) && /not in this archive/.test(w)),
      'the operator must be told attachments are not in the archive, and why',
    );
    assert.ok(
      report.warnings.some((w) => /backup of its own/.test(w)),
      'and that the bucket is a backup problem of its own',
    );
  });

  test('an instance with an empty file directory is not told to find a bucket', async () => {
    // The other half of the same warning. A local instance that simply has no
    // attachments yet used to be sent looking for an S3 configuration it never
    // had.
    await makePage(uuid(1), 'Local, empty', uuid(509));
    const out = path.join(workDir, 'localempty');
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      // A path that does not exist: nothing has ever been uploaded.
      filesPath: path.join(workDir, 'never-created'),
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      secretKey: KEY_A,
      log: () => {},
    });

    const report = await restoreBackup({
      pool: db,
      archiveDir: await findArchive(out),
      databaseUrl: testDatabaseUrl(),
      filesPath: path.join(workDir, 'target'),
      requireEmpty: false,
      secretKey: KEY_A,
      log: () => {},
    });
    assert.ok(
      report.warnings.some((w) => /no attachments/.test(w)),
      'said plainly',
    );
    assert.ok(!report.warnings.some((w) => /S3/.test(w)), 'and no bucket is mentioned');
  });

  test('a file directory that cannot be read refuses the backup', async () => {
    /*
     * "Not there" and "cannot look" used to be one `.catch(() => null)`, so a
     * volume that failed to mount produced a cheerful backup with no
     * attachments in it and no indication that any were missing.
     */
    /*
     * ENOTDIR, not EACCES. The obvious version of this test chmods a directory
     * to 000 — and passes only where the suite is not running as root, which is
     * exactly where CI runs it. A path whose parent is a regular file is the
     * same class of answer from `stat` ("I cannot look there"), it is a
     * misconfiguration somebody really does make, and no user can walk past it.
     */
    const notADirectory = path.join(workDir, 'a-file');
    await writeFile(notADirectory, 'kein Verzeichnis');

    await assert.rejects(
      createBackup({
        pool: db,
        databaseUrl: testDatabaseUrl(),
        outputDir: path.join(workDir, 'refused'),
        filesPath: path.join(notADirectory, 'files'),
        appVersion: '0.1.0',
        documentSchemaVersion: SCHEMA_VERSION,
        secretKey: KEY_A,
        log: () => {},
      }),
      (err: unknown) =>
        err instanceof BackupError && /silently omit attachments/.test(err.message),
    );
  });

  test('a backup interrupted before its manifest is not mistaken for one', async () => {
    /*
     * The archive is built under a `.incomplete` name and renamed once the
     * manifest is in it, so a killed backup leaves something visibly unusable
     * rather than a directory that looks like an archive and fails at the
     * moment it is needed — with a raw ENOENT naming a JSON file (ADR-0079).
     */
    const half = path.join(workDir, 'sone-2026-01-01.incomplete');
    await mkdir(half, { recursive: true });
    await writeFile(path.join(half, 'database.dump'), 'nicht fertig');

    await assert.rejects(
      restoreBackup({
        pool: db,
        archiveDir: half,
        databaseUrl: testDatabaseUrl(),
        filesPath: null,
        requireEmpty: false,
        secretKey: KEY_A,
        log: () => {},
      }),
      (err: unknown) =>
        err instanceof BackupError &&
        err.code === 'unknown_format' &&
        /interrupted before it finished/.test(err.message),
    );
  });

  test('a failed restore leaves the database as it was', async () => {
    /*
     * `--single-transaction`. pg_restore does exit non-zero when it ignores
     * errors — checked against pg_restore 16 rather than assumed — so this was
     * never a silent failure. It was a *partial* one: the throw arrived after
     * half the objects had been dropped and recreated.
     *
     * A dump the restore cannot apply, over a database with something in it:
     * afterwards the something must still be there.
     */
    const out = path.join(workDir, 'rollback');
    await makePage(uuid(1), 'Vor dem Versuch', uuid(510));
    await createBackup({
      pool: db,
      databaseUrl: testDatabaseUrl(),
      outputDir: out,
      filesPath: null,
      appVersion: '0.1.0',
      documentSchemaVersion: SCHEMA_VERSION,
      secretKey: KEY_A,
      log: () => {},
    });
    const dir = await findArchive(out);

    // A view on a table the restore drops. pg_restore's DROP fails on the
    // dependency, which is an error it would otherwise carry on past.
    await db.query(`CREATE VIEW restore_blocker AS SELECT id FROM pages`);
    const manifest = JSON.parse(
      await readFile(path.join(dir, MANIFEST_NAME), 'utf8'),
    ) as { database: { file: string } };

    await assert.rejects(
      restoreBackup({
        pool: db,
        archiveDir: dir,
        databaseUrl: testDatabaseUrl(),
        filesPath: null,
        requireEmpty: false,
        secretKey: KEY_A,
        log: () => {},
      }),
      (err: unknown) => err instanceof BackupError && err.code === 'pg_restore_failed',
    );
    assert.ok(manifest.database.file, 'the archive itself was fine');

    // The point: the page is still there, rather than the database being
    // halfway between two states.
    const still = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pages WHERE id = $1`,
      [uuid(1)],
    );
    assert.equal(still.rows[0]!.n, '1', 'the previous state survived the failure');

    await db.query(`DROP VIEW IF EXISTS restore_blocker`);
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
