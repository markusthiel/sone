/**
 * Telling whoever asked that their export is ready (ADR-0138).
 *
 * A workspace export takes minutes, the screen polls only while somebody is
 * watching, and the archive expires in a day. So the ordinary failure is: ask,
 * close the tab, come back to nothing.
 *
 * The half worth testing is **who is not told**. A letter about a finished job
 * is one more thing that can be more generous than the route it points at, and
 * the download route hands the archive to the asker and nobody else (ADR-0044).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { tellAboutJob } from '../src/mail/jobDone.js';
import { renderText, type Letter } from '../src/mail/letter.js';
import { enqueue, runOneJob, type FinishedJob } from '../src/jobs/runner.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';

describe(
  'an export that finished (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let posted: Array<{ to: string; letter: Letter }>;

    const deps = () => ({
      pool: db,
      baseUrl: 'https://sone.example.org/',
      instanceName: () => Promise.resolve('Haus Thiel'),
      sendLetter: (to: string, letter: Letter) => {
        posted.push({ to, letter });
        return Promise.resolve();
      },
    });

    const finished = (over: Partial<FinishedJob> = {}): FinishedJob => ({
      id: 'j1',
      workspaceId: fx.workspaceId,
      kind: 'workspace_export',
      payload: {},
      createdBy: fx.userId,
      attempts: 1,
      result: { key: 'ab/cd', pages: 12, bytes: 3_500_000 },
      expiresAt: new Date('2026-09-30T10:00:00Z'),
      ...over,
    });

    before(async () => {
      db = await getTestPool();
    });
    after(async () => {
      await closeTestPool();
    });
    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);
      posted = [];
    });

    // --- who is told ------------------------------------------------------

    test('whoever asked, and the letter says what it is worth knowing', async () => {
      const account = await db.query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1`,
        [fx.userId],
      );

      assert.equal(await tellAboutJob(deps(), finished(), 'done'), true);
      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.to, account.rows[0]!.email);

      const text = renderText(posted[0]!.letter);
      assert.match(text, /12 pages/, 'a count, which is not content');
      assert.match(text, /3\.3 MB/, 'and a size, from the same formatter the screen uses');
      // The reason the letter is worth sending at all: an archive that expires
      // while nobody is looking is an export somebody asks for twice.
      assert.match(text, /2026-09-30/);
    });

    test('the link opens the screen, and carries nothing that opens the archive', async () => {
      /*
       * **The decision this letter turns on.** ADR-0126's share mail carries a
       * token; this one must not. The archive is every page of a workspace, so
       * a bearer link to it in a mailbox is the largest possible version of
       * what ADR-0058 exists to prevent — and the download route already
       * refuses everybody but the asker.
       */
      await tellAboutJob(deps(), finished(), 'done');
      const text = renderText(posted[0]!.letter);

      assert.match(text, new RegExp(`/workspace/${fx.workspaceId}/export`));
      assert.doesNotMatch(text, /\/api\/jobs\//, 'not the download route');
      assert.doesNotMatch(text, /ab\/cd/, 'and not the storage key');
      assert.doesNotMatch(text, /token|[?&]t=/i);
    });

    test('a job nobody asked for has nobody to tell', async () => {
      /*
       * The rule, and the reason there is no list of kinds to keep in step with
       * the handlers: the sweep that turns aged notifications into work passes
       * `created_by: null`, so "worth telling somebody about" is already a fact
       * about the row.
       */
      assert.equal(await tellAboutJob(deps(), finished({ createdBy: null }), 'done'), false);
      assert.equal(posted.length, 0);
    });

    test('an account with no address, and one that has been deactivated', async () => {
      // A guest has no address (ADR-0033); a deactivated account keeps its row
      // and should not be written to.
      await db.query(`UPDATE users SET email = NULL WHERE id = $1`, [fx.userId]);
      assert.equal(await tellAboutJob(deps(), finished(), 'done'), false);

      await db.query(`UPDATE users SET email = 'gone@example.org', deactivated_at = now() WHERE id = $1`, [
        fx.userId,
      ]);
      assert.equal(await tellAboutJob(deps(), finished(), 'done'), false);
      assert.equal(posted.length, 0);
    });

    test('no relay, no letter, and no error either', async () => {
      // ADR-0059's rule: absent rather than broken.
      const { sendLetter: _drop, ...withoutRelay } = deps();
      assert.equal(await tellAboutJob(withoutRelay, finished(), 'done'), false);
    });

    // --- what a failure says ----------------------------------------------

    test('a failure names no reason, and points at the screen that has one', async () => {
      /*
       * The reasons are sentences this instance wrote about its own machinery
       * and several of them name a page — which is the one thing a mail does
       * not carry (ADR-0058). The screen has the error and the screen is where
       * somebody would act on it.
       */
      await tellAboutJob(deps(), finished(), 'failed');
      const text = renderText(posted[0]!.letter);

      assert.match(text, /did not finish/);
      assert.match(text, new RegExp(`/workspace/${fx.workspaceId}/export`));
      assert.doesNotMatch(text, /3\.3 MB|12 pages/, 'nothing about an archive there is not');
    });

    // --- and the runner only tells once, at the end -----------------------

    test('a job that will be tried again has not finished', async () => {
      /*
       * **The one that matters for the retries.** The runner widens the gap and
       * tries five times (ADR-0081), and "your export failed" four times before
       * it succeeds is worse than silence.
       */
      const told: Array<{ id: string; outcome: string }> = [];
      const id = await enqueue(db, {
        workspaceId: fx.workspaceId,
        kind: 'always_fails',
        createdBy: fx.userId,
      });

      const handlers = {
        always_fails: () => Promise.reject(new Error('nope')),
      };
      // Four attempts short of the limit: nothing is told, and the row goes
      // back to queued each time.
      for (let attempt = 0; attempt < 4; attempt++) {
        await db.query(`UPDATE jobs SET run_after = now() WHERE id = $1`, [id]);
        await runOneJob(db, handlers, (job, outcome) => {
          told.push({ id: job.id, outcome });
          return Promise.resolve();
        });
      }
      assert.deepEqual(told, [] as typeof told, 'four attempts, nothing said');

      await db.query(`UPDATE jobs SET run_after = now() WHERE id = $1`, [id]);
      await runOneJob(db, handlers, (job, outcome) => {
        told.push({ id: job.id, outcome });
        return Promise.resolve();
      });
      assert.deepEqual(told, [{ id, outcome: 'failed' }], 'and the fifth is the end of it');
    });

    test('a success is told once, with what was just written to the row', async () => {
      const told: FinishedJob[] = [];
      const id = await enqueue(db, {
        workspaceId: fx.workspaceId,
        kind: 'quick',
        createdBy: fx.userId,
      });

      await runOneJob(
        db,
        { quick: () => Promise.resolve({ result: { pages: 3, bytes: 900 } }) },
        (job) => {
          told.push(job);
          return Promise.resolve();
        },
      );

      assert.equal(told.length, 1);
      assert.equal(told[0]!.id, id);
      // The result and the expiry are what the runner has just decided, and
      // neither is on the row it claimed — which is why they are handed over
      // rather than read back.
      assert.deepEqual(told[0]!.result, { pages: 3, bytes: 900 });
      assert.ok(told[0]!.expiresAt instanceof Date);
    });

    test('a letter that throws does not fail the job', async () => {
      // The work is done and recorded before anybody is told. The rule ADR-0121
      // states for a grant, applied to a file.
      const id = await enqueue(db, {
        workspaceId: fx.workspaceId,
        kind: 'quick',
        createdBy: fx.userId,
      });

      await runOneJob(db, { quick: () => Promise.resolve({ result: { ok: true } }) }, () =>
        Promise.reject(new Error('the relay is on fire')),
      );

      const row = await db.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1`, [id]);
      assert.equal(row.rows[0]!.state, 'done');
    });
  },
);
