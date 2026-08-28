/**
 * Retrying failed projections.
 *
 * `attempts` has been counted since the first migration and nothing ever read
 * it, so a page whose document the projection could not read stayed failed
 * until somebody ran a script. It still synced and still opened — it was simply
 * missing from search and from the tree, which is the kind of failure nobody
 * notices until they go looking for something.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import {
  MAX_PROJECTION_ATTEMPTS,
  retryDelayMs,
  retryFailedProjections,
} from '../src/maintenance/job.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';

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
