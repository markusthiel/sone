/**
 * Reading a formula (ADR-0056).
 *
 * The tests that matter are about what must *not* parse, and about precedence —
 * a formula language that gets `a + b * c` wrong is worse than none, because
 * every answer it gives is plausible.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fieldsUsed, parseFormula, MAX_FORMULA } from '../src/formula/parse.js';

const parsed = (text: string) => {
  const result = parseFormula(text);
  assert.ok('expr' in result, `expected ${text} to parse`);
  return result.expr;
};

test('arithmetic reads the way somebody writes it', () => {
  // Infix, because the people who want a formula column know a spreadsheet and
  // not `multiply(add(...))`.
  const expr = parsed('Menge * Preis');
  assert.deepEqual(expr, {
    kind: 'binary',
    op: '*',
    left: { kind: 'field', name: 'Menge' },
    right: { kind: 'field', name: 'Preis' },
  });
});

test('multiplication binds tighter than addition', () => {
  // The test a formula language cannot afford to fail: every wrong answer here
  // is a plausible number.
  const expr = parsed('1 + 2 * 3');
  assert.equal(expr.kind, 'binary');
  assert.ok(expr.kind === 'binary' && expr.op === '+');
  assert.ok(expr.right.kind === 'binary' && expr.right.op === '*');

  // And brackets override it.
  const bracketed = parsed('(1 + 2) * 3');
  assert.ok(bracketed.kind === 'binary' && bracketed.op === '*');
});

test('a column with a space is written in brackets', () => {
  const expr = parsed('[Netto ohne Steuer] * 1.19');
  assert.ok(expr.kind === 'binary' && expr.left.kind === 'field');
  assert.equal(expr.left.name, 'Netto ohne Steuer');
});

test('a name is a column, a name with a bracket is a call', () => {
  assert.deepEqual(parsed('Preis'), { kind: 'field', name: 'Preis' });
  const call = parsed('round(Preis, 2)');
  assert.ok(call.kind === 'call');
  assert.equal(call.name, 'round');
  assert.equal(call.args.length, 2);
});

test('a German column name is a name', () => {
  // The rule is "letters", not "a-z": anything else quietly excludes somebody's
  // language.
  assert.deepEqual(parsed('Größe'), { kind: 'field', name: 'Größe' });
  assert.deepEqual(parsed('Straße_2'), { kind: 'field', name: 'Straße_2' });
});

test('what must not parse, does not', () => {
  for (const [text, code] of [
    ['1 +', 'unexpected_end'],
    ['(1 + 2', 'unclosed_bracket'],
    ['"unbeendet', 'unclosed_string'],
    ['[Menge', 'unclosed_bracket'],
    ['1 2', 'unexpected_token'],
    ['1 # 2', 'unexpected_token'],
  ] as const) {
    const result = parseFormula(text);
    assert.ok('error' in result, `${text} must not parse`);
    assert.equal(result.error.code, code, text);
  }
});

test('a formula is bounded in length and in depth', () => {
  // It parses strings out of a document, on the server. Bounded work per row is
  // not a nicety.
  const long = parseFormula('1'.repeat(MAX_FORMULA + 1));
  assert.ok('error' in long && long.error.code === 'formula_too_long');

  const deep = parseFormula(`${'('.repeat(40)}1${')'.repeat(40)}`);
  assert.ok('error' in deep && deep.error.code === 'formula_too_deep');
});

test('the columns a formula names can be listed', () => {
  // For resolving names to ids when it is saved, so renaming a column does not
  // break a formula.
  assert.deepEqual(
    fieldsUsed(parsed('if(Menge > 0, Menge * [Preis netto], 0)')).sort(),
    ['Menge', 'Preis netto'],
  );
});
