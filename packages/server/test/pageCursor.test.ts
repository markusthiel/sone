/**
 * A keyset cursor (ADR-0055).
 *
 * The tests are about the two things that make paging lie: a row appearing on
 * two pages, and a page that never advances. Both come from the tiebreaker and
 * from NULLs, which is why those have tests of their own rather than being
 * covered by "it produces some SQL".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cursorCondition, readCursor, writeCursor } from '../src/http/pageCursor.js';

const binder = () => {
  const values: Array<string | number | null> = [];
  return {
    values,
    bind: (value: string | number | null): string => {
      values.push(value);
      return `$${values.length}`;
    },
  };
};

test('a cursor round-trips, and a broken one is no cursor', () => {
  const cursor = { keys: ['Acme', 42], idx: 'a0', id: '00000000-0000-4000-8000-000000000001' };
  assert.deepEqual(readCursor(writeCursor(cursor)), cursor);

  // An old link or a truncated URL gets the first page rather than an error
  // about a parameter nobody typed.
  assert.equal(readCursor('not-base64-!!'), null);
  assert.equal(readCursor(null), null);
});

test('with no sort, the tiebreaker alone decides', () => {
  // Two rows with the same sort value need a total order, or paging repeats one
  // or loses one.
  const { bind, values } = binder();
  const sql = cursorCondition([], { keys: [], idx: 'a5', id: 'row-1' }, bind);
  assert.match(sql, /\(p\.idx, p\.id\) > \(\$1, \$2::uuid\)/);
  assert.deepEqual(values, ['a5', 'row-1']);
});

test('a descending sort looks for smaller values, and treats NULL as past', () => {
  // NULLs sort last in both directions (the rule the SQL sorts follow), so
  // "after this row" in a descending sort includes the rows with no value.
  const { bind } = binder();
  const sql = cursorCondition(
    [{ expr: 'X', direction: 'desc' }],
    { keys: [7], idx: 'a1', id: 'row-1' },
    bind,
  );
  // Not the placeholder *number*: the tiebreaker binds first, so the numbering
  // is an artefact of assembly order and has nothing to do with what this test
  // is about.
  assert.match(sql, /X < \$\d+ OR X IS NULL/);
});

test('a page after a row with no value advances on the tiebreaker', () => {
  // The trap: "past a NULL" is nothing, because NULLs are last. Without the
  // `false` branch and the IS NOT DISTINCT FROM equality, the next page would
  // return the same rows for ever.
  const { bind } = binder();
  const sql = cursorCondition(
    [{ expr: 'X', direction: 'asc' }],
    { keys: [null], idx: 'a1', id: 'row-1' },
    bind,
  );
  assert.match(sql, /false/);
  assert.match(sql, /X IS NOT DISTINCT FROM \$\d+ AND \(p\.idx, p\.id\) >/);
});

test('two sort columns compare lexicographically', () => {
  const { bind } = binder();
  const sql = cursorCondition(
    [
      { expr: 'A', direction: 'asc' },
      { expr: 'B', direction: 'desc' },
    ],
    { keys: ['x', 3], idx: 'a1', id: 'row-1' },
    bind,
  );
  // First column strictly past, or equal and the second past, or both equal and
  // the tiebreaker.
  assert.match(sql, /\(A > \$\d+ AND A IS NOT NULL\)/);
  assert.match(sql, /A IS NOT DISTINCT FROM \$\d+ AND \(B < \$\d+ OR B IS NULL\)/);
});
