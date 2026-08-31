/**
 * The account menu at the foot of the sidebar.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('one mark opens a menu instead of four icons in a row', () => {
  // Four icons asked somebody to learn four symbols for things they use rarely,
  // and the row grew every time the account gained a page. Behind the face
  // there is room for names, which is what these entries are told apart by.
  assert.match(sidebar, /aria-haspopup="menu"/);
  for (const entry of ['Your settings', 'This workspace', 'Trash', 'Sign out']) {
    assert.match(sidebar, new RegExp(entry));
  }
});

test('the three areas are three entries, and one of them is conditional', () => {
  // "Edit your profile" and "Settings" both landed on the same page — a choice
  // that is not one (ADR-0032). And administration is absent rather than
  // present and refusing.
  assert.doesNotMatch(sidebar, /Edit your profile/);
  assert.match(sidebar, /href=\{paths\.settings\(\)\}/);
  assert.match(sidebar, /href=\{paths\.workspaceSettings\(\)\}/);
  assert.match(sidebar, /\{\(isInstanceAdmin \|\| canManageWorkspaces\) && \(/);
});

test('signing out is last and set apart', () => {
  // The one entry here that pressing again does not undo.
  const out = sidebar.indexOf('Sign out');
  const trash = sidebar.indexOf('>\n                Trash');
  assert.ok(out > trash);
  assert.match(css, /\.sidebar-account-menu button \{[^}]*border-block-start: 1px solid/);
});

test('the menu opens upwards', () => {
  // The button it hangs from is always at the bottom of the window.
  assert.match(css, /\.sidebar-account-menu \{[^}]*inset-block-end: calc\(100% \+/);
});
