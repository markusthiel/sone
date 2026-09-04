/**
 * Where an account stands against the requirement (ADR-0065).
 *
 * The three questions ADR-0063 said were the actual feature — who is exempt,
 * how long, and what happens then — are all here, so this is where they are
 * tested.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GRACE_DAYS,
  reachableWhileBlocked,
  standingOf,
} from '../src/auth/requirement.js';

const off = { required: false, since: '' };
const on = (daysAgo: number) => ({
  required: true,
  since: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
});

const withPassword = { hasSecondFactor: false, hasPassword: true };

test('nothing is asked when the requirement is off', () => {
  assert.deepEqual(standingOf(off, withPassword), { kind: 'fine' });
});

test('nobody is blocked on the day it is switched on', () => {
  /*
   * An instance that locks out whoever was on holiday is an instance whose
   * administrator spends a week removing factors by hand — and each of those
   * removals is the exact act this feature exists to prevent, done under
   * pressure (ADR-0065).
   */
  const standing = standingOf(on(0), withPassword);
  assert.equal(standing.kind, 'grace');
});

test('after the grace period, enrolment is the only way forward', () => {
  assert.deepEqual(standingOf(on(GRACE_DAYS + 1), withPassword), { kind: 'blocked' });
  // And the day before is still grace, so the boundary is where it says.
  assert.equal(standingOf(on(GRACE_DAYS - 1), withPassword).kind, 'grace');
});

test('a single sign-on account is exempt, however long it has been', () => {
  // Requiring TOTP of an account that authenticates elsewhere is a second
  // factor on top of somebody else's first one.
  const provider = { hasSecondFactor: false, hasPassword: false };
  assert.deepEqual(standingOf(on(GRACE_DAYS + 100), provider), { kind: 'fine' });
});

test('an account that has one is fine whatever the dates say', () => {
  const enrolled = { hasSecondFactor: true, hasPassword: true };
  assert.deepEqual(standingOf(on(GRACE_DAYS + 100), enrolled), { kind: 'fine' });
});

test('a broken timestamp gives grace rather than locking everybody out', () => {
  /*
   * The failure that must not be catastrophic. A missing or unparseable `since`
   * is read as *now*, so the worst a corrupted setting costs is fourteen more
   * days — where reading it as "long ago" would lock out an entire instance
   * over a bad string.
   */
  for (const since of ['', 'gestern', 'not-a-date']) {
    const standing = standingOf({ required: true, since }, withPassword);
    assert.equal(standing.kind, 'grace', JSON.stringify(since));
  }
});

test('reading is not reachable while blocked, and enrolling is', () => {
  // The point of a second factor is that a stolen password grants nothing, and
  // a stolen password with read access to a company's notes has granted the
  // thing that mattered.
  assert.equal(reachableWhileBlocked('/api/auth/second-factor/start'), true);
  assert.equal(reachableWhileBlocked('/api/auth/second-factor/confirm'), true);
  assert.equal(reachableWhileBlocked('/api/auth/logout'), true);

  for (const path of ['/api/pages', '/api/workspaces', '/api/search', '/api/favourites']) {
    assert.equal(reachableWhileBlocked(path), false, path);
  }
});
