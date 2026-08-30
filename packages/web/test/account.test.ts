/**
 * The account panel.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));

test('the name can be changed, and the page is reloaded after', () => {
  // It appears in the sidebar, in presence, and beside every block somebody
  // wrote. A copy updated here would leave the others saying the old one.
  assert.match(settings, /updateProfile\(\{ displayName: name\.trim\(\) \}\)/);
  assert.match(settings, /window\.location\.reload\(\)/);
});

test('changing a password asks for the current one', () => {
  // Not a formality: a session left open on a shared machine is the ordinary
  // way an account is taken, and without this whoever finds it can lock its
  // owner out in two fields.
  assert.match(settings, /autoComplete="current-password"/);
  assert.match(settings, /current === '' \|\| next\.length < 12/);
});

test('the minimum matches the one the server enforces', () => {
  // A form that accepts eleven characters and a server that refuses them is a
  // form that lies about what it will do.
  assert.match(settings, /At least twelve characters/);
});

test('what cannot be changed says why', () => {
  // An address that is simply displayed reads as an oversight; one that
  // explains itself reads as a decision.
  assert.match(settings, /needs a way to\s*\n?\s*prove the new address is yours/);
});
