/**
 * Who gets a mail, and who does not (ADR-0058).
 *
 * The claim is one statement, so these tests are about its `WHERE` — which is
 * where every rule in the record actually lives: the delay, the read check, the
 * per-person preference, an address that does not exist.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import { claimForEmail, EMAIL_DELAY_MINUTES } from '../src/jobs/emailNotifications.js';
// `./support/db.js`, which is where every other database test gets its pool.
// `./helpers/database.js` was a path I assumed rather than read — the third
// helper I have invented in this session.
import { getTestPool, resetDatabase, seedWorkspace } from './support/db.js';

describe('claiming notifications for email', () => {
  let db: Pool;
  let workspaceId: string;
  let recipient: string;
  let actor: string;

  before(async () => {
    db = await getTestPool();
    await resetDatabase(db);

    // The suite's own fixture rather than my own inserts: it already makes a
    // workspace with an owner who is a member of it.
    const fixture = await seedWorkspace(db, 'Mail');
    workspaceId = fixture.workspaceId;
    actor = fixture.userId;

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ('gets@example.org', 'Gets')
       RETURNING id::text AS id`,
    );
    recipient = rows[0]!.id;
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, recipient],
    );
  });

  after(async () => {
    await resetDatabase(db);
  });

  /** A page, and one notification on it, aged by the given number of minutes. */
  async function waiting(options: {
    kind?: string;
    ageMinutes?: number;
    read?: boolean;
  }): Promise<string> {
    // `pages.id` has no default: an id comes from the document, not from the
    // database (ADR-0002), so a test has to bring its own.
    const { rows: pages } = await db.query<{ id: string }>(
      `INSERT INTO pages (id, workspace_id, idx, title, kind)
       VALUES (gen_random_uuid(), $1, 'a' || floor(random() * 100000)::text, 'Eine Seite', 'page')
       RETURNING id::text AS id`,
      [workspaceId],
    );
    const pageId = pages[0]!.id;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO notifications
         (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt,
          created_at, read_at)
       -- The ids as their own parameters: concatenating onto $3 made Postgres
       -- deduce text for a parameter already used as a uuid, and it refuses
       -- that rather than guessing.
       VALUES ($1, $2, $3, $4, $5, $6, 'egal',
               now() - ($7 || ' minutes')::interval, $8)
       RETURNING id::text AS id`,
      [
        recipient,
        workspaceId,
        pageId,
        options.kind ?? 'mention',
        `t-${pageId}`,
        `m-${pageId}`,
        String(options.ageMinutes ?? EMAIL_DELAY_MINUTES + 1),
        options.read === true ? new Date() : null,
      ],
    );
    return rows[0]!.id;
  }

  test('a notification younger than the delay is not claimed', async () => {
    // The delay is what makes "she fixed it herself two minutes later" produce
    // no mail at all.
    await waiting({ ageMinutes: 1 });
    assert.deepEqual(await claimForEmail(db), []);
  });

  test('one already read in the app is not claimed', async () => {
    // The inbox is the primary channel; a mail about something dealt with is
    // noise that costs trust in every later one.
    await waiting({ read: true });
    assert.deepEqual(await claimForEmail(db), []);
  });

  test('an aged unread mention is claimed once, and grouped', async () => {
    await waiting({});
    await waiting({});
    const claimed = await claimForEmail(db);
    assert.equal(claimed.length, 1, 'one batch per person per workspace');
    assert.equal(claimed[0]?.ids.length, 2, 'both in it');

    // And not again: `emailed_at` means claimed, so a second sweep a minute
    // later does not enqueue the same batch while a relay is misconfigured.
    assert.deepEqual(await claimForEmail(db), []);
  });

  test('a kind somebody has turned off is not claimed', async () => {
    // Replies are off by default: that is the kind that arrives most often and
    // asks least.
    await waiting({ kind: 'reply' });
    assert.deepEqual(await claimForEmail(db), []);

    // Turned on, it is claimed — and the preference is read at claim time, so
    // changing it applies to what is already waiting rather than having decided
    // somebody's next week when the notification was written.
    await db.query(`UPDATE users SET replies_when = 'immediately' WHERE id = $1`, [recipient]);
    const claimed = await claimForEmail(db);
    assert.equal(claimed.length, 1);
  });

  test('an account with no address, or a deactivated one, is not claimed', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES (NULL, 'Ohne Adresse')
       RETURNING id::text AS id`,
    );
    const addressless = rows[0]!.id;
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, addressless],
    );
    const { rows: pages } = await db.query<{ id: string }>(
      `INSERT INTO pages (id, workspace_id, idx, title, kind)
       VALUES (gen_random_uuid(), $1, 'z0', 'Eine Seite', 'page') RETURNING id::text AS id`,
      [workspaceId],
    );
    await db.query(
      `INSERT INTO notifications
         (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt, created_at)
       VALUES ($1, $2, $3, 'mention', 'tz', 'mz', 'egal', now() - interval '1 hour')`,
      [addressless, workspaceId, pages[0]!.id],
    );

    const claimed = await claimForEmail(db);
    assert.ok(
      !claimed.some((one) => one.user_id === addressless),
      'nobody without an address',
    );
  });

  test('mentions at once and replies tomorrow, which used to be unsayable', async () => {
    /*
     * The amendment to ADR-0061 in one test.
     *
     * The record refused this, arguing that "two schedules is a matrix". The
     * design that was wanted is not a matrix: it is one control per kind
     * replacing the tick, and this combination — tell me at once when I am
     * mentioned, let the rest wait — is the ordinary thing to want.
     */
    await db.query(
      `UPDATE users SET mentions_when = 'immediately', replies_when = 'daily',
                        timezone = 'Etc/GMT-14'
        WHERE id = $1`,
      [recipient],
    );

    await waiting({ kind: 'reply' });
    await waiting({ kind: 'mention' });

    const claimed = await claimForEmail(db);
    // Only the mention: the reply waits for eight in a timezone it is not
    // eight in.
    assert.equal(claimed.length, 1, 'the mention alone');

    await db.query(
      `UPDATE users SET replies_when = 'off', timezone = NULL WHERE id = $1`,
      [recipient],
    );
  });

  /*
   * Last on purpose.
   *
   * This suite shares one recipient and its tests run in order, so notifications
   * left behind by an earlier test are visible to a later one — putting these
   * first broke "a notification younger than the delay is not claimed", which
   * was right to fail.
   */
  test('a daily reader is claimed at eight in their own timezone, and not otherwise', async () => {
    /*
     * The whole of ADR-0061 is in this WHERE clause, so this is where it is
     * tested. A digest at 07:00 UTC is the middle of the night for somebody,
     * and a mail arriving at the wrong hour is a mail that gets filed unread.
     */
    await db.query(`UPDATE users SET mentions_when = 'daily' WHERE id = $1`, [recipient]);
    await waiting({ ageMinutes: 120 });

    // The hour the *database* is in decides, so the test asks it rather than
    // assuming the container is on UTC.
    const { rows } = await db.query<{ hour: string }>(
      `SELECT extract(hour from now() AT TIME ZONE 'UTC')::text AS hour`,
    );
    const utcHour = Number(rows[0]?.hour ?? 0);

    // A timezone in which it is currently *not* eight: nothing is claimed.
    const quiet = (utcHour + 3) % 24;
    await db.query(`UPDATE users SET timezone = $2 WHERE id = $1`, [
      recipient,
      `Etc/GMT${quiet > 0 ? '-' : '+'}${Math.abs(quiet)}`,
    ]);
    assert.deepEqual(await claimForEmail(db), [], 'not at the wrong hour');

    // And one in which it is: offset so that UTC-now lands on eight.
    const offset = ((8 - utcHour) % 24 + 24) % 24;
    await db.query(`UPDATE users SET timezone = $2 WHERE id = $1`, [
      recipient,
      // Etc/GMT signs are inverted: Etc/GMT-3 is UTC+3.
      offset === 0 ? 'UTC' : `Etc/GMT-${offset}`,
    ]);
    const claimed = await claimForEmail(db);
    assert.equal(claimed.length, 1, 'at eight in their own morning');

    await db.query(
      `UPDATE users SET mentions_when = 'immediately', timezone = NULL WHERE id = $1`,
      [recipient],
    );
  });

  test('somebody who wants no mail is never claimed', async () => {
    // Distinct from turning every kind off: this is one answer instead of
    // three, and it is the one somebody reaches for (ADR-0061).
    await db.query(
      `UPDATE users SET mentions_when = 'off', assignments_when = 'off', replies_when = 'off'
        WHERE id = $1`,
      [recipient],
    );
    await waiting({});
    assert.deepEqual(await claimForEmail(db), []);
    await db.query(
      `UPDATE users SET mentions_when = 'immediately', assignments_when = 'immediately'
        WHERE id = $1`,
      [recipient],
    );
  });

});
