/**
 * What to call a role (ADR-0143).
 *
 * A workspace has four roles it did not make — owner, admin, member, guest —
 * and any number it did. The four are words this application wrote, so they
 * belong in its catalogues like every other word it wrote. The rest are names
 * somebody typed, and translating one of those would be inventing a German for
 * „Redaktion".
 *
 * **The decision is one line and it was written four ways**, in three
 * components and a helper that skipped it — and not at all in the two letters
 * whose whole subject is a role. So it lives here, once, beside the other
 * things a screen and a letter have to agree about (ADR-0138's `readableSize`).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSystemRole, nameOfRole } from '../src/doc/roles.js';

/** A translator standing in for the two real catalogues. */
const say = (key: 'owner' | 'admin' | 'member' | 'guest'): string =>
  ({ owner: 'Eigentümer', admin: 'Admin', member: 'Mitglied', guest: 'Gast' })[key];

test('a system role is named by the word, not by the row', () => {
  /*
   * The row says "Owner" because a migration typed it in English. That is a
   * seed value, not a name: nobody chose it, and every screen that showed it
   * showed an English word inside a German interface.
   */
  assert.equal(nameOfRole({ key: 'owner', name: 'Owner' }, say), 'Eigentümer');
  assert.equal(nameOfRole({ key: 'guest', name: 'Guest' }, say), 'Gast');
});

test('and the word wins even if the row was renamed', () => {
  // The key is what the code branches on everywhere else (ADR-0102), so it is
  // what decides here too. A workspace that renamed its `owner` row has not
  // changed what an owner is.
  assert.equal(nameOfRole({ key: 'owner', name: 'Chief' }, say), 'Eigentümer');
});

test('a role somebody made keeps the name they typed', () => {
  assert.equal(nameOfRole({ key: null, name: 'Redaktion' }, say), 'Redaktion');
  // `'custom'` is what the member list sends where a role row has no key
  // (ADR-0102). It is not a fifth system role, and translating it would put the
  // word "Custom" where a name belongs.
  assert.equal(nameOfRole({ key: 'custom', name: 'Redaktion' }, say), 'Redaktion');
  assert.equal(isSystemRole('custom'), false);
});

test('and nothing is invented when there is nothing to say', () => {
  // A comment author carries no role (`role: ''`), and a placeholder role would
  // be a claim about somebody — the rule `App` already writes where it builds
  // those rows.
  assert.equal(nameOfRole({ key: '', name: '' }, say), '');
  assert.equal(nameOfRole({ key: null, name: null }, say), '');
});
