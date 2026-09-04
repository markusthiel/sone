/**
 * The account menu at the foot of the sidebar.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

// The face and its menu live in AccountMenu now, so the settings columns can
// carry the same one — it was only in the sidebar, which is why getting from the
// administration area to your own profile meant going out through the notes.
const sidebar = codeOf(new URL('../src/components/AccountMenu.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('one mark opens a menu instead of four icons in a row', () => {
  // Four icons asked somebody to learn four symbols for things they use rarely,
  // and the row grew every time the account gained a page. Behind the face
  // there is room for names, which is what these entries are told apart by.
  assert.match(sidebar, /aria-haspopup="menu"/);
  // The entries by key rather than by sentence, since this menu is translated
  // (ADR-0041).
  //
  // Fewer than before, and on purpose: workspaces, the inbox and the trash are
  // places, and places are on the rail — and in the sidebar at the width where
  // the rail is not drawn (ADR-0068). What is left is you and the server, which
  // is what a menu behind a face is for.
  for (const key of ['yourSettings', 'signOut']) {
    assert.match(sidebar, new RegExp(`t\\('account\\.${key}'\\)`));
  }
});

test('a mode is in one list, not in the menu as well', () => {
  /*
   * The fault ADR-0067 was amended over, guarded rather than remembered.
   *
   * Three ways into one subject was not an improvement; a rail that repeated
   * the menu would be the same finding with a column around it. So the list
   * lives once, in places.tsx, and is drawn by the rail above 800px and by the
   * sidebar below it — never both at once.
   */
  const places = codeOf(new URL('../src/components/modes.tsx', import.meta.url));
  for (const route of ['workspaces', 'inbox', 'trash']) {
    assert.match(places, new RegExp(`paths\\.${route}\\(\\)`), `${route} is a place`);
    assert.doesNotMatch(
      sidebar,
      new RegExp(`paths\\.${route}\\(\\)`),
      `${route} is not also in the account menu`,
    );
  }
});

test('every entry carries a mark', () => {
  // Icons to break the wall of text up. The settings switcher that used to
  // share three of them is gone (ADR-0069) — the three areas are three groups
  // in one list now, and a group's title is a word rather than a symbol.
  /*
   * `WorkspacesIcon` where `SettingsIcon` was (ADR-0067 amendment).
   *
   * The menu's workspace entry is the list rather than one workspace's
   * settings, so a cog is the wrong mark for it — and `FolderIcon` means a
   * folder in the tree while `UsersIcon` means people, which is why this is its
   * own four-square mark rather than a borrowed one.
   */
  for (const icon of ['PersonIcon', 'SlidersIcon', 'SignOutIcon']) {
    assert.match(sidebar, new RegExp(`<${icon} />`), `${icon} is in the menu`);
  }
  // The marks that moved with their entries kept their entries' marks: the
  // rule is one subject, one symbol, and it does not care which list the
  // subject is in.
  const places = codeOf(new URL('../src/components/modes.tsx', import.meta.url));
  for (const icon of ['WorkspacesIcon', 'TrashIcon', 'BellIcon']) {
    assert.match(places, new RegExp(`<${icon} />`), `${icon} is with its place`);
  }
  // And search is in neither list: it has the labelled row above the tree, at
  // both widths, which is the more findable of the two ways it could have had.
  const tree = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.match(tree, /className="sidebar-search"/);
  assert.doesNotMatch(places, /paths\.search\(\)/);


  // A person, not people: "your settings" and "the people in this workspace" are
  // different subjects.
  const icons = codeOf(new URL('../src/components/icons.tsx', import.meta.url));
  assert.match(icons, /export function PersonIcon/);
  assert.notEqual(
    icons.indexOf('export function PersonIcon'),
    icons.indexOf('export function UsersIcon'),
  );
});

test('the three areas are three entries, and one of them is conditional', () => {
  /*
   * The workspace entry is the list now, not "this workspace" (ADR-0067
   * amendment).
   *
   * There were briefly both, which made the menu worse rather than better while
   * a duplicate screen was being removed — two entries for one subject is the
   * thing the record set out to end. The list is the way in and the workspace
   * being looked at is first in it.
   */
  // "Edit your profile" and "Settings" both landed on the same page — a choice
  // that is not one (ADR-0032). And administration is absent rather than
  // present and refusing.
  // Translated now (ADR-0041), so the entries are keys rather than sentences.
  assert.doesNotMatch(sidebar, /Edit your profile/);
  assert.match(sidebar, /t\('account\.yourSettings'\)/);
  assert.match(sidebar, /href=\{paths\.settings\(\)\}/);
  // Neither entry for the workspace subject is here now: the list is a place
  // (ADR-0068), and the shortcut to the current one is its first row.
  assert.doesNotMatch(sidebar, /href=\{paths\.workspaceSettings\(\)\}/);
  // One flag now, decided by whoever renders the menu: the sidebar combines the
  // two rights, and a settings column passes the one it already computed.
  assert.match(sidebar, /\{canAdminister && \(/);
  // Decided by whoever renders the menu. The shell builds it once in App and
  // hands it to the rail or to the panel's foot (ADR-0069), so the flag is
  // computed there rather than inside the column.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(
    app,
    /canAdminister=\{session\.user\.isInstanceAdmin \|\| session\.user\.canManageWorkspaces\}/,
  );
});

test('signing out is last and set apart', () => {
  // The one entry here that pressing again does not undo.
  const out = sidebar.indexOf("t('account.signOut')");
  const settings = sidebar.indexOf("t('account.yourSettings')");
  assert.ok(settings >= 0, 'the entry it has to come after is still here');
  assert.ok(out > settings);
  assert.match(css, /\.sidebar-account-menu button \{[^}]*border-block-start: 1px solid/);
});

test('the menu opens upwards', () => {
  // The button it hangs from is always at the bottom of the window.
  assert.match(css, /\.sidebar-account-menu \{[^}]*inset-block-end: calc\(100% \+/);
});
