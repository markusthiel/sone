/**
 * Letters about something that did not happen (ADR-0129).
 *
 * Three of the six mails proposed beside ADR-0121, and the three that are not
 * sent at a moment:
 *
 *   an invitation nobody redeemed        — to whoever sent it
 *   a guest link about to expire         — to whoever made it
 *   a run of mail that did not go out    — to the instance's administrators
 *
 * ## What makes these different from every mail before them
 *
 * They have no event to hang on. Each is true for days at a stretch, and the
 * maintenance job comes round every five minutes — so **the whole difficulty is
 * remembering that a letter was already sent**. Most of what is asserted here is
 * that the second pass is silent.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { sendReminders } from '../src/mail/reminders.js';
import type { Letter } from '../src/mail/letter.js';
import {
  addMember,
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';

describe(
  'letters about something that did not happen (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let posted: Array<{ to: string; letter: Letter }>;

    const deps = () => ({
      pool: db,
      baseUrl: 'https://sone.example.org',
      instanceName: () => Promise.resolve('Haus Thiel'),
      sendLetter: (to: string, letter: Letter) => {
        posted.push({ to, letter });
        return Promise.resolve();
      },
    });

    before(async () => {
      db = await getTestPool();
    });

    after(async () => {
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db, 'Haus');
      await db.query(
        // An instance administrator as well as the workspace's owner: the
        // outage report goes to the first and not the second.
        `UPDATE users
            SET display_name = 'Anna Weber', email = 'anna@example.org',
                is_instance_admin = true
          WHERE id = $1`,
        [fx.userId],
      );
      posted = [];
    });

    /** An invitation, sent some number of days ago and never used. */
    async function invitation(daysAgo: number, over: Record<string, unknown> = {}): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO invitations
           (workspace_id, email, token_hash, invited_by, created_at, expires_at, uses, revoked_at)
         VALUES ($1, 'gast@example.org', $2, $3,
                 now() - ($4 || ' days')::interval, now() + interval '30 days',
                 $5, $6)
         RETURNING id`,
        [
          fx.workspaceId,
          Buffer.from(`${Math.random()}`),
          fx.userId,
          String(daysAgo),
          over['uses'] ?? 0,
          over['revoked_at'] ?? null,
        ],
      );
      return row.rows[0]!.id;
    }

    /** A share link on a page, expiring in so many days. */
    async function link(inDays: number | null): Promise<string> {
      const page = await db.query<{ id: string }>(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         VALUES (gen_random_uuid(), $1, 'Q3 Planung', 'a0', 'page') RETURNING id`,
        [fx.workspaceId],
      );
      const row = await db.query<{ id: string }>(
        `INSERT INTO share_tokens (workspace_id, scope_page_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, ${inDays === null ? 'NULL' : `now() + interval '${inDays} days'`})
         RETURNING id`,
        [fx.workspaceId, page.rows[0]!.id, Buffer.from(`${Math.random()}`), fx.userId],
      );
      return row.rows[0]!.id;
    }

    /** A notification job that failed to send. */
    async function failedMail(minutesAgo = 5): Promise<void> {
      await db.query(
        `INSERT INTO jobs (workspace_id, kind, state, created_by, finished_at, error)
         VALUES ($1, 'email_notifications', 'failed', $2,
                 now() - ($3 || ' minutes')::interval, 'the relay refused it')`,
        [fx.workspaceId, fx.userId, String(minutesAgo)],
      );
    }

    // --- an invitation nobody redeemed ---------------------------------------

    test('after a few days, whoever sent it is told', async () => {
      // To the inviter and not the invited: somebody who never signed up did
      // not ask to hear from this instance twice, and the person who can do
      // something about it — resend, or ask in person — is the one who sent it.
      await invitation(4);
      await sendReminders(deps());

      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.to, 'anna@example.org');
      assert.match(JSON.stringify(posted[0]!.letter), /gast@example\.org/);
    });

    test('and not again on the next pass', async () => {
      /*
       * The whole difficulty. The maintenance job comes round every five
       * minutes and "nobody has redeemed it" stays true for days — so without
       * a memory this is a letter every five minutes until somebody does.
       */
      await invitation(4);
      await sendReminders(deps());
      await sendReminders(deps());

      assert.equal(posted.length, 1);
    });

    test('one sent this morning is not old enough to chase', async () => {
      await invitation(1);
      await sendReminders(deps());
      assert.deepEqual(posted, []);
    });

    test('and one that was used, or withdrawn, is not chased at all', async () => {
      await invitation(4, { uses: 1 });
      await invitation(4, { revoked_at: new Date() });
      await sendReminders(deps());
      assert.deepEqual(posted, []);
    });

    // --- a link about to expire ----------------------------------------------

    test('whoever made a link is told before it stops working', async () => {
      /*
       * Useful since ADR-0126, and only since then: links expire by default
       * now, so the failure this prevents — a client who cannot open the page
       * they were sent last month — is one that can actually happen.
       */
      await link(2);
      await sendReminders(deps());

      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.to, 'anna@example.org');
    });

    test('a link with weeks left is not mentioned', async () => {
      await link(20);
      await sendReminders(deps());
      assert.deepEqual(posted, []);
    });

    test('and a link that never expires is never expiring', async () => {
      // The obvious hole in a query about `expires_at`: null is not a date in
      // the past and it is not a date in the future either.
      await link(null);
      await sendReminders(deps());
      assert.deepEqual(posted, []);
    });

    test('nor is one that already stopped', async () => {
      // A warning about a link that expired yesterday is a mail about something
      // the reader cannot act on and did not need to be told twice.
      await link(-1);
      await sendReminders(deps());
      assert.deepEqual(posted, []);
    });

    // --- mail that did not go out --------------------------------------------

    test('a run of failed sends is reported once the relay works again', async () => {
      /*
       * **The decision this one turns on.** A broken relay cannot send the mail
       * that says the relay is broken, so this letter is not a warning: it is a
       * report of a window that has closed, sent by the relay that has started
       * working again. What covers the *current* outage is the number on the
       * administration screen, which needs no relay to be true.
       */
      await failedMail();
      await failedMail();
      await sendReminders(deps());

      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.to, 'anna@example.org', 'to whoever runs the instance');
      assert.match(JSON.stringify(posted[0]!.letter), /2/, 'how many did not arrive');
    });

    test('and the same window is not reported twice', async () => {
      await failedMail();
      await sendReminders(deps());
      await sendReminders(deps());
      assert.equal(posted.length, 1);
    });

    test('but a later outage is a different window', async () => {
      /*
       * Keyed on the newest failure it covered, so failures that arrive
       * afterwards are a new subject rather than the same one again.
       *
       * **This test found a real one.** The first version keyed on
       * `max(id::text)`, and a uuid is random — so whether a later outage was
       * seen at all depended on which ids the run happened to generate. It is
       * the newest by `finished_at` now.
       */
      await failedMail();
      await sendReminders(deps());
      posted = [];

      await failedMail(1);
      await sendReminders(deps());
      assert.equal(posted.length, 1);
    });

    test('it goes to instance administrators and to nobody else', async () => {
      // A relay is an instance-wide thing, and a workspace owner can do nothing
      // about an SMTP password.
      const other = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ('bert@example.org','Bert') RETURNING id`,
      );
      await addMember(db, fx.workspaceId, other.rows[0]!.id, 'owner');

      await failedMail();
      await sendReminders(deps());

      assert.deepEqual(
        posted.map((one) => one.to),
        ['anna@example.org'],
      );
    });

    // --- when there is nobody to write to ------------------------------------

    test('with no relay nothing is claimed, so it can be sent later', async () => {
      /*
       * The one case where claiming first would be wrong. An instance with no
       * relay would otherwise mark every reminder as sent while sending none,
       * and configuring mail a week later would deliver silence.
       */
      await invitation(4);
      const { sendLetter: _none, ...withoutRelay } = deps();
      await sendReminders(withoutRelay);

      const claimed = await db.query(`SELECT 1 FROM reminders`);
      assert.equal(claimed.rowCount, 0);
    });

    test('and a sender that quietly does nothing counts as no relay', async () => {
      /*
       * The shape production actually has, and the one the check above would
       * have missed: the wiring always *has* a sender, and that sender returns
       * without doing anything when no relay is configured. Asking only whether
       * a function exists would claim every reminder while sending none.
       */
      await invitation(4);
      await sendReminders({ ...deps(), canSendMail: () => Promise.resolve(false) });

      assert.deepEqual(posted, []);
      const claimed = await db.query(`SELECT 1 FROM reminders`);
      assert.equal(claimed.rowCount, 0);
    });
  },
);
