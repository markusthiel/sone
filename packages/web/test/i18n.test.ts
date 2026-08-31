/**
 * The interface's own language (ADR-0041).
 *
 * Two jobs. The formatter has to be right, because a plural rule nobody checks is
 * a sentence that reads as broken in half the languages this is meant for. And
 * the migration has to hold: the list at the bottom is the files that have been
 * translated, and it may only grow.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { formatMessage } from '../src/i18n/format.ts';
import { resolveLocale } from '../src/i18n/useT.tsx';
import { en } from '../src/i18n/messages.en.ts';
import { de } from '../src/i18n/messages.de.ts';

// --- the formatter --------------------------------------------------------

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

// --- the catalogues -------------------------------------------------------

test('every English key has a German one', () => {
  // Typed as well, so this is belt to that braces — but a type error is only
  // seen by whoever runs the check, and this is seen by whoever runs the tests.
  for (const key of Object.keys(en)) {
    assert.ok(key in de, `${key} is missing from the German catalogue`);
    assert.notEqual((de as Record<string, string>)[key], '', `${key} is empty`);
  }
});

test('the German catalogue has no keys of its own', () => {
  // English is the source: a key here and not there is a translation of
  // something nothing renders.
  for (const key of Object.keys(de)) {
    assert.ok(key in en, `${key} is not in the English catalogue`);
  }
});

test('a plural in English is a plural in German', () => {
  // A translator dropping the branch is the failure this catches: the German
  // sentence then reads correctly for one entry and wrongly for two.
  for (const [key, message] of Object.entries(en)) {
    if (!message.includes(', plural,')) continue;
    assert.match(
      (de as Record<string, string>)[key] ?? '',
      /, plural,/,
      `${key} is a plural in English and not in German`,
    );
  }
});

// --- the form of address (ADR-0041) --------------------------------------

test('a German message branches on the form of address where it needs to', () => {
  // "du" or "Sie", chosen by the instance. A `select` inside the message rather
  // than a second German catalogue, which would be every string twice and would
  // drift.
  const settings = de['account.yourSettings'];
  assert.equal(formatMessage(settings, { address: 'informal' }, 'de'), 'Deine Einstellungen');
  assert.equal(formatMessage(settings, { address: 'formal' }, 'de'), 'Ihre Einstellungen');
});

test('no German message addresses somebody without a branch', () => {
  // The failure this catches: a translator writes "du" into a new message, an
  // instance is set to "Sie", and one sentence in five is suddenly familiar.
  // Words are matched whole, so "Dateien" is not a "die"-form and "Sie" inside a
  // formal branch is exactly where it belongs.
  const familiar = /\b(du|dich|dir|dein|deine|deiner|deinen|deinem|deines)\b/i;
  for (const [key, message] of Object.entries(de)) {
    if (!familiar.test(message)) continue;
    assert.match(
      message,
      /\{address, select,/,
      `${key} uses a familiar form without branching on the form of address`,
    );
  }
});

test('the informal branch is the default one', () => {
  // `other` rather than `informal`, so a language with no such distinction needs
  // no branch at all and a message with a branch still renders when nothing is
  // passed.
  for (const message of Object.values(de)) {
    if (!message.includes('{address, select,')) continue;
    assert.match(message, /other \{/);
    assert.notEqual(formatMessage(message, {}, 'de'), '');
  }
});

// --- resolving the locale -------------------------------------------------

test('the person comes before the workspace, and the browser last', () => {
  // A workspace has one language and its members need not share it, which is the
  // whole reason both fields exist.
  assert.equal(resolveLocale('de', 'en', ['en']), 'de');
  assert.equal(resolveLocale(null, 'de', ['en']), 'de');
  assert.equal(resolveLocale(null, null, ['de-DE', 'en']), 'de');
  // A region is dropped: a catalogue is per language until somebody has a reason
  // to split it.
  assert.equal(resolveLocale('de-AT', null, []), 'de');
  // Nothing we have falls back to English rather than to the first thing asked
  // for.
  assert.equal(resolveLocale('fr', null, ['ja']), 'en');
  assert.equal(resolveLocale(null, null, []), 'en');
});

// --- the migration --------------------------------------------------------

/**
 * Files that have been translated.
 *
 * This list may only grow. A thousand strings across sixty components cannot be
 * migrated in one commit, and the alternative — migrate everything, then add the
 * test — leaves a half-migrated codebase with nothing stopping the next component
 * arriving in English. Which is how a translation effort dies.
 */
const MIGRATED = [
  'src/components/AccountMenu.tsx',
  'src/components/MoveToWorkspaceDialog.tsx',
  'src/components/EntryMenu.tsx',
  'src/components/Sidebar.tsx',
  'src/components/SettingsShell.tsx',
  'src/components/WorkspaceSettingsScreen.tsx',
  'src/components/Trash.tsx',
  'src/components/Search.tsx',
  'src/components/RightSidebar.tsx',
  'src/components/ViewRules.tsx',
];

test('every error code the client can show has a message', () => {
  // The table moved out of Auth.tsx into the catalogue, which is where a
  // translated one has to live (ADR-0041). Nothing may be dropped in the move:
  // an error code with no message shows "Something went wrong", which is true
  // and useless.
  const client = readFileSync(new URL('../src/api/client.ts', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../src/components/Auth.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(auth, /const MESSAGES/, 'the old table is gone');

  // The codes this client raises itself, as opposed to the ones the server
  // sends: those are the ones a test can enumerate.
  const raised = new Set(
    [...client.matchAll(/'(proxy_rejected_size|proxy_error|network_error|unexpected_response)'/g)].map(
      ([, code]) => code,
    ),
  );
  for (const code of raised) {
    // `unexpected_response` is deliberately absent — it means a proxy replaced
    // the body, and `proxy_error` is what the reader is shown for it.
    if (code === 'unexpected_response') continue;
    assert.ok(`error.${code}` in en, `error.${code} is missing`);
  }
});

test('a migrated file has no English left in its markup', () => {
  for (const file of MIGRATED) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

    // Text between tags: `>Sign out<`. Anything with two letters in a row and no
    // braces is a sentence somebody forgot.
    const literals = [...source.matchAll(/>\s*([A-Za-z][A-Za-z ,.'’—-]{3,})\s*</g)].map(
      ([, text]) => text.trim(),
    );
    assert.deepEqual(literals, [], `${file} still has literal text: ${literals.join(' | ')}`);

    // And the attributes people read: a title or an aria-label in English is
    // invisible to a screenshot and perfectly visible to a screen reader.
    // The attribute name has to stand alone: `data-placeholder="true"` is not a
    // placeholder anybody reads, and matching it made the guard cry wolf on its
    // first real use.
    const attributes = [
      ...source.matchAll(/(?<![\w-])(?:title|aria-label|placeholder)="([^"]{4,})"/g),
    ].map(([, text]) => text);
    assert.deepEqual(attributes, [], `${file} has literal attributes: ${attributes.join(' | ')}`);
  }
});
