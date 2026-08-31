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
  // (ADR-0041). What is asserted is unchanged: one mark, four names behind it.
  for (const key of ['yourSettings', 'thisWorkspace', 'trash', 'signOut']) {
    assert.match(sidebar, new RegExp(`t\\('account\\.${key}'\\)`));
  }
});

test('every entry carries a mark, and the areas share theirs with the switcher', () => {
  // Icons to break the wall of text up, and the same three symbols the settings
  // switcher uses for the same three areas: one subject, one symbol, or somebody
  // learns two of them for the same thing.
  for (const icon of ['PersonIcon', 'SettingsIcon', 'SlidersIcon', 'TrashIcon', 'SignOutIcon']) {
    assert.match(sidebar, new RegExp(`<${icon} />`), `${icon} is in the menu`);
  }

  const shell = codeOf(new URL('../src/components/SettingsShell.tsx', import.meta.url));
  assert.match(shell, /Icon: PersonIcon/);
  assert.match(shell, /Icon: SettingsIcon/);
  assert.match(shell, /Icon: SlidersIcon/);

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
  // "Edit your profile" and "Settings" both landed on the same page — a choice
  // that is not one (ADR-0032). And administration is absent rather than
  // present and refusing.
  // Translated now (ADR-0041), so the entries are keys rather than sentences.
  assert.doesNotMatch(sidebar, /Edit your profile/);
  assert.match(sidebar, /t\('account\.yourSettings'\)/);
  assert.match(sidebar, /t\('account\.thisWorkspace'\)/);
  assert.match(sidebar, /href=\{paths\.settings\(\)\}/);
  assert.match(sidebar, /href=\{paths\.workspaceSettings\(\)\}/);
  // One flag now, decided by whoever renders the menu: the sidebar combines the
  // two rights, and a settings column passes the one it already computed.
  assert.match(sidebar, /\{canAdminister && \(/);
  const sidebarFile = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.match(sidebarFile, /canAdminister=\{isInstanceAdmin \|\| canManageWorkspaces\}/);
});

test('signing out is last and set apart', () => {
  // The one entry here that pressing again does not undo.
  const out = sidebar.indexOf("t('account.signOut')");
  const trash = sidebar.indexOf("t('account.trash')");
  assert.ok(out > trash);
  assert.match(css, /\.sidebar-account-menu button \{[^}]*border-block-start: 1px solid/);
});

test('the menu opens upwards', () => {
  // The button it hangs from is always at the bottom of the window.
  assert.match(css, /\.sidebar-account-menu \{[^}]*inset-block-end: calc\(100% \+/);
});
