/**
 * The interface's own language (ADR-0041).
 *
 * Two jobs. The formatter has to be right, because a plural rule nobody checks is
 * a sentence that reads as broken in half the languages this is meant for. And
 * the migration has to hold: the list at the bottom is the files that have been
 * translated, and it may only grow.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { formatMessage } from '../src/i18n/format.ts';
import { LANGUAGE_NAMES, LOCALES, resolveLocale } from '../src/i18n/useT.tsx';
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

  /*
   * Keys that *name* a form of address rather than using one.
   *
   * The setting's own options are "du" and "Sie" — the word is the label, not the
   * reader being addressed, and branching there would produce "Vertraut — Sie".
   * An exemption with a reason rather than a looser pattern: a pattern that let
   * these through would let a real one through as well.
   */
  const naming = new Set(['admin.addressForm.informal', 'admin.addressForm.formal']);

  for (const [key, message] of Object.entries(de)) {
    if (naming.has(key)) continue;
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
  'src/components/SectionNav.tsx',
  'src/components/Settings.tsx',
  'src/components/WorkspaceSettingsScreen.tsx',
  'src/components/Trash.tsx',
  'src/components/Search.tsx',
  'src/components/RightSidebar.tsx',
  'src/components/ViewRules.tsx',
  'src/components/AdminScreen.tsx',
  'src/components/Admin.tsx',
  'src/components/CollectionTable.tsx',
  'src/components/BlockMenu.tsx',
  'src/components/Auth.tsx',
  'src/components/ShareDialog.tsx',
  'src/components/ThemeSettings.tsx',
  'src/components/LandingSettings.tsx',
  'src/components/WorkspaceAppearance.tsx',
  'src/components/FolderView.tsx',
  'src/components/MoveDialog.tsx',
  'src/components/InvitePanel.tsx',
  'src/components/PendingInvitations.tsx',
  'src/components/WorkspaceInvite.tsx',
  'src/components/GroupsPanel.tsx',
  'src/components/PagePermissions.tsx',
  'src/components/OidcPanel.tsx',
  'src/components/WorkspaceMembers.tsx',
  'src/components/TagEditor.tsx',
  'src/components/AcceptInvitation.tsx',
  'src/components/CollectionBoard.tsx',
  'src/components/CollectionGallery.tsx',
  'src/components/OptionEditor.tsx',
  'src/components/PageView.tsx',
  'src/components/SelectionToolbar.tsx',
  'src/components/SlashMenu.tsx',
  'src/components/TableToolbar.tsx',
  'src/components/VideoDialog.tsx',
  // WorkspaceDetail.tsx was here; it is gone (ADR-0067) and its sections live in
  // WorkspaceSettingsScreen, which is on this list already.
  'src/components/WorkspaceList.tsx',
  'src/components/WorkspaceMenu.tsx',
  'src/components/CanvasSurface.tsx',
  'src/components/AddEntryMenu.tsx',
  'src/components/CommentsPanel.tsx',
  'src/components/HistoryPanel.tsx',
  'src/components/VersionView.tsx',
  'src/components/ExportDialog.tsx',
  'src/components/ImportDialog.tsx',
  'src/components/WorkspaceExport.tsx',
  'src/components/InboxScreen.tsx',
  'src/components/VersionDiff.tsx',
];

/**
 * Not on the list, and not an oversight.
 *
 * `ErrorBoundary` is a class component — React hooks cannot be called from one,
 * and this is the component that catches a render-time throw, so it must not
 * depend on a context that might be the thing that failed. Its one visible
 * string stays English.
 */
const NOT_TRANSLATABLE = ['src/components/ErrorBoundary.tsx'];

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

test('the language is resolved above every screen, including sign-in', () => {
  // The sign-in and setup screens have no session to ask, so they take the
  // instance's own negotiation of Accept-Language — which the server had been
  // doing all along and nothing was using. Before this they were outside the
  // provider entirely and could not be translated at all.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /instance\?\.suggestedLocale/);
  // One provider, above the branches rather than inside the authenticated one.
  assert.equal([...app.matchAll(/<LocaleProvider/g)].length, 1);
  assert.ok(
    app.indexOf('<LocaleProvider') < app.indexOf("state.status === 'loading'"),
    'the provider wraps the unauthenticated screens too',
  );
});

test('the untranslatable file is named, and it is only the one', () => {
  // A file left out has to be left out on purpose, or "not on the list" becomes
  // the place things hide.
  assert.deepEqual(NOT_TRANSLATABLE, ['src/components/ErrorBoundary.tsx']);
  const boundary = readFileSync(
    new URL('../src/components/ErrorBoundary.tsx', import.meta.url),
    'utf8',
  );
  assert.match(boundary, /extends Component/, 'it is a class, so it has no hooks');
  assert.doesNotMatch(boundary, /useT/);
});

test('a migrated file has no English left in its markup', () => {
  for (const file of MIGRATED) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

    // Text between tags: `>Sign out</span>`. The closing `</` is required, which
    // is what tells JSX text apart from a generic type argument — `new
    // Map<string, CollectionFile>(` matched the looser pattern and reported
    // "new Map" as an untranslated sentence.
    // Newlines are part of the text, which they were not before — and that was
    // the hole. A paragraph written across three lines never matched, so every
    // long explanation in the administration area sat in English with the guard
    // reporting the file clean. The short labels were all it had ever seen.
    const literals = [...source.matchAll(/>\s*([A-Za-z][A-Za-z ,.'’—\-\n]{3,}?)\s*<\//g)]
      .map(([, text]) => text.replace(/\s+/g, ' ').trim())
      // A single word between tags is usually a fragment of prose split by a
      // `<code>` or an `<a>`, and those are reported by the surrounding text.
      .filter((text) => text.includes(' '));
    assert.deepEqual(literals, [], `${file} still has literal text: ${literals.join(' | ')}`);

    // Labels held in a data structure rather than in markup: `label: 'Outline'`
    // in a table of tabs is a heading somebody reads, and the panel's seven were
    // English for a week because this guard only looked at JSX. A key is
    // dotted and lower-case, so a capital letter or a space is the tell.
    const inData = [
      ...source.matchAll(/\b(?:label|hint|title|heading|placeholder):\s*'([^']{4,})'/g),
    ]
      .map(([, text]) => text)
      // A key is dotted and has no spaces — `you.signIn` is a key, `Sign in` is
      // a sentence. Capitals are no help: the keys are camel-cased.
      .filter((text) => /\s/.test(text) || !text.includes('.'));
    assert.deepEqual(inData, [], `${file} has literal labels: ${inData.join(' | ')}`);

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

test('the language can be changed, and changing it does not reload', () => {
  // The catalogue, the resolution and the storage all existed and nothing could
  // reach them: the locale was settable only through the API.
  const settings = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /aria-label=\{t\('you\.language'\)\}/);
  assert.match(settings, /api\.updateProfile\(\{ locale: value === '' \? null : value \}\)/);

  // Applied before it is saved, so the interface answers immediately — and a
  // failed save leaves it in the language that was asked for rather than
  // snapping back mid-sentence.
  const chooser = settings.slice(settings.indexOf('const chooseLanguage'));
  assert.ok(
    chooser.indexOf('setLocale') < chooser.indexOf('updateProfile'),
    'applied, then saved',
  );
  assert.doesNotMatch(chooser.slice(0, chooser.indexOf('};')), /location\.reload/);

  // "Match the browser" is the absence of a setting, not a language: somebody
  // moving between a German and an English machine keeps getting each one's own.
  assert.match(settings, /session\.user\.locale \?\? ''/);
  assert.match(settings, /value=""/);
});

test('a language names itself, in its own language', () => {
  // Somebody looking for German is looking for "Deutsch", not for "German"
  // written in a language they are trying to leave — so these are not in the
  // catalogue.
  assert.equal(LANGUAGE_NAMES.de, 'Deutsch');
  assert.equal(LANGUAGE_NAMES.en, 'English');
  for (const code of LOCALES) {
    assert.ok(LANGUAGE_NAMES[code], `${code} names itself`);
  }
});

test('a confirmation is translated, and says what it actually does', () => {
  // These were the last English strings in screens everything else in has been
  // translated — missed because the guard reads JSX text and attributes, and a
  // `window.confirm` argument is neither.
  for (const file of ['App.tsx', 'components/GroupsPanel.tsx']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /window\.confirm\(`/, `${file} builds no string of its own`);
    assert.doesNotMatch(source, /window\.confirm\('/, `${file} passes no literal`);
  }
  // And it says "to the trash", not "delete": the entry is recoverable for
  // thirty days, and a question that overstates the consequence teaches people
  // to distrust the next one.
  const en = readFileSync(new URL('../src/i18n/messages.en.ts', import.meta.url), 'utf8');
  assert.match(en, /'entry\.confirmTrash': 'Move this to the trash\?'/);
});

test('no message is defined and never used', () => {
  // A dead key is a translation somebody maintained for nothing, and it is the
  // sort of debt that only grows: eight were in the catalogue when this was
  // written, from features that had moved on.
  //
  // Keys built from a template — `inbox.${kind}` — cannot be seen literally, so
  // the prefixes those produce are collected and their keys allowed. That is a
  // hole, and a narrow one: it lets a dead `inbox.foo` through and nothing else.
  const en = readFileSync(new URL('../src/i18n/messages.en.ts', import.meta.url), 'utf8');
  const keys = [...en.matchAll(/^ {2}'([\w.]+)':/gm)].map((m) => m[1] ?? '');

  // Every source in the package, walked rather than listed: a list would go
  // stale and this test would then pass by not looking.
  const walk = (dir: URL): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'i18n') continue;
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) out.push(...walk(child));
      else if (/\.tsx?$/.test(entry.name)) out.push(readFileSync(child, 'utf8'));
    }
    return out;
  };
  const code = walk(new URL('../src/', import.meta.url)).join('\n');

  // Only a quoted key counts as a use. My first pass at this counted any quoted
  // string and so mistook the CSS class `entry-icon` for the key `entry.icon`,
  // which hid two of the eight.
  const used = new Set([...code.matchAll(/'([\w.]+)'/g)].map((m) => m[1] ?? ''));
  const templates = [...code.matchAll(/`([\w.]+)\$\{/g)].map((m) => m[1] ?? '');

  const dead = keys.filter(
    (key) => !used.has(key) && !templates.some((prefix) => key.startsWith(prefix)),
  );

  assert.deepEqual(dead, [], 'messages defined and never used');
});
