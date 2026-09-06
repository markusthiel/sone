/**
 * Which language a letter arrives in (ADR-0133).
 *
 * The catalogue is checked without a database in `mailWords.test.ts`. This is
 * the other half, and the half that was actually wrong: **who decides**.
 *
 * `recipientLocale` has answered that question since ADR-0011 — the reader's
 * own setting, then the workspace's, then English — and nothing ever called it.
 * Every letter written between ADR-0058 and ADR-0132 wrote `locale: 'en'` into
 * the structure beside its words.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { addressLocale, recipientLocale } from '../src/i18n/locale.js';
import type { Letter } from '../src/mail/letter.js';
import { renderText } from '../src/mail/letter.js';
import { noteSignIn } from '../src/mail/signIn.js';
import { sendReminders } from '../src/mail/reminders.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';

describe(
  'a letter in the reader’s language (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;

    before(async () => {
      db = await getTestPool();
    });
    after(async () => {
      await closeTestPool();
    });
    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);
    });

    // --- who decides ------------------------------------------------------

    test('the reader’s own setting comes first', async () => {
      await db.query(`UPDATE users SET locale = 'de' WHERE id = $1`, [fx.userId]);
      await db.query(`UPDATE workspaces SET default_locale = 'en' WHERE id = $1`, [
        fx.workspaceId,
      ]);
      assert.equal(await recipientLocale(db, fx.userId, fx.workspaceId), 'de');
    });

    test('and the workspace answers for somebody who never chose', async () => {
      /*
       * The step the one bilingual mail skipped. `emailNotifications` read
       * `u.locale` alone and said `=== 'de' ? 'de' : 'en'`, so a member of a
       * German workspace who had never opened the language setting — which is
       * most people — got English from a server whose every screen was German.
       */
      await db.query(`UPDATE users SET locale = NULL WHERE id = $1`, [fx.userId]);
      await db.query(`UPDATE workspaces SET default_locale = 'de' WHERE id = $1`, [
        fx.workspaceId,
      ]);
      assert.equal(await recipientLocale(db, fx.userId, fx.workspaceId), 'de');
    });

    test('an address is not the same thing as no account', async () => {
      /*
       * The assumption both remaining English letters rested on. An invitation
       * and a shared link go to a mailbox — and a colleague on this instance
       * *has* an account behind that mailbox, with a language on it.
       */
      const row = await db.query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1`,
        [fx.userId],
      );
      const email = row.rows[0]!.email;
      await db.query(`UPDATE users SET locale = 'de' WHERE id = $1`, [fx.userId]);

      assert.equal(await addressLocale(db, email, null), 'de');
      // And case does not make somebody a different person.
      assert.equal(await addressLocale(db, email.toUpperCase(), null), 'de');
    });

    test('a stranger is answered by the place, not by English', async () => {
      await db.query(`UPDATE workspaces SET default_locale = 'de' WHERE id = $1`, [
        fx.workspaceId,
      ]);
      assert.equal(await addressLocale(db, 'nobody@example.org', fx.workspaceId), 'de');
      // With no workspace either, there is genuinely nothing to go on.
      assert.equal(await addressLocale(db, 'nobody@example.org', null), 'en');
    });

    test('a deactivated account does not answer for its address', async () => {
      // Their language is not a fact about whoever holds that mailbox now, and
      // the row is kept rather than deleted (ADR-0033).
      const row = await db.query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1`,
        [fx.userId],
      );
      await db.query(
        `UPDATE users SET locale = 'de', deactivated_at = now() WHERE id = $1`,
        [fx.userId],
      );
      assert.equal(await addressLocale(db, row.rows[0]!.email, null), 'en');
    });

    // --- and the letters actually carry it --------------------------------

    test('a welcome arrives in German for a German reader', async () => {
      const posted: Letter[] = [];
      await db.query(`UPDATE users SET locale = 'de' WHERE id = $1`, [fx.userId]);

      await noteSignIn(
        {
          pool: db,
          baseUrl: 'https://sone.example.org',
          instanceName: () => Promise.resolve('Haus Thiel'),
          welcome: () => Promise.resolve(true),
          sendLetter: (_to, letter) => {
            posted.push(letter);
            return Promise.resolve();
          },
        },
        fx.userId,
        { userAgent: 'a browser', ipPrefix: null },
      );

      assert.equal(posted.length, 1);
      const letter = posted[0]!;
      assert.equal(letter.locale, 'de', 'and the structure says so, for the lang attribute');
      assert.match(renderText(letter), /Willkommen/);
    });

    test('“Sie” is the instance’s choice, not the letter’s', async () => {
      /*
       * The half a language alone does not answer. An instance that addresses
       * people formally everywhere on screen must not have mails that say „du"
       * — and the setting for it already existed, used by nothing but the
       * interface.
       */
      const posted: Letter[] = [];
      await db.query(`UPDATE users SET locale = 'de' WHERE id = $1`, [fx.userId]);

      await noteSignIn(
        {
          pool: db,
          baseUrl: 'https://sone.example.org',
          instanceName: () => Promise.resolve('Haus Thiel'),
          welcome: () => Promise.resolve(true),
          addressForm: () => Promise.resolve('formal' as const),
          sendLetter: (_to, letter) => {
            posted.push(letter);
            return Promise.resolve();
          },
        },
        fx.userId,
        { userAgent: 'a browser', ipPrefix: null },
      );

      const text = renderText(posted[0]!);
      assert.match(text, /Ihr Konto/, 'the formal branch');
      assert.doesNotMatch(text, /\bDein Konto\b/, 'and not the informal one');
    });

    test('an English reader is untouched by any of it', async () => {
      const posted: Letter[] = [];
      await db.query(`UPDATE users SET locale = NULL WHERE id = $1`, [fx.userId]);

      await noteSignIn(
        {
          pool: db,
          baseUrl: 'https://sone.example.org',
          instanceName: () => Promise.resolve('Haus Thiel'),
          welcome: () => Promise.resolve(true),
          addressForm: () => Promise.resolve('formal' as const),
          sendLetter: (_to, letter) => {
            posted.push(letter);
            return Promise.resolve();
          },
        },
        fx.userId,
        { userAgent: 'a browser', ipPrefix: null },
      );

      const text = renderText(posted[0]!);
      assert.equal(posted[0]!.locale, 'en');
      assert.match(text, /Welcome/);
      // English has no branch on the address at all, so a formal instance does
      // not leave a `{address, select …}` showing in an English mail.
      assert.doesNotMatch(text, /[{}]/);
    });

    test('a reminder counts in words, not in brackets', async () => {
      /*
       * `${days} day(s)` was in three letters. The German forced it out — there
       * is no way to write it that a catalogue can translate — and the English
       * is better for it.
       */
      const posted: Letter[] = [];
      const owner = await db.query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1`,
        [fx.userId],
      );
      await db.query(
        `INSERT INTO invitations
           (workspace_id, invited_by, email, token_hash, expires_at, created_at, uses)
         VALUES ($1, $2, $3, $4, now() + interval '20 days', now() - interval '5 days', 0)`,
        [fx.workspaceId, fx.userId, 'wanted@example.org', Buffer.from('a token hash')],
      );

      await sendReminders({
        pool: db,
        baseUrl: 'https://sone.example.org',
        instanceName: () => Promise.resolve('Haus Thiel'),
        canSendMail: () => Promise.resolve(true),
        sendLetter: (to, letter) => {
          assert.equal(to, owner.rows[0]!.email);
          posted.push(letter);
          return Promise.resolve();
        },
      });

      assert.equal(posted.length, 1);
      const text = renderText(posted[0]!);
      assert.doesNotMatch(text, /\(s\)/, 'nothing counts with a bracket any more');
      assert.match(text, /3 days ago/);
    });
  },
);
