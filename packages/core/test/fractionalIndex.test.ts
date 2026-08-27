/**
 * Fractional index tests.
 *
 * These are property tests rather than fixed cases on purpose. A hand-picked
 * example set will happily pass while the algorithm mis-handles magnitude
 * boundaries, and the failure mode in production is silently reordered
 * documents — expensive to notice, worse to diagnose.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareIndex,
  FIRST_INDEX,
  FractionalIndexError,
  generateKeyBetween,
  generateNKeysBetween,
} from '../src/order/fractionalIndex.js';

test('empty list produces the first key', () => {
  assert.equal(generateKeyBetween(null, null), FIRST_INDEX);
});

test('appending produces strictly increasing keys', () => {
  let cursor: string | null = null;
  const keys: string[] = [];
  for (let i = 0; i < 2000; i++) {
    cursor = generateKeyBetween(cursor, null);
    keys.push(cursor);
  }
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1]! < keys[i]!, `not increasing at ${i}: ${keys[i - 1]} !< ${keys[i]}`);
  }
});

test('prepending produces strictly decreasing keys', () => {
  let cursor: string | null = null;
  const keys: string[] = [];
  for (let i = 0; i < 2000; i++) {
    cursor = generateKeyBetween(null, cursor);
    keys.push(cursor);
  }
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1]! > keys[i]!, `not decreasing at ${i}`);
  }
});

test('repeated insertion at the same gap stays ordered', () => {
  // The adversarial case: always insert between the first two elements.
  let a = generateKeyBetween(null, null);
  let b = generateKeyBetween(a, null);
  for (let i = 0; i < 1000; i++) {
    const mid = generateKeyBetween(a, b);
    assert.ok(a < mid && mid < b, `midpoint out of range at ${i}: ${a} ${mid} ${b}`);
    b = mid;
  }
  assert.ok(a < b);
});

test('random insertions keep the list sorted', () => {
  // Deterministic PRNG so a failure is reproducible from the seed.
  let seed = 0x2545f491;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return Math.abs(seed) / 0x7fffffff;
  };

  const list: string[] = [generateKeyBetween(null, null)];
  for (let i = 0; i < 3000; i++) {
    const at = Math.floor(rand() * (list.length + 1));
    const before = at === 0 ? null : list[at - 1]!;
    const after = at === list.length ? null : list[at]!;
    const key = generateKeyBetween(before, after);
    list.splice(at, 0, key);
  }

  const sorted = [...list].sort();
  assert.deepEqual(list, sorted, 'insertion order diverged from sort order');
  assert.equal(new Set(list).size, list.length, 'duplicate keys generated');
});

test('generateNKeysBetween returns count keys in order', () => {
  for (const count of [1, 2, 3, 7, 50, 200]) {
    const keys = generateNKeysBetween(null, null, count);
    assert.equal(keys.length, count, `wrong count for ${count}`);
    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i - 1]! < keys[i]!, `unordered at ${i} for count=${count}`);
    }
  }
});

test('generateNKeysBetween respects both bounds', () => {
  const a = generateKeyBetween(null, null);
  const b = generateKeyBetween(a, null);
  const keys = generateNKeysBetween(a, b, 100);
  assert.equal(keys.length, 100);
  assert.ok(keys[0]! > a);
  assert.ok(keys[99]! < b);
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1]! < keys[i]!);
  }
});

test('key length grows slowly, not linearly', () => {
  // 10k sequential appends must not produce pathologically long keys, or
  // index size and comparison cost degrade.
  let cursor: string | null = null;
  for (let i = 0; i < 10_000; i++) cursor = generateKeyBetween(cursor, null);
  assert.ok(cursor!.length <= 8, `key grew to ${cursor!.length} chars: ${cursor}`);
});

test('there is always room to insert before any generated key', () => {
  // This is the property the "no trailing lowest digit" rule exists to
  // guarantee. Testing the rule directly is wrong: an integer-only key such
  // as 'b00' legitimately ends in '0' because the fractional part is empty.
  let cursor: string | null = null;
  for (let i = 0; i < 500; i++) {
    cursor = generateKeyBetween(cursor, null);
    const before = generateKeyBetween(null, cursor);
    assert.ok(before < cursor, `no room before ${cursor}: got ${before}`);
  }
});

test('rejects inverted bounds', () => {
  const a = generateKeyBetween(null, null);
  const b = generateKeyBetween(a, null);
  assert.throws(() => generateKeyBetween(b, a), FractionalIndexError);
  assert.throws(() => generateKeyBetween(a, a), FractionalIndexError);
});

test('rejects malformed keys', () => {
  for (const bad of ['', '!', 'a', 'a0!', 'x'.repeat(3) + '\u00ff']) {
    assert.throws(
      () => generateKeyBetween(bad, null),
      FractionalIndexError,
      `should reject ${JSON.stringify(bad)}`,
    );
  }
});

test('concurrent inserts into the same gap produce identical keys', () => {
  // Important and easy to get wrong: the algorithm is deterministic, so two
  // offline clients inserting into the same gap generate the SAME key. They
  // do not conflict — both blocks exist after the merge — but their order is
  // then a tie.
  //
  // Consequence for the rest of the system: every sibling sort must be
  // (idx, id), never idx alone. Otherwise two clients render the same
  // document in different orders. Enforced in the materialiser's ORDER BY
  // and asserted below.
  const a = generateKeyBetween(null, null);
  const c = generateKeyBetween(a, null);

  const clientOne = generateKeyBetween(a, c);
  const clientTwo = generateKeyBetween(a, c);

  assert.equal(clientOne, clientTwo, 'expected deterministic midpoint');
  assert.ok(a < clientOne && clientOne < c);

  // With id as the tie-breaker the merged order is total and stable.
  const merged = [
    { idx: a, id: 'aaa' },
    { idx: clientOne, id: 'bbb' },
    { idx: clientTwo, id: 'ccc' },
    { idx: c, id: 'ddd' },
  ];
  const sorted = [...merged].sort(
    (x, y) => compareIndex(x.idx, y.idx) || compareIndex(x.id, y.id),
  );
  assert.deepEqual(
    sorted.map((e) => e.id),
    ['aaa', 'bbb', 'ccc', 'ddd'],
  );
});
