/**
 * What a formula says for one row (ADR-0056).
 *
 * The tests are about the decisions rather than the arithmetic: empty is not
 * zero, `1 + "2"` is an error, and `if` does not evaluate the branch it did not
 * take — each one a place where another language chose differently and made
 * somebody's total quietly wrong.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluate, type Value } from '../src/formula/evaluate.js';
import { parseFormula, type Expr } from '../src/formula/parse.js';

/** Parse, and bind every named column to the id of the same name. */
function run(text: string, cells: Record<string, Value>) {
  const result = parseFormula(text);
  assert.ok('expr' in result, `expected ${text} to parse`);
  const bind = (node: Expr): Expr => {
    if (node.kind === 'field') return { ...node, fieldId: node.name };
    if (node.kind === 'unary') return { ...node, operand: bind(node.operand) };
    if (node.kind === 'binary') return { ...node, left: bind(node.left), right: bind(node.right) };
    if (node.kind === 'call') return { ...node, args: node.args.map(bind) };
    return node;
  };
  return evaluate(bind(result.expr), (id) => cells[id]);
}

const number = (value: number): Value => ({ kind: 'number', value });
const text = (value: string): Value => ({ kind: 'text', value });

test('arithmetic works, and division by zero is named', () => {
  assert.deepEqual(run('2 * (3 + 4)', {}), { value: number(14) });
  const failed = run('1 / 0', {});
  assert.ok('error' in failed && failed.error.code === 'divide_by_zero');
});

test('an empty cell is empty, not zero', () => {
  // A total over a row with a missing price is empty rather than a number
  // nobody should trust. `coalesce` is how somebody says they meant zero.
  assert.deepEqual(run('Menge * Preis', { Menge: number(3) }), { value: { kind: 'blank' } });
  assert.deepEqual(run('Menge * coalesce(Preis, 0)', { Menge: number(3) }), {
    value: number(0),
  });
});

test('a number and a text do not add', () => {
  // The two popular answers — 3 and "12" — are both wrong often enough to have
  // cost people money.
  const failed = run('1 + Name', { Name: text('2') });
  assert.ok('error' in failed && failed.error.code === 'type_mismatch');
  // Text and text concatenates, which is unambiguous.
  assert.deepEqual(run('Vorname + Nachname', { Vorname: text('Anna '), Nachname: text('Meier') }), {
    value: text('Anna Meier'),
  });
});

test('if does not evaluate the branch it did not take', () => {
  // Otherwise `if(x <> 0, 10 / x, 0)` fails on exactly the row it was written
  // for.
  assert.deepEqual(run('if(Menge <> 0, 10 / Menge, 0)', { Menge: number(0) }), {
    value: number(0),
  });
  assert.deepEqual(run('if(Menge <> 0, 10 / Menge, 0)', { Menge: number(5) }), {
    value: number(2),
  });
});

test('and stops when the near side settles it', () => {
  // Which is what makes a guard in front of a division safe to write.
  assert.deepEqual(run('Menge <> 0 and 10 / Menge > 1', { Menge: number(0) }), {
    value: { kind: 'boolean', value: false },
  });
});

test('a column the formula cannot find is named, not blanked', () => {
  // The person reading the cell is the person who has to fix it.
  const result = parseFormula('Preis * 2');
  assert.ok('expr' in result);
  // Unresolved: no fieldId, which is what a deleted column leaves behind.
  const failed = evaluate(result.expr, () => undefined);
  assert.ok('error' in failed && failed.error.code === 'unknown_field');
  assert.equal(failed.error.detail, 'Preis');
});

test('days between two dates, truncated', () => {
  const value = run('days(Von, Bis)', {
    Von: { kind: 'date', value: '2026-09-01' },
    Bis: { kind: 'date', value: '2026-09-04' },
  });
  assert.deepEqual(value, { value: number(3) });

  // A date and a number is not a date subtraction.
  const failed = run('days(Von, Menge)', {
    Von: { kind: 'date', value: '2026-09-01' },
    Menge: number(3),
  });
  assert.ok('error' in failed && failed.error.code === 'not_a_date');
});

test('an unknown function is named', () => {
  const failed = run('sqrt(4)', {});
  assert.ok('error' in failed && failed.error.code === 'unknown_function');
  assert.equal(failed.error.detail, 'sqrt');
});
