/**
 * Bytes belonging to no row (ADR-0109).
 *
 * The last item on `claude/durchgang-nie-gelaufen.md`. ADR-0080 named it:
 * purging a deleted workspace removes the `files` rows by cascade and leaves
 * every attachment on the disk, permanently. ADR-0106 did the same job for CRDT
 * documents; this is the other half.
 *
 * ## The trap here is not the one the schema warned about
 *
 * `db/migrations/0025` says, about a sweep that has never existed:
 *
 * > Checked by the orphan sweep: a row with variant_of set is reachable through
 * > its original and must not be collected on its own.
 *
 * That describes a sweep over **rows** — files no block refers to. This is a
 * sweep over **bytes**: objects in storage that no row names. A variant has a
 * row of its own, so it is safe here for a reason that has nothing to do with
 * that comment.
 *
 * ## What it actually has to know
 *
 * Four places hold a storage key, and missing any one deletes live data:
 *
 *   files.storage_key       attachments
 *   users.avatar_key        profile pictures — **not in the files table at all**
 *   jobs.result->>'key'     a workspace export waiting to be downloaded
 *   instance_settings       the instance's own logo (ADR-0123)
 *
 * The avatar is the one the code points at: `files/routes.ts` says a replaced
 * picture is "left in storage for the orphan sweep rather than deleted here".
 * A sweep that read only `files` would collect every avatar on the instance.
 *
 * So most of what is asserted here is what the sweep must **not** take.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { LocalFileStore } from '../src/files/store.js';
import { sweepOrphanFiles } from '../src/files/sweepOrphanFiles.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

/** A key of the shape the store produces: two hex, slash, sixty-two hex. */
const keyFor = (seed: string): string => {
  const hex = seed.repeat(64).slice(0, 64);
  return `${hex.slice(0, 2)}/${hex.slice(2)}.bin`;
};

describe(
  'files belonging to no row (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let root: string;
    let store: LocalFileStore;

    const PAGE = uuid(1);

    before(async () => {
      db = await getTestPool();
    });

    after(async () => {
      await closeTestPool();
      await rm(root, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         VALUES ($1,$2,'A page','a0','page')`,
        [PAGE, fx.workspaceId],
      );
      await rm(root ?? '', { recursive: true, force: true }).catch(() => {});
      root = await mkdtemp(path.join(tmpdir(), 'sone-sweep-'));
      store = new LocalFileStore(root);
    });

    // --- what it names -------------------------------------------------------

    test('an attachment whose row is gone is named, and taken', async () => {
      const kept = await stored('a', '30 days');
      const left = await stored('b', '30 days');
      await rowFor(kept);

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1 });
      assert.deepEqual(report.sample, [left]);
      assert.equal(report.files, 1);

      await sweepOrphanFiles(db, store, { olderThanHours: 1, apply: true });
      assert.deepEqual(await onDisk(), [kept]);
    });

    // --- what it must not take ----------------------------------------------

    test('an avatar is not an orphan, though no files row names it', async () => {
      /*
       * The one the code points straight at. `files/routes.ts`:
       *
       *   The previous one is left in storage for the orphan sweep rather than
       *   deleted here. Content-addressed keys mean two people with the same
       *   picture share one file, and deleting on replace would take the other
       *   person's.
       *
       * `users.avatar_key` is not in the `files` table. A sweep reading only
       * that table would collect every profile picture on the instance — and
       * the comment above is what invited it to.
       */
      const face = await stored('c', '30 days');
      await db.query(`UPDATE users SET avatar_key = $2, avatar_mime = 'image/png' WHERE id = $1`, [
        fx.userId,
        face,
      ]);

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1 });
      assert.deepEqual(report.sample, [], 'the avatar is live');
    });

    test('a workspace export waiting to be downloaded is not an orphan', async () => {
      /*
       * The third holder, and the one inside JSON: an export archive's key
       * lives in `jobs.result->>'key'` rather than in a column of its own —
       * "an archive is a file, and a bytea column holding a workspace is a
       * backup nobody chose to take".
       *
       * The maintenance job deletes these when they expire. Until then they are
       * somebody's download.
       */
      const archive = await stored('d', '30 days');
      await db.query(
        `INSERT INTO jobs (kind, workspace_id, created_by, state, payload, result)
         VALUES ('workspace_export', $1, $2, 'done', '{}'::jsonb, $3::jsonb)`,
        [fx.workspaceId, fx.userId, JSON.stringify({ key: archive, bytes: 10 })],
      );

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1 });
      assert.deepEqual(report.sample, []);
    });

    test('the instance’s own logo is not an orphan either', async () => {
      /*
       * The fourth place, and the newest — which is exactly the shape this file
       * warns about. A logo belongs to no workspace and no page, so it is a key
       * on a setting rather than a `files` row (ADR-0123), and a sweep that did
       * not learn about it would take the mark off the sign-in screen of an
       * instance nobody had touched, a week after it was uploaded.
       */
      const mark = await stored('f', '30 days');
      await db.query(
        `INSERT INTO instance_settings (key, value) VALUES ('brandLogo', $1::jsonb)`,
        [JSON.stringify({ key: mark, mime: 'image/png' })],
      );

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1 });
      assert.deepEqual(report.sample, [], 'the logo is live');
    });

    test('a file two rows share survives losing one of them', async () => {
      /*
       * Content-addressed storage: the key is the hash, so the same picture on
       * two pages is one file with two rows. A sweep that decided per row would
       * delete the bytes the other row still needs — which is the same mistake
       * the avatar comment describes being avoided on replace.
       */
      const shared = await stored('e', '30 days');
      const first = await rowFor(shared);
      await rowFor(shared);

      await db.query(`DELETE FROM files WHERE id = $1`, [first]);

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1 });
      assert.deepEqual(report.sample, [], 'one row is enough to keep it');
    });

    test('a web variant is safe, and not for the reason the schema says', async () => {
      /*
       * `db/migrations/0025` warns a sweep off variants: "a row with variant_of
       * set is reachable through its original and must not be collected on its
       * own". That is about a sweep over rows, which is not this one.
       *
       * A variant has a `files` row and its own `storage_key`, so it is live
       * here for exactly the same reason as any other row. Asserted because the
       * comment made a promise about a mechanism, and this is the mechanism
       * that turned up.
       */
      const original = await stored('f', '30 days');
      const web = await stored('0', '30 days');
      const originalId = await rowFor(original);
      await db.query(
        `INSERT INTO files (workspace_id, page_id, filename, mime_type, size_bytes,
                            sha256, storage, storage_key, variant, variant_of)
         VALUES ($1,$2,'web.png','image/png',10,'\\x00','local',$3,'web',$4)`,
        [fx.workspaceId, PAGE, web, originalId],
      );

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1 });
      assert.deepEqual(report.sample, []);
    });

    test('a file written a moment ago is out of reach', async () => {
      /*
       * The upload window, and it is the same shape as `createEntry`'s
       * (ADR-0106): `store.put` happens *before* the `INSERT INTO files`, so
       * between them a live upload has bytes and no row.
       */
      /*
       * Two seconds, not zero.
       *
       * It was written with the current time, and the comparison is
       * `modifiedAt < now - grace`: with no grace those are the same
       * millisecond whenever the walk between them is quick enough, and the
       * file is then not a candidate. It failed once in a loaded full run,
       * which is exactly how often a knife-edge like that fails — and a test
       * that fails one run in fifty is one people learn to re-run rather than
       * read. Two seconds is still far inside the window a real grace hides.
       */
      const arriving = await stored('9', '2 seconds');

      // Zero grace, which is the setting nobody should use and the one that
      // makes the window visible: the file is there, and only the age hides it.
      const seen = await sweepOrphanFiles(db, store, { olderThanHours: 0 });
      assert.deepEqual(seen.sample, [arriving], 'with no grace at all it is a candidate');

      const swept = await sweepOrphanFiles(db, store, { olderThanHours: 24 });
      assert.deepEqual(swept.sample, [], 'and not for a real one');
    });

    test('anything that is not a storage key is left alone', async () => {
      /*
       * The store's own `KEY_PATTERN` decides what belongs to it. A lost+found,
       * a stray `.DS_Store`, a directory somebody mounted underneath — none of
       * it was written by this store, and a sweep that removed it would be
       * deleting somebody else's file from a directory it does not own.
       */
      await mkdir(path.join(root, 'zz'), { recursive: true });
      await writeFile(path.join(root, 'zz', 'notes.txt'), 'mine', 'utf8');
      await writeFile(path.join(root, 'README'), 'mine', 'utf8');

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1, apply: true });
      assert.equal(report.files, 0);
      assert.ok((await readdir(path.join(root, 'zz'))).includes('notes.txt'));
    });

    // --- the shape of the sweep ---------------------------------------------

    test('reporting is the default, and it removes nothing', async () => {
      const left = await stored('1', '30 days');

      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1 });
      assert.equal(report.applied, false);
      assert.equal(report.files, 1);
      assert.ok(report.bytes > 0);
      assert.deepEqual(await onDisk(), [left], 'still there');
    });

    test('the maintenance report counts them, and removes nothing', async () => {
      /*
       * The same split as the documents (ADR-0106): the job **reports**, a
       * script **removes**. A task that deletes somebody's attachments every
       * five minutes while nobody is looking is the wrong home for it, however
       * careful the query.
       */
      await stored('2', '30 days');
      const { Maintenance } = await import('../src/maintenance/job.js');
      const job = new Maintenance({ pool: db, store, log: () => {} } as never);
      const report = await job.runOnce();

      assert.equal(report.orphanedFiles, 1);
      assert.equal((await onDisk()).length, 1, 'and it swept nothing');
    });

    test('and says it did not look when there is no store', async () => {
      /*
       * `null`, not `0`. "Did not look" and "looked and found none" are
       * different answers — the distinction `fileStorage` was added for in
       * ADR-0079 and the one ADR-0107 found being got wrong.
       */
      const { Maintenance } = await import('../src/maintenance/job.js');
      const job = new Maintenance({ pool: db, log: () => {} } as never);
      const report = await job.runOnce();

      assert.equal(report.orphanedFiles, null);
    });

    test('nothing to do is not an error', async () => {
      const report = await sweepOrphanFiles(db, store, { olderThanHours: 1, apply: true });
      assert.equal(report.files, 0);
      assert.deepEqual(report.sample, []);
    });

    // --- helpers -------------------------------------------------------------

    /** Put bytes in the store by hand, aged, without a row. */
    async function stored(seed: string, age: string): Promise<string> {
      const key = keyFor(seed);
      const target = path.join(root, key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `bytes-${seed}`, 'utf8');

      // "<n> seconds" or "<n> days", so a fixture can sit just inside a window
      // as well as far outside one.
      const amount = Number(age.split(' ')[0]);
      const seconds = age.endsWith('seconds') ? amount : amount * 86_400;
      const when = new Date(Date.now() - seconds * 1000);
      await utimes(target, when, when);
      return key;
    }

    /** A `files` row naming a key. Returns its id. */
    async function rowFor(key: string): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO files (workspace_id, page_id, filename, mime_type, size_bytes,
                            sha256, storage, storage_key)
         VALUES ($1,$2,'thing.bin','application/octet-stream',10,'\\x00','local',$3)
         RETURNING id`,
        [fx.workspaceId, PAGE, key],
      );
      return row.rows[0]!.id;
    }

    /** Every storage key still on disk. */
    async function onDisk(): Promise<string[]> {
      const keys: string[] = [];
      for (const dir of await readdir(root)) {
        const inner = await readdir(path.join(root, dir)).catch(() => []);
        for (const name of inner) keys.push(`${dir}/${name}`);
      }
      return keys.sort();
    }
  },
);
