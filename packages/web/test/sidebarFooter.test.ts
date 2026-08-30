/**
 * The row of tools at the foot of the sidebar.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('the footer is marks, not sentences', () => {
  // Three lines of text there read as three more places to go, competing with
  // the pages above them — which are why somebody is looking at this column.
  assert.doesNotMatch(sidebar, />\s*Sign out\s*</);
  assert.doesNotMatch(sidebar, /<TrashIcon \/> Trash/);
  assert.match(css, /\.sidebar-footer \{[^}]*display: flex/);
});

test('every mark says what it is for', () => {
  // On the control rather than beside it: an icon nobody has met yet is a
  // guess, and a guess about "sign out" is an expensive one.
  for (const label of ['Trash', 'Settings', 'Sign out']) {
    assert.match(sidebar, new RegExp(`aria-label="${label}"`));
  }
  assert.match(sidebar, /aria-label=\{`\$\{displayName\} — your account`\}/);
});

test('the account entry carries the person, not a symbol', () => {
  // It is the one of the four that is about them rather than about the
  // instance.
  assert.match(sidebar, /displayName\.trim\(\)\.charAt\(0\)\.toUpperCase\(\)/);
});

test('the version is pushed aside rather than lined up with the tools', () => {
  // It is a fact about the build, not something to press.
  assert.match(css, /\.sidebar-version \{[^}]*margin-inline-start: auto/);
});
