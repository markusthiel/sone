/**
 * SONE — fractional indexing.
 *
 * Sibling order is a lexicographically sortable string, never an array
 * position (ADR-0002). Two clients inserting between the same pair of
 * siblings while offline produce different keys that both survive the merge.
 *
 * Implementation notes, because the subtle parts are not obvious:
 *
 * - A key is `integer part` + `fractional part`. The integer part carries a
 *   length header so that keys of different magnitudes still sort correctly
 *   as plain strings: 'a0' < 'a1' < ... < 'b00' < ... Without the header,
 *   '10' would sort before '9'.
 * - Keys never end in the lowest digit ('0'). If they did, there would be no
 *   room to insert between that key and its predecessor without lengthening,
 *   and the invariant that a midpoint always exists would break.
 * - Comparison is ordinary byte-wise string comparison. This is why the
 *   database must use the C collation (see docker-compose.yml): a
 *   locale-aware collation would reorder these keys and scramble documents.
 *
 * Based on the approach described by David Greenspan and used by Figma and
 * Notion. Digit set is base-62, ordered '0'-'9' < 'A'-'Z' < 'a'-'z', which
 * matches ASCII order.
 */

import { asFractionalIndex, type FractionalIndex } from '../types/ids.js';

const DIGITS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length; // 62
const ZERO = DIGITS[0]!;
const MAX_DIGIT = DIGITS[BASE - 1]!;

/** The smallest well-formed key. Used when a list is empty. */
export const FIRST_INDEX = asFractionalIndex('a0');

export class FractionalIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FractionalIndexError';
  }
}

/**
 * Integer-part length headers.
 *
 * 'a'..'z' encode positive magnitudes of 1..26 digits; 'Z'..'A' encode
 * negative magnitudes. The header letter itself sorts before/after
 * correspondingly, which is what makes cross-magnitude comparison work.
 */
function integerPartLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new FractionalIndexError(`invalid order key head: ${JSON.stringify(head)}`);
}

function integerPart(key: string): string {
  const head = key[0];
  if (head === undefined) throw new FractionalIndexError('empty order key');
  const len = integerPartLength(head);
  if (len > key.length) {
    throw new FractionalIndexError(`order key too short: ${JSON.stringify(key)}`);
  }
  return key.slice(0, len);
}

function validate(key: string): void {
  if (key === '') throw new FractionalIndexError('empty order key');
  const int = integerPart(key);
  const frac = key.slice(int.length);
  for (const ch of int.slice(1) + frac) {
    if (!DIGITS.includes(ch)) {
      throw new FractionalIndexError(
        `invalid digit ${JSON.stringify(ch)} in order key ${JSON.stringify(key)}`,
      );
    }
  }
  // Trailing lowest digit would leave no room to insert before it.
  if (frac.endsWith(ZERO)) {
    throw new FractionalIndexError(
      `order key must not end in '${ZERO}': ${JSON.stringify(key)}`,
    );
  }
}

/** Increment the integer part, growing the magnitude when it overflows. */
function incrementInteger(int: string): string | null {
  const head = int[0]!;
  const digits = int.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; i >= 0 && carry; i--) {
    const next = DIGITS.indexOf(digits[i]!) + 1;
    if (next === BASE) {
      digits[i] = ZERO;
    } else {
      digits[i] = DIGITS[next]!;
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');

  // Overflowed: move to the next magnitude.
  if (head === 'z') return null; // exhausted the positive space
  if (head === 'Z') return 'a' + ZERO;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  return nextHead + (nextHead > 'Z' && nextHead < 'a'
    ? ZERO
    : ZERO.repeat(integerPartLength(nextHead) - 1));
}

function decrementInteger(int: string): string | null {
  const head = int[0]!;
  const digits = int.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; i >= 0 && borrow; i--) {
    const next = DIGITS.indexOf(digits[i]!) - 1;
    if (next < 0) {
      digits[i] = MAX_DIGIT;
    } else {
      digits[i] = DIGITS[next]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');

  if (head === 'A') return null; // exhausted the negative space
  if (head === 'a') return 'Z' + MAX_DIGIT;
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  return prevHead + MAX_DIGIT.repeat(integerPartLength(prevHead) - 1);
}

/** Midpoint of two fractional parts, both exclusive of the bounds. */
function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) {
    throw new FractionalIndexError(
      `lower >= upper: ${JSON.stringify(lower)} / ${JSON.stringify(upper)}`,
    );
  }

  // Copy the shared prefix, then work on the first differing position.
  let prefixLen = 0;
  while (
    (upper === null || prefixLen < upper.length) &&
    (lower[prefixLen] ?? ZERO) === (upper?.[prefixLen] ?? undefined)
  ) {
    prefixLen++;
  }
  if (prefixLen > 0) {
    return (
      (upper ?? '').slice(0, prefixLen) +
      midpoint(lower.slice(prefixLen), upper === null ? null : upper.slice(prefixLen))
    );
  }

  const lowerDigit = lower === '' ? 0 : DIGITS.indexOf(lower[0]!);
  const upperDigit = upper === null || upper === '' ? BASE : DIGITS.indexOf(upper[0]!);

  if (upperDigit - lowerDigit > 1) {
    // There is room for a digit strictly between the two.
    return DIGITS[Math.round(0.5 * (lowerDigit + upperDigit))]!;
  }

  if (upper !== null && upper.length > 1) {
    // Bounds are adjacent digits; descend into the upper key.
    return upper.slice(0, 1) + midpoint('', upper.slice(1));
  }

  // Bounds are adjacent and the upper has no more digits: lengthen the lower.
  return DIGITS[lowerDigit]! + midpoint(lower.slice(1), null);
}

/**
 * Generate a key that sorts strictly between `before` and `after`.
 *
 * Pass null for either bound to append to the start or end of a list.
 * `generateKeyBetween(null, null)` returns the first key of an empty list.
 */
export function generateKeyBetween(
  before: FractionalIndex | string | null,
  after: FractionalIndex | string | null,
): FractionalIndex {
  if (before !== null) validate(before);
  if (after !== null) validate(after);
  if (before !== null && after !== null && before >= after) {
    throw new FractionalIndexError(
      `before >= after: ${JSON.stringify(before)} / ${JSON.stringify(after)}`,
    );
  }

  if (before === null && after === null) return FIRST_INDEX;

  if (before === null) {
    // Insert at the head: step the integer part down, or descend below it.
    const int = integerPart(after!);
    const frac = after!.slice(int.length);
    if (frac === '') {
      const dec = decrementInteger(int);
      if (dec === null) {
        throw new FractionalIndexError('order key space exhausted at the head');
      }
      return asFractionalIndex(dec);
    }
    return asFractionalIndex(int + midpoint('', frac));
  }

  if (after === null) {
    // Insert at the tail: step the integer part up.
    const int = integerPart(before);
    const frac = before.slice(int.length);
    const inc = incrementInteger(int);
    if (inc === null) {
      // Cannot grow the integer part; extend the fraction instead.
      return asFractionalIndex(int + midpoint(frac, null));
    }
    return asFractionalIndex(inc);
  }

  const beforeInt = integerPart(before);
  const afterInt = integerPart(after);
  if (beforeInt === afterInt) {
    return asFractionalIndex(
      beforeInt + midpoint(before.slice(beforeInt.length), after.slice(afterInt.length)),
    );
  }

  const inc = incrementInteger(beforeInt);
  if (inc === null) {
    throw new FractionalIndexError('order key space exhausted');
  }
  if (inc < after) return asFractionalIndex(inc);
  return asFractionalIndex(
    beforeInt + midpoint(before.slice(beforeInt.length), null),
  );
}

/**
 * Generate `count` keys spread evenly between the bounds.
 *
 * Used when inserting several blocks at once, or when seeding a document.
 */
export function generateNKeysBetween(
  before: FractionalIndex | string | null,
  after: FractionalIndex | string | null,
  count: number,
): FractionalIndex[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new FractionalIndexError(`count must be a non-negative integer: ${count}`);
  }
  if (count === 0) return [];
  if (count === 1) return [generateKeyBetween(before, after)];

  if (after === null) {
    let cursor = generateKeyBetween(before, null);
    const out = [cursor];
    for (let i = 1; i < count; i++) {
      cursor = generateKeyBetween(cursor, null);
      out.push(cursor);
    }
    return out;
  }

  if (before === null) {
    let cursor = generateKeyBetween(null, after);
    const out = [cursor];
    for (let i = 1; i < count; i++) {
      cursor = generateKeyBetween(null, cursor);
      out.push(cursor);
    }
    return out.reverse();
  }

  // Split at the midpoint and recurse, which keeps key length logarithmic in
  // count rather than linear.
  const mid = Math.floor(count / 2);
  const midKey = generateKeyBetween(before, after);
  return [
    ...generateNKeysBetween(before, midKey, mid),
    midKey,
    ...generateNKeysBetween(midKey, after, count - mid - 1),
  ];
}

/** Comparator for sorting siblings. Byte-wise, matching Postgres C collation. */
export const compareIndex = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Comparator for sibling records, with the id as tie-breaker.
 *
 * **Use this, not `compareIndex` alone, wherever siblings are ordered.**
 *
 * The midpoint algorithm is deterministic, so two clients inserting into the
 * same gap while offline generate the *identical* key. Neither insert is
 * lost — both blocks exist after the merge — but their order becomes a tie.
 * Sorting on the index alone then lets two clients render the same document
 * in different orders, which looks like a sync bug and is nearly impossible
 * to reproduce on demand.
 *
 * The database side of this rule is `ORDER BY idx, id` in every sibling
 * query. See db/migrations and the materialiser.
 */
export const compareSiblings = (
  a: { idx: string; id: string },
  b: { idx: string; id: string },
): number => compareIndex(a.idx, b.idx) || compareIndex(a.id, b.id);
