/**
 * The maintenance pass, and the ten tasks in it.
 *
 * This file was named for the job and tested **one** of its tasks (ADR-0111).
 * That is worse than a file named for the task would have been: `maintenance`
 * on the tin is what stopped anybody asking where the other nine were, and the
 * answer turned out to be three different things — covered elsewhere at the
 * function level, covered nowhere, and covered by a call that returns on its
 * first line because no test ever passed a `sync`.
 *
 * So there are two halves below. The original one, retrying failed projections:
 * `attempts` had been counted since the first migration and nothing ever read
 * it, so a page whose document the projection could not read stayed failed
 * until somebody ran a script. It still synced and still opened — it was simply
 * missing from search and from the tree, which is the kind of failure nobody
 * notices until they go looking for something.
 *
 * And a second half that runs **the pass**, with a fixture that gives every
 * task something to do, and reads the whole report. A count that reaches the
 * report is a count somebody can act on; a count that stops at the function is
 * a number in a test.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';
import * as Y from 'yjs';

import { DOC_KEYS, META_KEYS, PAGE_KEYS } from '@sone/core';

import { withTransaction } from '../src/db/pool.js';
import { appendUpdate } from '../src/doc/docStore.js';
import { listVersions } from '../src/doc/versions.js';
import { LocalFileStore } from '../src/files/store.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { pruneShareSessions } from '../src/auth/share.js';
import { JOB_RESULT_HOURS } from '../src/jobs/runner.js';
import {
  MAX_PROJECTION_ATTEMPTS,
  Maintenance,
  QUIET_MINUTES,
  retryDelayMs,
  retryFailedProjections,
  versionQuietDocuments,
} from '../src/maintenance/job.js';
import {
  addMember,
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

describe('retry backoff', () => {
  test('the delay grows and then stops growing', () => {
    // A transient failure — a lock, a dependency still starting — clears on the
    // first retry. A real one should not be hammered every five minutes.
    assert.equal(retryDelayMs(1), 60_000);
    assert.equal(retryDelayMs(2), 120_000);
    assert.ok(retryDelayMs(3) > retryDelayMs(2));
    assert.equal(retryDelayMs(20), 60 * 60_000, 'capped at an hour');
  });

  test('a zeroth attempt does not produce a negative delay', () => {
    assert.ok(retryDelayMs(0) > 0);
  });

  test(
    'the database computes the same curve this function describes',
    { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
    async () => {
      /*
       * The two tests above proved a function with **no callers** (ADR-0080).
       *
       * The backoff that actually runs is an SQL expression inside
       * `retryFailedProjections`, written there so the database does the
       * filtering rather than fetching every failure and discarding most of
       * them. `retryDelayMs` is the readable statement of the same rule — and
       * for as long as both existed, the suite checked the copy nobody runs.
       *
       * Two implementations of one rule is the arrangement this project keeps
       * finding (ADR-0077, ADR-0078). Deleting the function would leave the SQL
       * unchecked; keeping it as a specification and binding the two together
       * is the version where a divergence fails a test.
       */
      const pool = await getTestPool();
      const { rows } = await pool.query<{ attempts: number; minutes: string }>(
        `SELECT a AS attempts,
                least(power(2, greatest(a - 1, 0)), 60)::text AS minutes
           FROM generate_series(0, 12) AS a`,
      );

      for (const row of rows) {
        assert.equal(
          Number(row.minutes) * 60_000,
          retryDelayMs(row.attempts),
          `attempt ${row.attempts}: the query and the function disagree`,
        );
      }
    },
  );
});

describe(
  'maintenance (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
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

    /** A page with a failed projection, aged so it is due for a retry. */
    async function failedPage(attempts: number, ageMinutes = 600): Promise<string> {
      const workspace = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name) VALUES ('W') RETURNING id`,
      );
      const page = await db.query<{ id: string }>(
        `INSERT INTO pages (id, workspace_id, title, idx, kind, ancestor_ids)
         VALUES (gen_random_uuid(), $1, 'Broken', 'a0', 'page', '{}') RETURNING id`,
        [workspace.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO materialization_state (page_id, status, attempts, last_error, materialized_at)
         VALUES ($1, 'failed', $2, 'something went wrong', now() - ($3 || ' minutes')::interval)`,
        [page.rows[0]!.id, attempts, String(ageMinutes)],
      );
      return page.rows[0]!.id;
    }

    test('a failed projection is retried', async () => {
      const pageId = await failedPage(1);
      const result = await retryFailedProjections(db);
      assert.equal(result.retried, 1, `expected a retry for ${pageId}`);
    });

    test('a recent failure is left alone until its delay has passed', async () => {
      // Retrying immediately would turn one bad document into a busy loop.
      await failedPage(3, 0);
      const result = await retryFailedProjections(db);
      assert.equal(result.retried, 0);
    });

    test('a failure that has exhausted its attempts is not retried again', async () => {
      // A document that cannot be read is usually a bug rather than a hiccup,
      // and retrying it forever fills the log with one message and hides
      // everything else.
      await failedPage(MAX_PROJECTION_ATTEMPTS);
      const result = await retryFailedProjections(db);
      assert.equal(result.retried, 0);
      assert.equal(result.abandoned, 1, 'and it is counted so somebody is told');
    });

    test('one unreadable document does not stop the batch', async () => {
      // The whole point of retrying in a loop.
      const ids = [await failedPage(1), await failedPage(1), await failedPage(1)];
      const result = await retryFailedProjections(db);
      assert.equal(result.retried, ids.length);
    });

    test('the batch is bounded', async () => {
      for (let i = 0; i < 5; i++) await failedPage(1);
      const result = await retryFailedProjections(db, 2);
      assert.equal(result.retried, 2);
    });

    test('a healthy projection is never touched', async () => {
      const workspace = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name) VALUES ('W') RETURNING id`,
      );
      const page = await db.query<{ id: string }>(
        `INSERT INTO pages (id, workspace_id, title, idx, kind, ancestor_ids)
         VALUES (gen_random_uuid(), $1, 'Fine', 'a0', 'page', '{}') RETURNING id`,
        [workspace.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO materialization_state (page_id, status, materialized_at)
         VALUES ($1, 'ok', now() - interval '10 hours')`,
        [page.rows[0]!.id],
      );

      const result = await retryFailedProjections(db);
      assert.equal(result.retried, 0);
    });
  },
);

describe(
  'the pass itself (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let root: string;
    let store: LocalFileStore;

    /** A page with one quiet update, for the versioning task. */
    const QUIET = uuid(11);
    /** A page with a backlog over the threshold, for compaction. */
    const BUSY = uuid(12);
    /** A page whose projection failed and can be read again, for the retry. */
    const HEALING = uuid(13);
    /** A page whose parent does not exist. */
    const ORPHAN = uuid(14);
    /** A page whose parent is a page rather than a folder. */
    const MISPLACED = uuid(15);
    /** A document whose page is gone. */
    const STRAY = uuid(16);

    /** How many connections the stub sync claims to hold. */
    const CONNECTIONS = 3;
    let revalidated = 0;

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
      revalidated = 0;
      await rm(root ?? '', { recursive: true, force: true }).catch(() => {});
      root = await mkdtemp(path.join(tmpdir(), 'sone-pass-'));
      store = new LocalFileStore(root);
    });

    // --- one pass, every task ------------------------------------------------

    test('a pass with something for every task to do fills the whole report', async () => {
      /*
       * The answer to "which of the ten does the suite exercise".
       *
       * Written as one fixture and one assertion rather than ten tests, because
       * the thing that was missing is not a test per task — several tasks have
       * good ones of their own, against the function. What was missing is the
       * step between the function and the number an operator reads, and that
       * step only exists when the pass runs.
       *
       * Every field is asserted, including the ones that must stay zero: a
       * report where everything is busy proves the wiring, and a report where
       * the right things are quiet proves the wiring goes to the right places.
       */
      await everythingToDo();

      const report = await runPass({ withSync: true });

      assert.deepEqual(report.errors, [], 'nothing failed');

      // Each of these was zero in every previous run of this job under test.
      assert.equal(report.prunedSessions, 1, 'an expired sign-in');
      assert.equal(report.prunedAttempts, 1, 'a stale rate-limit row');
      assert.equal(report.prunedShareSessions, 1, 'a visitor who stopped visiting');
      assert.equal(report.purgedWorkspaces, 1, 'a workspace deleted long enough ago');
      assert.equal(report.revalidatedConnections, CONNECTIONS, 'the open connections');
      assert.equal(revalidated, 1, 'and the sync server was actually asked');
      assert.equal(report.versionedDocuments, 1, 'the page that went quiet');
      assert.equal(report.compactedDocuments, 1, 'the page with a backlog');
      assert.equal(report.expiredJobs, 1, 'a download nobody came for');
      assert.equal(report.thinnedVersions, 1, 'a version past the window');
      assert.equal(report.retriedProjections, 1, 'the failed projection, tried again');
      assert.equal(report.recoveredProjections, 1, 'and it worked this time');
      assert.equal(report.abandonedProjections, 1, 'the one that has run out of tries');

      // And the four anomalies, which are counted rather than fixed.
      assert.equal(report.staleSearchRows, 1);
      assert.equal(report.orphanedPages, 1);
      assert.equal(report.entriesInsidePages, 1);
      assert.equal(report.orphanedDocuments, 1);
      assert.equal(report.orphanedFiles, 1);

      assert.ok(report.durationMs >= 0);
    });

    test('and the expired job took its file with it', async () => {
      /*
       * The half of `expireJobs` that only exists inside the job: the callback
       * that hands the result's key to the file store. `jobs.db.test.ts` covers
       * the function with a stub of its own; nothing had ever run the real one.
       *
       * It matters that the two tasks agree — the archive is deleted by the job
       * expiry, so the orphan sweep four tasks later does not find it and
       * report it as loose.
       */
      await everythingToDo();
      const report = await runPass({ withSync: true });

      assert.equal(report.expiredJobs, 1);
      assert.deepEqual(
        (await store.list()).map((one) => one.key).sort(),
        [keyFor('a')],
        'the archive is gone and only the loose file is left',
      );
      assert.equal(report.orphanedFiles, 1, 'and it is not counted twice');
    });

    test('without a sync server the pass still runs', async () => {
      // Every previous run of this job under test was this one. It is a real
      // case — a process that serves HTTP and no documents — and it was
      // standing in for the other one.
      await everythingToDo();
      const report = await runPass({ withSync: false });

      assert.equal(report.revalidatedConnections, 0);
      assert.deepEqual(report.errors, []);
      assert.equal(report.versionedDocuments, 1, 'the rest of the pass is unaffected');
    });

    // --- the two tasks nothing had ever run ----------------------------------

    test('an expired share session is pruned and a live one is kept', async () => {
      const token = await shareToken();
      await db.query(
        `INSERT INTO share_sessions (share_token_id, display_name, expires_at)
         VALUES ($1,'Gestern', now() - interval '1 day'),
                ($1,'Heute',   now() + interval '1 day')`,
        [token],
      );

      assert.equal(await pruneShareSessions(db), 1);
      const left = await db.query<{ display_name: string }>(
        `SELECT display_name FROM share_sessions`,
      );
      assert.deepEqual(left.rows.map((row) => row.display_name), ['Heute']);
    });

    test('a page that has gone quiet gets a version, with who wrote it', async () => {
      await page(QUIET, 'Die Zahlen');
      await writeSomething(QUIET, fx.userId);
      await quieten();

      const outcome = await versionQuietDocuments(db);
      assert.equal(outcome.taken, 1);
      assert.deepEqual(outcome.failures, []);

      const versions = await listVersions(db, QUIET);
      assert.equal(versions.length, 1);
      assert.equal(versions[0]!.reason, 'quiet', 'and it says why it exists');
      assert.deepEqual(versions[0]!.authors, [fx.userId], 'and who had written');
    });

    test('and not a second one while nothing has changed', async () => {
      /*
       * The `max(u.seq) > through_seq` half. Without it this writes an
       * identical state every five minutes, which is how a history table
       * outgrows the documents it describes — the function's own words, and
       * nothing had ever run it twice.
       */
      await page(QUIET, 'Die Zahlen');
      await writeSomething(QUIET, fx.userId);
      await quieten();

      assert.equal((await versionQuietDocuments(db)).taken, 1);
      assert.equal((await versionQuietDocuments(db)).taken, 0, 'nothing new to record');
      assert.equal((await listVersions(db, QUIET)).length, 1);
    });

    test('a page still being written is left alone', async () => {
      // The other half: quiet means quiet. `QUIET_MINUTES` is what separates
      // "still writing" from "finished for now", and this update is seconds old.
      await page(QUIET, 'Die Zahlen');
      await writeSomething(QUIET, fx.userId);

      assert.ok(QUIET_MINUTES >= 1, 'a sane default, whatever the environment said');
      assert.equal((await versionQuietDocuments(db)).taken, 0);
    });

    test('an archived page is not versioned', async () => {
      await page(QUIET, 'Alt', { archived: true });
      await writeSomething(QUIET, fx.userId);
      await quieten();

      assert.equal((await versionQuietDocuments(db)).taken, 0);
    });

    test('a document that cannot be read is reported rather than skipped', async () => {
      /*
       * **The finding.** This loop caught and discarded, under a comment saying
       * the job's own guard would report it on the next pass — and the guard
       * wraps this function, so nothing caught in here ever reaches it
       * (ADR-0111).
       *
       * The consequence is not a lost version. It is a page that is never
       * versioned, for as long as the instance runs, with every report saying
       * the pass went fine.
       */
      await page(QUIET, 'Gut');
      await writeSomething(QUIET, fx.userId);
      await page(uuid(17), 'Kaputt');
      await db.query(
        `INSERT INTO doc_updates (doc_id, seq, payload, actor_id)
         VALUES ($1, nextval('doc_update_seq'), '\\xdeadbeef', NULL)`,
        [uuid(17)],
      );
      await quieten();

      const outcome = await versionQuietDocuments(db);
      assert.equal(outcome.taken, 1, 'the readable one is still versioned');
      assert.equal(outcome.failures.length, 1, 'and the other one is named');
      assert.match(outcome.failures[0]!, new RegExp(uuid(17)), 'by the page somebody can open');

      const report = await runPass({ withSync: false });
      assert.ok(
        report.errors.some((one) => one.startsWith('version quiet documents —')),
        `the pass says so too, got ${JSON.stringify(report.errors)}`,
      );
    });

    // --- helpers -------------------------------------------------------------

    /** A key of the shape `LocalFileStore` produces. */
    function keyFor(seed: string): string {
      const hex = seed.repeat(64).slice(0, 64);
      return `${hex.slice(0, 2)}/${hex.slice(2)}.bin`;
    }

    async function page(
      id: string,
      title: string,
      opts: { parent?: string | null; archived?: boolean; kind?: string } = {},
    ): Promise<void> {
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind,
                            ancestor_ids, archived_at)
         VALUES ($1,$2,$3,$4,'a0',$5,$6,$7)`,
        [
          id,
          fx.workspaceId,
          opts.parent ?? null,
          title,
          opts.kind ?? 'page',
          opts.parent ? [opts.parent] : [],
          opts.archived ? new Date() : null,
        ],
      );
    }

    /** One real Yjs update on a page, attributed to somebody. */
    async function writeSomething(pageId: string, actor: string | null): Promise<void> {
      const doc = new Y.Doc();
      doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'etwas');
      await appendUpdate(db, pageId, Y.encodeStateAsUpdate(doc), actor);
      doc.destroy();
    }

    /** Age every update past the quiet window. */
    async function quieten(): Promise<void> {
      await db.query(
        `UPDATE doc_updates SET created_at = now() - ($1 || ' minutes')::interval`,
        [String(QUIET_MINUTES + 5)],
      );
    }

    async function shareToken(): Promise<string> {
      await page(uuid(20), 'Geteilt');
      const row = await db.query<{ id: string }>(
        `INSERT INTO share_tokens (workspace_id, scope_page_id, token_hash, role, created_by)
         VALUES ($1,$2,'\\x0102','viewer',$3) RETURNING id`,
        [fx.workspaceId, uuid(20), fx.userId],
      );
      return row.rows[0]!.id;
    }

    /** Put bytes in the store by hand, aged, with no row naming them. */
    async function storeFile(seed: string, ageHours: number): Promise<string> {
      const key = keyFor(seed);
      const target = path.join(root, key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `bytes-${seed}`, 'utf8');
      const when = new Date(Date.now() - ageHours * 3600_000);
      await utimes(target, when, when);
      return key;
    }

    /** Run the pass, with or without a sync server to revalidate. */
    async function runPass(opts: { withSync: boolean }): ReturnType<Maintenance['runOnce']> {
      const job = new Maintenance({
        pool: db,
        store,
        log: () => {},
        ...(opts.withSync
          ? {
              sync: {
                stats: { connections: CONNECTIONS },
                revalidateAll: async () => {
                  revalidated += 1;
                },
              },
            }
          : {}),
      } as never);
      return job.runOnce();
    }

    /**
     * A fixture that leaves every one of the ten tasks something to do.
     *
     * Long on purpose. The tasks share tables — versioning and compaction both
     * read `doc_updates`, the job expiry and the orphan sweep both hold a
     * storage key — so the interesting part of this is what is kept apart:
     * `BUSY`'s updates are seconds old so the versioning task does not claim
     * it, and `HEALING`'s document is readable so the retry can succeed.
     */
    async function everythingToDo(): Promise<void> {
      // 1. an expired sign-in and a live one
      await db.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES
           ($1, '\\x01', now() - interval '30 days'),
           ($1, '\\x02', now() + interval '30 days')`,
        [fx.userId],
      );

      // 2. a stale rate-limit row
      await db.query(
        `INSERT INTO auth_attempts (key, succeeded, attempted_at)
         VALUES ('login:old', false, now() - interval '2 days')`,
      );

      // 3. a visitor who stopped visiting
      const token = await shareToken();
      await db.query(
        `INSERT INTO share_sessions (share_token_id, display_name, expires_at)
         VALUES ($1,'Weg', now() - interval '1 day')`,
        [token],
      );

      // 4. a workspace deleted long enough ago to purge
      const gone = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by, deleted_at)
         VALUES ('Aufgelöst', $1, now() - interval '60 days') RETURNING id`,
        [fx.userId],
      );
      await addMember(db, gone.rows[0]!.id, fx.userId, 'owner');

      // 5. a page that has gone quiet, and one still being written
      await page(QUIET, 'Die Zahlen');
      await writeSomething(QUIET, fx.userId);
      await quieten();

      // 6. a backlog over the compaction threshold, written just now so the
      //    versioning task above does not take it as well
      await page(BUSY, 'Viel los');
      const busy = new Y.Doc();
      for (let i = 0; i <= 200; i++) {
        const before = Y.encodeStateVector(busy);
        busy.getMap(DOC_KEYS.page).set(`k${i}`, i);
        await appendUpdate(db, BUSY, Y.encodeStateAsUpdate(busy, before), null);
      }
      busy.destroy();

      // 7. a finished job whose download nobody came for
      const archive = await storeFile('b', 2);
      await db.query(
        `INSERT INTO jobs (kind, workspace_id, created_by, state, payload, result, expires_at)
         VALUES ('workspace_export', $1, $2, 'done', '{}'::jsonb, $3::jsonb,
                 now() - interval '1 hour')`,
        [fx.workspaceId, fx.userId, JSON.stringify({ key: archive, bytes: 10 })],
      );

      // 8. a version past the retention window
      await db.query(
        `INSERT INTO page_versions (doc_id, through_seq, state, taken_at, reason)
         VALUES ($1, 1, '\\x00', now() - interval '400 days', 'compaction')`,
        [BUSY],
      );

      // 9. a failed projection that can be read this time, and one out of tries
      await page(HEALING, 'Heilt');
      await writeSomething(HEALING, fx.userId);
      await db.query(
        `INSERT INTO materialization_state (page_id, status, attempts, last_error, materialized_at)
         VALUES ($1, 'failed', 1, 'transient', now() - interval '10 hours')`,
        [HEALING],
      );
      await page(uuid(18), 'Hoffnungslos');
      await db.query(
        `INSERT INTO materialization_state (page_id, status, attempts, last_error, materialized_at)
         VALUES ($1, 'failed', $2, 'broken', now() - interval '10 hours')`,
        [uuid(18), MAX_PROJECTION_ATTEMPTS],
      );

      // 10a. a search row built with a configuration the workspace no longer uses
      const doc = new Y.Doc();
      doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
      const meta = doc.getMap(DOC_KEYS.page);
      meta.set(PAGE_KEYS.title, 'Gesucht');
      meta.set(PAGE_KEYS.idx, 'a0');
      await withTransaction(db, (client) =>
        materializeYDoc(client, uuid(19), doc, { throughSeq: 1, workspaceId: fx.workspaceId }),
      );
      doc.destroy();
      await db.query(`UPDATE workspaces SET search_config = 'german'::regconfig WHERE id = $1`, [
        fx.workspaceId,
      ]);

      // 10b. a page whose parent does not exist
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids)
         VALUES ($1,$2,$3,'Verwaist','a0','page','{}')`,
        [ORPHAN, fx.workspaceId, uuid(99)],
      );

      // 10c. an entry inside a page rather than inside a folder
      await page(MISPLACED, 'Falsch einsortiert', { parent: QUIET });

      // 10d. a document whose page is gone, and a file no row names
      await db.query(
        `INSERT INTO doc_updates (doc_id, seq, payload, actor_id)
         VALUES ($1, nextval('doc_update_seq'), '\\x00', NULL)`,
        [STRAY],
      );
      await storeFile('a', 2);

      // The three anomaly counts have an hour's grace, because a CRDT update
      // that arrived seconds ago is settling rather than broken (ADR-0106).
      await db.query(`UPDATE pages SET created_at = now() - interval '2 hours'`);
      await db.query(
        `UPDATE doc_updates SET created_at = now() - interval '2 hours' WHERE doc_id = $1`,
        [STRAY],
      );
    }
  },
);

describe(
  'what the bounds on the settings are for (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    /*
     * Two demonstrations rather than two assertions about our own code.
     *
     * `envNumber` refuses a value; these say what accepting it would have cost,
     * against the real database, in the exact statements the two settings reach
     * (ADR-0111). Without them the bounds read like caution, and the next
     * person to find them in the way deletes one.
     */
    let db: Pool;

    before(async () => {
      db = await getTestPool();
    });

    after(async () => {
      await closeTestPool();
    });

    test('a setting that is not a number stops the statement it lands in', async () => {
      // What `SONE_VERSION_QUIET_MINUTES=ten` used to produce: versioning fails
      // on every pass, for as long as the instance runs.
      await assert.rejects(
        () => db.query(`SELECT now() - ($1 || ' minutes')::interval`, [String(Number('ten'))]),
        (err: { code?: string }) => err.code === '22007',
        'Postgres is handed the string "NaN minutes"',
      );

      const ok = await db.query(`SELECT now() - ($1 || ' minutes')::interval AS t`, [
        String(QUIET_MINUTES),
      ]);
      assert.ok(ok.rows[0], 'and what the setting actually holds is usable');
    });

    test('and an hour count that is not a number poisons a date column', async () => {
      /*
       * The worst of the family. `SONE_JOB_RESULT_HOURS` is multiplied into a
       * `Date`, and an Invalid Date reaches Postgres as
       * `0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN` — so the statement that records a
       * job as **done** fails, and the runner's catch marks work that succeeded
       * as failed and retries it until the attempts run out.
       */
      await assert.rejects(
        () => db.query(`SELECT $1::timestamptz`, [new Date(Date.now() + Number('x') * 3600_000)]),
        (err: { code?: string }) => err.code === '22007',
      );

      const ok = await db.query<{ t: Date }>(`SELECT $1::timestamptz AS t`, [
        new Date(Date.now() + JOB_RESULT_HOURS * 3600_000),
      ]);
      assert.ok(ok.rows[0]!.t instanceof Date, 'and the real one is a time');
    });
  },
);
