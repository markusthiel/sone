/**
 * The interface's own language (ADR-0041).
 *
 * Two jobs. The catalogues have to agree — every key in both, and every plural
 * still a plural after translation. And the migration has to hold: the list at
 * the bottom is the files that have been translated, and it may only grow.
 *
 * The formatter itself moved to `@sone/core` with its tests (ADR-0133): the
 * mails format with it now too, and it was never about the web.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { formatMessage } from '@sone/core';
import { readableStrings } from './helpers/readable.ts';
import { LANGUAGE_NAMES, LOCALES, resolveLocale } from '../src/i18n/useT.tsx';
import { en } from '../src/i18n/messages.en.ts';
import { de } from '../src/i18n/messages.de.ts';

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

/**
 * Words that read the same in every language.
 *
 * A brand is a name, a protocol is a name, and a command somebody pastes into a
 * shell is neither prose nor ours to translate. Each is listed with the file it
 * is in, and a second test refuses one that has stopped being used — an
 * exception nobody can find any more is how a list of exceptions turns into a
 * list of excuses.
 */
const SAME_IN_EVERY_LANGUAGE = [
  // How a mail server is reached, with the port people look for (Admin).
  'STARTTLS (587)',
  'TLS (465)',
  // A command to paste into a shell, which is not ours to translate (Admin).
  'docker exec -u 0 &lt;container&gt; chown -R 10001:10001 /var/lib/sone',
];

/*
 * Seven names left this list while it was being written, and that is the
 * interesting part of it.
 *
 * `YouTube`, `Vimeo`, `PeerTube`, `HLS` and `DASH` were listed because they sat
 * in the markup as English words. They are values now — the sentence around
 * them is a message and the name is passed into it — so nothing about them is
 * exempt any more; they simply are not text this file wrote.
 * `SONE_OIDC_CLIENT_SECRET` and the callback path went the same way, into the
 * sentences that name them.
 *
 * **An exception that disappears when the code is written properly was never an
 * exception.** Which is what the test below is for.
 */

test('the guard sees every shape a string can reach the screen in', () => {
  /*
   * The fixture is the thing this has to catch, and three of its shapes are
   * there because they were missed once each (ADR-0148). A guard that has never
   * been shown a string it must find is a guard nobody has tested — which is
   * how the same file sat on the migrated list, reported clean, with eight
   * English strings in it.
   */
  const fixture = readFileSync(
    new URL('./helpers/readable.fixture.tsx', import.meta.url),
    'utf8',
  );
  const found = readableStrings(fixture).map((one) => one.text);

  assert.deepEqual(found.sort(), [
    'A sentence written across two lines.',
    'Close the panel',
    'Do the thing',
    'More than one',
    'No name yet',
    'Outline',
    'Something switchable',
    'Working…',
    // A template is reported with its holes replaced, so what is read is the
    // words somebody wrote and not the expression between them.
    '… things counted',
  ].sort());
});

test('a migrated file has no English left in its markup', () => {
  const left: string[] = [];

  for (const file of MIGRATED) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const one of readableStrings(source, file)) {
      if (SAME_IN_EVERY_LANGUAGE.includes(one.text)) continue;
      left.push(`${file}:${one.line} ${one.kind} — ${one.text}`);
    }
  }

  assert.deepEqual(left, [], `English left on migrated screens:\n${left.join('\n')}`);
});

test('every exception is still an exception somebody can find', () => {
  // A name that has left the tree is a line that outlives its reason, and the
  // next reader takes the list for a policy rather than for ten decisions.
  const unused = SAME_IN_EVERY_LANGUAGE.filter((word) =>
    MIGRATED.every((file) => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      return !readableStrings(source, file).some((one) => one.text === word);
    }),
  );
  assert.deepEqual(unused, [], 'listed as untranslatable and no longer anywhere');
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
