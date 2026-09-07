/**
 * The mails, in the reader's language (ADR-0133).
 *
 * The catalogue itself: that it is complete, that it is written the way a
 * catalogue has to be written to be translatable at all, and that the two
 * things it carries — the language and the form of address — do not get in each
 * other's way.
 *
 * What is *not* here is which language a given letter gets. That is a question
 * about a recipient and it needs a database, so it lives in
 * `letterLanguage.db.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { de } from '../src/mail/words.de.js';
import { en, type MailKey } from '../src/mail/words.en.js';
import { words } from '../src/mail/words.js';

const KEYS = Object.keys(en) as MailKey[];

describe('the catalogue', () => {
  test('German says everything English says', () => {
    /*
     * The type checker already refuses a missing key — `de` is declared as
     * `Record<keyof typeof en, string>`. This is the half a type cannot state:
     * that nobody satisfied it with an empty string or by pasting the English
     * in and meaning to come back.
     */
    assert.ok(KEYS.length > 50, 'a catalogue worth checking');
    for (const key of KEYS) {
      assert.ok((de[key] ?? '').trim().length > 0, `${key} is empty in German`);
    }
    assert.deepEqual(Object.keys(de).sort(), [...KEYS].sort(), 'and nothing extra');
  });

  test('every message formats in both languages, with nothing left showing', () => {
    /*
     * A `{name}` that reaches a reader is what the formatter does with a value
     * nobody supplied — deliberately, because a visible placeholder is a bug
     * report and half a sentence is not. That makes it exactly the thing to
     * check here: every placeholder any message uses has to be one this test
     * can name, or the letter that uses it is passing something else.
     */
    const values = {
      where: 'Instance',
      workspace: 'Team',
      by: 'Anna',
      role: 'Member',
      name: 'Markus',
      who: 'someone@example.org',
      what: 'a page',
      when: '2026-09-30',
      from: '203.0.113',
      title: 'A page',
      days: 3,
      count: 2,
      others: 2,
      size: '48.2 MB',
    };

    for (const locale of ['en', 'de'] as const) {
      for (const address of ['informal', 'formal'] as const) {
        const say = words(locale, address);
        for (const key of KEYS) {
          const out = say(key, values);
          assert.doesNotMatch(out, /[{}]/, `${key} (${locale}/${address}) left a placeholder`);
          assert.ok(out.trim().length > 0, `${key} (${locale}/${address}) is empty`);
        }
      }
    }
  });
});

describe('what makes it translatable', () => {
  test('a count is a plural, never a bracketed s', () => {
    /*
     * `${days} day(s)` and `${n} page(s)` is what the letters said, and it is
     * what a form letter says rather than what a person writes. A ternary is no
     * better: `n === 1 ? 'day' : 'days'` is English grammar written in code, and
     * German has different rules around zero, Polish four forms.
     *
     * The bracket is the visible symptom, so it is the thing to forbid.
     */
    for (const [name, catalogue] of [['en', en], ['de', de]] as const) {
      for (const key of KEYS) {
        assert.doesNotMatch(catalogue[key], /\(s\)/, `${name}/${key} counts with a bracket`);
      }
    }
  });

  test('German says du or Sie where a sentence has one, and never picks by itself', () => {
    /*
     * **The check this file exists for.** The instance chooses the form of
     * address, once, for everything this server says. A German sentence that
     * writes „du" straight into the string ignores that setting — and it will
     * be one line among two hundred, in a mail nobody on a formal instance
     * reads twice.
     *
     * So: any German message containing a second-person word has to contain the
     * branch that chose it.
     */
    const secondPerson =
      /\b(du|dich|dir|dein|deine|deinen|deiner|deinem|deines|Sie|Ihnen|Ihr|Ihre|Ihren|Ihrer|Ihrem|Ihres)\b/;

    for (const key of KEYS) {
      const message = de[key];
      if (!secondPerson.test(message)) continue;
      assert.match(
        message,
        /\{address, select,/,
        `de/${key} addresses the reader without asking how this instance does`,
      );
    }
  });

  test('and both branches exist wherever it does', () => {
    // A `select` with only one branch resolves through `other` for everybody,
    // which is a formal instance reading „du" with the machinery in place to
    // have prevented it.
    for (const key of KEYS) {
      const message = de[key];
      if (!message.includes('{address, select,')) continue;
      assert.ok(message.includes('formal {'), `de/${key} has no formal branch`);
      assert.ok(message.includes('other {'), `de/${key} has no informal branch`);
    }
  });

  test('“address” is the form of address and nothing else', () => {
    /*
     * Found by writing the German. `device.where` said *"Just now, from
     * {address}"*, meaning the network address — and `address` is handed to
     * every message as „du" or „Sie", so the English came out as *"Just now,
     * from informal."*
     *
     * A reserved name is only reserved if something says so.
     */
    const say = words('en', 'informal');
    assert.equal(say('device.where', { from: '203.0.113' }), 'Just now, from 203.0.113.');
    for (const key of KEYS) {
      for (const catalogue of [en, de]) {
        assert.doesNotMatch(
          catalogue[key],
          /\{address\}/,
          `${key} uses {address} as a value`,
        );
      }
    }
  });
});

describe('what a translated mail may still not say', () => {
  test('no letter is written outside the catalogue', () => {
    /*
     * The rule that keeps this true after today. A `subject:` or a line built
     * from a string literal in one of the letter modules is a sentence that
     * exists in one language, and it will be added by somebody adding a letter
     * rather than by somebody translating one — which is exactly how these
     * eleven came to be English in the first place.
     *
     * Read off the source, because the point is that the *code* has no prose in
     * it. Quoted words in comments are not letters, so comments come out first.
     */
    const files = [
      'src/mail/reminders.ts',
      'src/mail/signIn.ts',
      'src/mail/compose.ts',
      'src/auth/invitationRoutes.ts',
      'src/jobs/activityDigest.ts',
    ];

    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      // Every letter field that carries prose, and what it must be given.
      for (const field of ['subject', 'heading', 'text', 'label']) {
        const written = [...source.matchAll(new RegExp(`${field}:\\s*(['\`])`, 'g'))];
        assert.equal(
          written.length,
          0,
          `${file} writes a ${field} as a literal rather than from the catalogue`,
        );
      }
    }
  });
});
