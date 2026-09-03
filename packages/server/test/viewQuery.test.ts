/**
 * Turning a view's filters and sort into SQL.
 *
 * A filter names a field, an operator and a value. The field and operator decide
 * which column and which comparison, and neither can be a bound parameter — no
 * database lets you bind a column name — so they are mapped through closed lists.
 * Every *value* is still bound. These tests exist mostly to hold that line.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildViewQuery, readFilters, readSorts } from '../src/http/viewQuery.js';

const TYPES = new Map<string, string>([
  ['name', 'text'],
  ['count', 'number'],
  ['due', 'date'],
  ['done', 'checkbox'],
  ['status', 'select'],
  ['tags', 'multiSelect'],
]);

test('a value never reaches the SQL, only a placeholder', () => {
  // The property that matters. If a value were interpolated, a filter typed by
  // one person would run as SQL for everybody who opened the view.
  const hostile = "x'; DROP TABLE pages; --";
  const built = buildViewQuery(
    [{ fieldId: 'name', operator: 'is', value: hostile }],
    [],
    TYPES,
    2,
  );

  assert.ok(!built.where.includes('DROP TABLE'), 'not in the SQL');
  assert.ok(built.params.includes(hostile), 'bound instead');
  assert.match(built.where, /\$\d+/);
});

test('an unknown operator is skipped, never interpolated', () => {
  const built = buildViewQuery(
    [{ fieldId: 'name', operator: 'or 1=1 --' as never, value: 'x' }],
    [],
    TYPES,
    2,
  );
  assert.equal(built.where, '');
  assert.ok(!built.where.includes('1=1'));
});

test('an unknown field is skipped rather than failing the request', () => {
  // A view lives in a document other people edit: a column can be deleted while
  // somebody else's board still names it. Refusing to render would turn one
  // stale filter into an unreachable page.
  const built = buildViewQuery(
    [{ fieldId: 'deleted-column', operator: 'is', value: 'x' }],
    [{ fieldId: 'also-gone', direction: 'asc' }],
    TYPES,
    2,
  );
  assert.equal(built.where, '');
  assert.equal(built.orderBy, '');
});

test('each type is compared in its own column', () => {
  // jsonb collation is wrong for numbers and dates — "10" sorts before "9" —
  // which is the shape of bug that has already cost this project an outage.
  const number = buildViewQuery([{ fieldId: 'count', operator: 'gt', value: 5 }], [], TYPES, 2);
  assert.match(number.where, /number_value/);
  assert.deepEqual(number.params.slice(-1), [5]);

  const date = buildViewQuery(
    [{ fieldId: 'due', operator: 'before', value: '2026-01-01' }],
    [],
    TYPES,
    2,
  );
  assert.match(date.where, /date_start/);

  const text = buildViewQuery([{ fieldId: 'name', operator: 'is', value: 'a' }], [], TYPES, 2);
  assert.match(text.where, /text_value/);
});

test('a comparison on the wrong type is skipped', () => {
  // "greater than" has no meaning for text, and running it against the text
  // column would compare strings and quietly return the wrong rows.
  const built = buildViewQuery([{ fieldId: 'name', operator: 'gt', value: 5 }], [], TYPES, 2);
  assert.equal(built.where, '');
});

test('a wildcard in a value stays a value', () => {
  // Somebody filtering for "50%" must not match everything.
  const built = buildViewQuery(
    [{ fieldId: 'name', operator: 'contains', value: '50%' }],
    [],
    TYPES,
    2,
  );
  assert.equal(built.params.at(-1), '%50\\%%');
  assert.match(built.where, /ESCAPE/);
});

test('"is not" includes rows with no value', () => {
  // The alternative hides a row from both a filter and its opposite, which
  // reads as rows going missing.
  const built = buildViewQuery(
    [{ fieldId: 'status', operator: 'isNot', value: 'done' }],
    [],
    TYPES,
    2,
  );
  assert.match(built.where, /IS DISTINCT FROM/);
});

test('empty and non-empty ask whether a value exists at all', () => {
  const empty = buildViewQuery([{ fieldId: 'name', operator: 'isEmpty' }], [], TYPES, 2);
  assert.match(empty.where, /NOT EXISTS/);

  const filled = buildViewQuery([{ fieldId: 'name', operator: 'isNotEmpty' }], [], TYPES, 2);
  assert.match(filled.where, /EXISTS/);
  assert.doesNotMatch(filled.where, /NOT EXISTS/);
});

test('rows with no value sort last in both directions', () => {
  // A row with no value is not the smallest one, it is unanswered — and the
  // answered rows are what somebody sorted to see.
  for (const direction of ['asc', 'desc'] as const) {
    const built = buildViewQuery([], [{ fieldId: 'count', direction }], TYPES, 2);
    assert.match(built.orderBy, /NULLS LAST/);
    assert.match(built.orderBy, direction === 'desc' ? /DESC/ : /ASC/);
  }
});

test('placeholders continue from where the caller left off', () => {
  // The caller has already bound the page id as $1.
  const built = buildViewQuery(
    [{ fieldId: 'name', operator: 'is', value: 'a' }],
    [],
    TYPES,
    2,
  );
  assert.match(built.where, /\$2/);
  assert.ok(!built.where.includes('$1'), 'the caller owns $1');
});

test('a malformed definition yields no filters rather than throwing', () => {
  // Definitions come from a document, which another client wrote.
  assert.deepEqual(readFilters({}), []);
  assert.deepEqual(readFilters({ filters: 'nonsense' }), []);
  assert.deepEqual(readFilters({ filters: [null, 7, { operator: 'is' }] }), []);
  assert.deepEqual(readSorts({ sort: [{ direction: 'asc' }] }), []);
});

test('a sort direction that is not "desc" reads as ascending', () => {
  assert.deepEqual(readSorts({ sort: [{ fieldId: 'a', direction: 'sideways' }] }), [
    { fieldId: 'a', direction: 'asc' },
  ]);
});

test('a sort on a derived column is reported rather than dropped', () => {
  // It used to vanish: a rollup has no shadow column, so `columnFor` returned
  // null and the sort was skipped without a word — the view looked unsorted and
  // nothing said why, which is worse than either doing it or refusing it
  // (ADR-0054).
  const built = buildViewQuery(
    [],
    [
      { fieldId: 'rollup-1', direction: 'desc' },
      { fieldId: 'number-1', direction: 'asc' },
    ],
    new Map([
      ['rollup-1', 'rollup'],
      ['number-1', 'number'],
    ]),
    2,
  );

  assert.deepEqual(built.derivedSorts, [{ fieldId: 'rollup-1', direction: 'desc' }]);
  // And the stored one still becomes SQL: the two kinds of sort coexist rather
  // than one mode replacing the other.
  // The column is inside a subquery, so this reads the two facts that matter —
  // which column and which direction — rather than expecting them adjacent.
  assert.match(built.orderBy, /pp\.number_value/);
  assert.match(built.orderBy, /ASC NULLS LAST/);
});
