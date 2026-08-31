/**
 * The profile picture (ADR-0029).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));
// The face moved into AccountMenu, which every column with a footer now uses.
const sidebar = codeOf(new URL('../src/components/AccountMenu.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('a picture is shrunk before it is sent, and hard', () => {
  // A photograph from a phone is eight megabytes for something drawn at 22
  // pixels. No original is kept, because nothing would ever show it.
  assert.match(settings, /webVariant\(chosen, AVATAR_BOUND\)/);
});

test('a missing picture is the ordinary case, not an error', () => {
  // Most accounts have none. The initial stands in, and a request that 404s is
  // cheaper than one that asks whether to make it.
  assert.match(sidebar, /onError=\{\(\) => setAvatarBroken\(true\)\}/);
  assert.match(sidebar, /displayName\.trim\(\)\.charAt\(0\)\.toUpperCase\(\)/);
});

test('the row keeps its height whether or not there is a picture', () => {
  // Otherwise it changes as one arrives, and something shifts under the
  // pointer of whoever is about to click.
  assert.match(css, /\.sidebar-avatar img,\s*\n\.account-avatar img \{[^}]*object-fit: cover/);
});

test('choosing one reloads rather than patching the copy on screen', () => {
  // The face appears in the sidebar and beside every block its owner wrote.
  assert.match(settings, /await api\.setAvatar\(small \?\? chosen\)/);
  assert.match(settings, /setAvatar[\s\S]{0,200}?window\.location\.reload\(\)/);
});
