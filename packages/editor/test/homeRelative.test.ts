/**
 * One shape for a link that points home (ADR-0177).
 *
 * ADR-0173 named this and left it:
 *
 * > **Normalise a pasted absolute address to a relative one.** It would make
 * > every internal link in a document one shape, including the ones pasted from
 * > the handle menu's clipboard. Worth doing and not here: it changes what is
 * > stored for every link anybody pastes, which is a round of its own.
 *
 * The two shapes are not equally good. `normaliseHref` has said why since
 * ADR-0157 — *"a relative link within this instance is legitimate and should
 * stay relative, so a shared page keeps working behind a different host"* — and
 * then took an absolute one exactly as it arrived, which is the same sentence
 * failing to apply to the address the handle menu produces.
 *
 * And the handle menu's is absolute on purpose: it goes to the clipboard, where
 * a bare path is not an address (ADR-0170). So the *most likely* way to make an
 * internal link was also the one way to store the host in the document.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { homeRelative } from '../src/hrefs.js';

const ORIGIN = 'https://sone.example';
const PAGE = '/p/00000000-0000-4000-8000-000000000001/satzung';

test('an address pointing home loses the host', () => {
  assert.equal(homeRelative(`${ORIGIN}${PAGE}`, ORIGIN), PAGE);
});

test('and keeps everything after it', () => {
  // The fragment names a block (ADR-0170) and the query is nobody's to drop.
  assert.equal(homeRelative(`${ORIGIN}${PAGE}#b-abc`, ORIGIN), `${PAGE}#b-abc`);
  assert.equal(homeRelative(`${ORIGIN}/search?q=satzung`, ORIGIN), '/search?q=satzung');
});

test('an address that is already relative is left exactly as it is', () => {
  assert.equal(homeRelative(PAGE, ORIGIN), PAGE);
  assert.equal(homeRelative('/', ORIGIN), '/');
});

test('a link out of the instance is untouched', () => {
  assert.equal(homeRelative('https://example.org/p/x', ORIGIN), 'https://example.org/p/x');
  assert.equal(homeRelative('mailto:markus@example.org', ORIGIN), 'mailto:markus@example.org');
});

test('and so is one that only looks like ours', () => {
  /*
   * `//sone.example.evil/p/x` is protocol-relative and resolves to another
   * host while reading like a path — the shape `isSameOrigin` is parsed rather
   * than compared as text to catch, and the reason this asks it rather than
   * testing the string itself.
   */
  assert.equal(
    homeRelative('https://sone.example.evil/p/x', ORIGIN),
    'https://sone.example.evil/p/x',
  );
  assert.equal(homeRelative('//evil.example/p/x', ORIGIN), '//evil.example/p/x');
});

test('an address that executes is not made relative', () => {
  // It has no origin at all, so it cannot be ours — and the door that refuses
  // it is a different one, asked before this (ADR-0157).
  assert.equal(homeRelative('javascript:alert(1)', ORIGIN), 'javascript:alert(1)');
});

test('with no origin to compare against, nothing is changed', () => {
  /*
   * Outside a browser there is no `location`, and the one place that reads it
   * answers with the empty string. Nothing is same-origin with that, so the
   * rule simply does not apply — rather than a rule that half-applies where
   * nobody can see it.
   */
  assert.equal(homeRelative(`${ORIGIN}${PAGE}`, ''), `${ORIGIN}${PAGE}`);
});

test('a typed address goes through it', async () => {
  // Door one: `normaliseHref`, which markdown paste also uses — so the two are
  // one door in practice.
  const { normaliseHref } = await import('../src/links.js');
  const links = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/links.ts', import.meta.url), 'utf8'),
  );
  assert.match(links, /homeRelative\(/);
  // And it still refuses what it always refused.
  assert.equal(normaliseHref('javascript:alert(1)'), null);
  assert.equal(normaliseHref('  '), null);
});

test('and so does a pasted one', async () => {
  /*
   * Door two: the schema's `parseDOM`, which cannot import `links.ts` — it is
   * the file `links.ts` imports. That is the whole reason `hrefs.ts` exists,
   * and this is the third rule to live there for it.
   */
  const schema = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/schema.ts', import.meta.url), 'utf8'),
  );
  assert.match(schema, /homeRelative\(href, currentOrigin\(\)\)/);
});

test('the environment is read in one place', async () => {
  // A rule that takes an origin is testable; a rule that reads `window` is not.
  // So the reading is one line, and everything else is a function of its answer.
  const fs = await import('node:fs');
  const hrefs = fs.readFileSync(new URL('../src/hrefs.ts', import.meta.url), 'utf8');
  assert.equal((hrefs.match(/globalThis/g) ?? []).length, 1);
});
