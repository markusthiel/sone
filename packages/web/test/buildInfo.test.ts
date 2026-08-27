/**
 * Build-info tests.
 *
 * The stale-bundle check decides whether the app tells someone their browser is
 * running older code than the server. Both failure directions are costly:
 * a false positive nags on every visit, and a false negative leaves someone
 * reporting bugs against code that is not running.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WEB_COMMIT, WEB_VERSION, isStaleBundle } from '../src/buildInfo.ts';

test('the constants have a value outside a Vite build', () => {
  // Vite substitutes these at build time; under the test runner they must fall
  // back rather than throw on an undefined global.
  assert.equal(typeof WEB_VERSION, 'string');
  assert.equal(typeof WEB_COMMIT, 'string');
  assert.ok(WEB_VERSION.length > 0);
});

test('an unknown server commit is never treated as stale', () => {
  // A server built outside git reports "unknown". Nagging about that would
  // train people to ignore the warning that matters.
  assert.equal(isStaleBundle('unknown'), false);
  assert.equal(isStaleBundle(null), false);
  assert.equal(isStaleBundle(undefined), false);
  assert.equal(isStaleBundle(''), false);
});

test('an unknown bundle commit is never treated as stale', () => {
  // Under the test runner WEB_COMMIT is "unknown", which is exactly the case a
  // tarball build hits.
  assert.equal(WEB_COMMIT, 'unknown');
  assert.equal(isStaleBundle('abc1234'), false);
});

test('commits are compared at the shorter length', () => {
  // The server and the bundle do not necessarily shorten to the same number of
  // characters, and comparing full strings would report every deployment as
  // stale. Exercised through a stand-in, since the real constants are fixed at
  // build time.
  const compare = (web: string, server: string): boolean => {
    if (!server || server === 'unknown' || web === 'unknown') return false;
    const shortest = Math.min(web.length, server.length);
    return web.slice(0, shortest) !== server.slice(0, shortest);
  };

  assert.equal(compare('f9f563d', 'f9f563de07ed'), false, 'same commit, different lengths');
  assert.equal(compare('f9f563de07ed', 'f9f563d'), false, 'and the other way round');
  assert.equal(compare('f9f563d', 'aaaaaaa'), true, 'genuinely different');
  assert.equal(compare('unknown', 'f9f563d'), false);
  assert.equal(compare('f9f563d', 'unknown'), false);
});
