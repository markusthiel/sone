/**
 * Formatting a message (ADR-0041, ADR-0133).
 *
 * Here rather than in `packages/web` since the mails got a catalogue of their
 * own: the interface and the letters now format with the same forty lines, and
 * a plural rule that is right in one and wrong in the other is exactly the
 * failure moving it prevents.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatMessage } from '../src/i18n/format.js';

test('a name is substituted, and a missing one stays visible', () => {
  assert.equal(formatMessage('Hello {who}', { who: 'Markus' }), 'Hello Markus');
  // Visible rather than blank: a `{who}` on screen is a bug report, and half a
  // sentence is not.
  assert.equal(formatMessage('Hello {who}', {}), 'Hello {who}');
});

test('plurals use the platform rules, per language', () => {
  const message = '{count, plural, one {# entry} other {# entries}}';
  assert.equal(formatMessage(message, { count: 1 }), '1 entry');
  assert.equal(formatMessage(message, { count: 2 }), '2 entries');
  // Zero is "other" in English and in German, and this is the case a ternary on
  // `=== 1` happens to get right by accident.
  assert.equal(formatMessage(message, { count: 0 }), '0 entries');

  // Polish has three forms in the plural rules, which is the case that cannot be
  // written as a ternary at all.
  const polish = '{count, plural, one {# wpis} few {# wpisy} many {# wpisów} other {# wpisu}}';
  assert.equal(formatMessage(polish, { count: 1 }, 'pl'), '1 wpis');
  assert.equal(formatMessage(polish, { count: 3 }, 'pl'), '3 wpisy');
  assert.equal(formatMessage(polish, { count: 7 }, 'pl'), '7 wpisów');
});

test('an exact branch beats the category', () => {
  // `=0` is how a language says something specific about nothing, and every
  // language has one of those somewhere.
  const message = '{count, plural, =0 {nothing at all} one {# entry} other {# entries}}';
  assert.equal(formatMessage(message, { count: 0 }), 'nothing at all');
  assert.equal(formatMessage(message, { count: 1 }), '1 entry');
});

test('two plurals in one sentence are resolved independently', () => {
  // The German restriction line needs exactly this: a different verb and a
  // different pronoun from the same count.
  const message =
    '{count, plural, one {# Eintrag kommt} other {# Einträge kommen}} an — ' +
    'lies {count, plural, one {ihn} other {sie}}.';
  assert.equal(formatMessage(message, { count: 1 }, 'de'), '1 Eintrag kommt an — lies ihn.');
  assert.equal(formatMessage(message, { count: 4 }, 'de'), '4 Einträge kommen an — lies sie.');
});

test('a select branch chooses on the value', () => {
  const message = '{kind, select, folder {a folder} page {a page} other {an entry}}';
  assert.equal(formatMessage(message, { kind: 'folder' }), 'a folder');
  assert.equal(formatMessage(message, { kind: 'row' }), 'an entry');
});

test('a broken message shows itself rather than vanishing', () => {
  assert.equal(formatMessage('Half {a sentence'), 'Half {a sentence');
});


test('a select branch does not eat the hash of a plural inside it', () => {
  /*
   * **The bug this found.** `#` is the count of a plural, and it was being
   * substituted for a `select` too — using the select's own value. Nothing had
   * ever written one inside a select branch, so it sat there until the German
   * mails put a plural inside `{address, select, …}` and *„Sie haben # Tage"*
   * came out as *„Sie haben formal Tage"*.
   *
   * The interface was one `#` away from the same thing.
   */
  const message =
    '{address, select, ' +
    'formal {{n, plural, one {Sie haben # Tag} other {Sie haben # Tage}}} ' +
    'other {{n, plural, one {Du hast # Tag} other {Du hast # Tage}}}}';

  assert.equal(formatMessage(message, { address: 'formal', n: 3 }, 'de'), 'Sie haben 3 Tage');
  assert.equal(formatMessage(message, { address: 'informal', n: 1 }, 'de'), 'Du hast 1 Tag');
});
