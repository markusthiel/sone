/**
 * What a password hash costs, and why that is configurable (ADR-0010).
 *
 * Created by appending to a file that did not exist, which is how it briefly
 * had no imports at all — `>>` makes a file as readily as it extends one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RECOMMENDED_COST,
  hashPassword,
  passwordCost,
  verifyPassword,
} from '../src/auth/password.js';

test('the cost comes from configuration, and a hash carries what it was made with', () => {
  // Measured while asking why the suite no longer finishes in one command: a
  // hash at 2^16 costs 216 ms here, and one test file registers 105 accounts
  // through the real route. 2^12 took it from 45.3 s to 20.3 s (ADR-0010).
  assert.equal(RECOMMENDED_COST, 16);
  // The suite itself runs at 2^12, set in the open in its test script.
  assert.equal(passwordCost(), 12, 'the tests lower it deliberately');
});

test('a hash made cheaply asks to be upgraded', async () => {
  /*
   * The property that makes a configurable cost safe rather than a backdoor: a
   * stored hash records its own N, and verification compares it with the
   * *current* setting. Raising the cost again upgrades every password on its
   * owner's next sign-in rather than stranding it.
   */
  const stored = await hashPassword('ein gutes Passwort');
  assert.match(stored, /^scrypt\$4096\$/, 'the parameters are in the hash');

  const cheap = await verifyPassword('ein gutes Passwort', stored);
  assert.equal(cheap.valid, true);
  assert.equal(cheap.needsRehash, false, 'not against the setting in force');

  // And the same hash, judged against a stronger setting, asks to be redone.
  const previous = process.env['SONE_PASSWORD_COST'];
  process.env['SONE_PASSWORD_COST'] = '16';
  try {
    const strict = await verifyPassword('ein gutes Passwort', stored);
    assert.equal(strict.valid, true, 'still the right password');
    assert.equal(strict.needsRehash, true, 'and worth rehashing');
  } finally {
    if (previous === undefined) delete process.env['SONE_PASSWORD_COST'];
    else process.env['SONE_PASSWORD_COST'] = previous;
  }
});
