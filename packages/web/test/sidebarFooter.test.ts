/**
 * The row of tools at the foot of the sidebar.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

// The face and its menu live in AccountMenu now, so the settings columns can
// carry the same one — it was only in the sidebar, which is why getting from the
// administration area to your own profile meant going out through the notes.
const sidebar = codeOf(new URL('../src/components/AccountMenu.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('the footer is one line, not a list of places to go', () => {
  // Three lines of text read as three more destinations competing with the
  // pages above them, which are why somebody is looking at this column. It was
  // then four icons, and is now one mark with a menu behind it — see
  // accountMenu.test.ts for what the menu holds.
  assert.doesNotMatch(sidebar, /<TrashIcon \/> Trash/);
  assert.match(css, /\.sidebar-footer \{[^}]*display: flex/);
});

test('the one mark says what it opens', () => {
  // An icon nobody has met yet is a guess, and this one now leads to signing
  // out among other things.
  // Through the catalogue now (ADR-0041) — and the label still names the person,
  // which is what the message's own parameter is for.
  assert.match(sidebar, /aria-label=\{t\('account\.label', \{ name: displayName \}\)\}/);
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
