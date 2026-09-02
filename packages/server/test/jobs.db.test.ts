/**
 * Running work that outlives a request (ADR-0044).
 *
 * The test that justifies the whole design is the concurrent one: two claims at
 * the same moment must not both get the same job. That is the property an
 * in-process queue would have until the day SONE runs twice, and the symptom of
 * getting it wrong — two exports, one download, occasionally — is the kind
 * nobody reproduces.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';

import { claimJob, enqueue, expireJobs, runOneJob } from '../src/jobs/runner.js';
import { closeTestPool, getTestPool, resetDatabase, seedWorkspace } from './support/db.js';

let db: Pool;
let workspaceId: string;
let userId: string;

before(async () => {
  db = await getTestPool();
  await resetDatabase(db);
  const seeded = await seedWorkspace(db, 'Jobs');
  workspaceId = seeded.workspaceId;
  userId = seeded.userId;
});

after(async () => {
  await closeTestPool();
});

test('two claims at once get two different jobs, or one gets nothing', async () => {
  const first = await enqueue(db, { workspaceId, kind: 'test', createdBy: userId });
  const second = await enqueue(db, { workspaceId, kind: 'test', createdBy: userId });

  const [a, b] = await Promise.all([claimJob(db, ['test']), claimJob(db, ['test'])]);
  assert.ok(a && b, 'both found work');
  assert.notEqual(a.id, b.id, 'and never the same work');
  assert.deepEqual([a.id, b.id].sort(), [first, second].sort());

  // A third finds nothing rather than re-running one of the two.
  assert.equal(await claimJob(db, ['test']), null);
});

test('a job’s kind decides what runs, and its result is stored', async () => {
  const id = await enqueue(db, {
    workspaceId,
    kind: 'greet',
    payload: { who: 'Markus' },
    createdBy: userId,
  });

  const said: string[] = [];
  const ran = await runOneJob(db, {
    greet: async (job, ctx) => {
      await ctx.report('saying hello');
      said.push(String(job.payload['who']));
      return { result: { greeted: job.payload['who'] } };
    },
  });

  assert.equal(ran, true);
  assert.deepEqual(said, ['Markus']);

  const row = await db.query<{
    state: string;
    result: { greeted: string };
    progress: string | null;
    expires_at: Date | null;
  }>(`SELECT state, result, progress, expires_at FROM jobs WHERE id = $1`, [id]);
  assert.equal(row.rows[0]?.state, 'done');
  assert.deepEqual(row.rows[0]?.result, { greeted: 'Markus' });
  assert.equal(row.rows[0]?.progress, null, 'progress is cleared when it is over');
  assert.ok(row.rows[0]?.expires_at, 'and the result does not stay for ever');
});

test('a job that throws is recorded, and the runner carries on', async () => {
  // The caller is a timer, and a timer that stops because one job failed is a
  // queue that silently stops working.
  const id = await enqueue(db, { workspaceId, kind: 'boom', createdBy: userId });

  const ran = await runOneJob(db, {
    boom: () => Promise.reject(new Error('the archive was too large')),
  });
  assert.equal(ran, true, 'it ran, and it failed');

  const row = await db.query<{ state: string; error: string }>(
    `SELECT state, error FROM jobs WHERE id = $1`,
    [id],
  );
  assert.equal(row.rows[0]?.state, 'failed');
  // Stored so somebody can be told why their export did not arrive, instead of
  // watching it stay at "queued" for ever.
  assert.equal(row.rows[0]?.error, 'the archive was too large');
});

test('a kind this build does not know fails rather than staying claimed', async () => {
  // Which happens when a job outlives a downgrade.
  const id = await enqueue(db, { workspaceId, kind: 'test', createdBy: userId });
  // Claimed by a runner that handles 'test', then handed no handler for it.
  await db.query(`UPDATE jobs SET state = 'queued' WHERE id = $1`, [id]);
  const ran = await runOneJob(db, { test: undefined as never });
  assert.equal(ran, true);
  const row = await db.query<{ state: string; error: string }>(
    `SELECT state, error FROM jobs WHERE id = $1`,
    [id],
  );
  assert.equal(row.rows[0]?.state, 'failed');
  assert.match(row.rows[0]?.error ?? '', /unknown job kind/);
});

test('an expired result is freed and the row forgotten', async () => {
  const id = await enqueue(db, { workspaceId, kind: 'test', createdBy: userId });
  await db.query(
    `UPDATE jobs SET state = 'done', result = '{"key":"ab/1.zip"}'::jsonb,
            expires_at = now() - interval '1 hour' WHERE id = $1`,
    [id],
  );

  const freed: string[] = [];
  const count = await expireJobs(db, (result) => {
    freed.push(String(result['key']));
    return Promise.resolve();
  });

  assert.equal(count, 1);
  assert.deepEqual(freed, ['ab/1.zip'], 'the stored file is deleted too');
  const left = await db.query(`SELECT id FROM jobs WHERE id = $1`, [id]);
  assert.equal(left.rowCount, 0);
});
