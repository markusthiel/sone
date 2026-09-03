/**
 * SONE core — working out what a formula says for one row (ADR-0056).
 *
 * Four types and no coercion that guesses. `1 + "2"` is an error rather than 3
 * or "12": the two most popular answers to that question elsewhere are both
 * wrong often enough to have cost people money.
 *
 * An empty cell is empty, not zero, and arithmetic on it propagates empty — so a
 * total over a row with a missing price is empty rather than quietly wrong.
 * `coalesce(Preis, 0)` is how somebody says they meant zero.
 */

import type { Expr } from './parse.js';

export type Value =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'blank' };

export interface EvalError {
  code:
    | 'unknown_field'
    | 'type_mismatch'
    | 'unknown_function'
    | 'wrong_arity'
    | 'divide_by_zero'
    | 'not_a_date';
  /** What it was about, for a message that can name it. */
  detail?: string;
}

export type Result = { value: Value } | { error: EvalError };

const BLANK: Value = { kind: 'blank' };

/** What one row offers a formula: its stored cells and its rollups, by field id. */
export type Row = (fieldId: string) => Value | undefined;

const isBlank = (value: Value): boolean =>
  value.kind === 'blank' || (value.kind === 'text' && value.value === '');

function asNumber(value: Value): number | EvalError {
  if (value.kind === 'number') return value.value;
  return { code: 'type_mismatch', detail: value.kind };
}

function compare(left: Value, right: Value): number | EvalError {
  if (left.kind === 'number' && right.kind === 'number') return left.value - right.value;
  if (left.kind === 'text' && right.kind === 'text') {
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  if (left.kind === 'date' && right.kind === 'date') {
    return Date.parse(left.value) - Date.parse(right.value);
  }
  return { code: 'type_mismatch', detail: `${left.kind}/${right.kind}` };
}

const DAY = 86_400_000;

/**
 * Evaluate, returning either a value or one error.
 *
 * One error and not a list: a formula is written by somebody who will fix it,
 * and the first thing wrong is the thing to fix. Errors are per row, so a
 * formula can work for nine rows and fail on the tenth — nine results and one
 * message is more useful than ten messages.
 */
export function evaluate(expr: Expr, row: Row, now: () => Date = () => new Date()): Result {
  const go = (node: Expr): Value | EvalError => {
    switch (node.kind) {
      case 'number':
        return { kind: 'number', value: node.value };
      case 'text':
        return { kind: 'text', value: node.value };
      case 'boolean':
        return { kind: 'boolean', value: node.value };
      case 'blank':
        return BLANK;

      case 'field': {
        // By id, resolved when the formula was saved. A formula whose column has
        // been deleted names it rather than showing a blank: the person reading
        // the cell is the person who has to fix it.
        if (!node.fieldId) return { code: 'unknown_field', detail: node.name };
        const found = row(node.fieldId);
        return found ?? BLANK;
      }

      case 'unary': {
        const operand = go(node.operand);
        if ('code' in operand) return operand;
        if (node.op === 'not') {
          if (operand.kind === 'blank') return BLANK;
          if (operand.kind !== 'boolean') return { code: 'type_mismatch', detail: operand.kind };
          return { kind: 'boolean', value: !operand.value };
        }
        if (operand.kind === 'blank') return BLANK;
        const number = asNumber(operand);
        if (typeof number !== 'number') return number;
        return { kind: 'number', value: -number };
      }

      case 'binary': {
        const left = go(node.left);
        if ('code' in left) return left;

        // `and` and `or` do not evaluate the far side when the near one settles
        // it, which is what makes `if(x <> 0 and 10 / x > 1, …)` safe to write.
        if (node.op === 'and' || node.op === 'or') {
          if (left.kind === 'blank') return BLANK;
          if (left.kind !== 'boolean') return { code: 'type_mismatch', detail: left.kind };
          if (node.op === 'and' && !left.value) return { kind: 'boolean', value: false };
          if (node.op === 'or' && left.value) return { kind: 'boolean', value: true };
          const right = go(node.right);
          if ('code' in right) return right;
          if (right.kind === 'blank') return BLANK;
          if (right.kind !== 'boolean') return { code: 'type_mismatch', detail: right.kind };
          return { kind: 'boolean', value: right.value };
        }

        const right = go(node.right);
        if ('code' in right) return right;

        // Empty propagates: a total over a row with a missing price is empty
        // rather than a number nobody should trust.
        if (isBlank(left) || isBlank(right)) {
          if (node.op === '=' ) return { kind: 'boolean', value: isBlank(left) && isBlank(right) };
          if (node.op === '<>') return { kind: 'boolean', value: isBlank(left) !== isBlank(right) };
          return BLANK;
        }

        switch (node.op) {
          case '+': {
            // Text and text concatenates; a number and a text does not. Adding
            // them is the ambiguity this language refuses.
            if (left.kind === 'text' && right.kind === 'text') {
              return { kind: 'text', value: left.value + right.value };
            }
            const a = asNumber(left);
            const b = asNumber(right);
            if (typeof a !== 'number') return a;
            if (typeof b !== 'number') return b;
            return { kind: 'number', value: a + b };
          }
          case '-':
          case '*':
          case '/': {
            const a = asNumber(left);
            const b = asNumber(right);
            if (typeof a !== 'number') return a;
            if (typeof b !== 'number') return b;
            if (node.op === '/' && b === 0) return { code: 'divide_by_zero' };
            return {
              kind: 'number',
              value: node.op === '-' ? a - b : node.op === '*' ? a * b : a / b,
            };
          }
          default: {
            const order = compare(left, right);
            if (typeof order !== 'number') return order;
            const holds = {
              '=': order === 0,
              '<>': order !== 0,
              '<': order < 0,
              '<=': order <= 0,
              '>': order > 0,
              '>=': order >= 0,
            }[node.op];
            return { kind: 'boolean', value: holds === true };
          }
        }
      }

      case 'call':
        return call(node.name, node.args);
    }
  };

  const call = (name: string, args: Expr[]): Value | EvalError => {
    /*
     * `if` and `coalesce` decide which arguments to evaluate, so they come
     * before the others: evaluating both branches of an `if` would make
     * `if(x <> 0, 10 / x, 0)` fail on the row it was written for.
     */
    if (name === 'if') {
      if (args.length !== 3) return { code: 'wrong_arity', detail: name };
      const test = go(args[0]!);
      if ('code' in test) return test;
      if (test.kind === 'blank') return BLANK;
      if (test.kind !== 'boolean') return { code: 'type_mismatch', detail: test.kind };
      return go(args[test.value ? 1 : 2]!);
    }

    if (name === 'coalesce') {
      for (const arg of args) {
        const candidate = go(arg);
        if ('code' in candidate) return candidate;
        if (!isBlank(candidate)) return candidate;
      }
      return BLANK;
    }

    const values: Value[] = [];
    for (const arg of args) {
      const one = go(arg);
      if ('code' in one) return one;
      values.push(one);
    }

    const numbers = (): number[] | EvalError => {
      const out: number[] = [];
      for (const one of values) {
        const number = asNumber(one);
        if (typeof number !== 'number') return number;
        out.push(number);
      }
      return out;
    };

    switch (name) {
      case 'today':
        return { kind: 'date', value: now().toISOString().slice(0, 10) };

      case 'isblank':
        return { kind: 'boolean', value: isBlank(values[0]!) };

      case 'length': {
        const one = values[0]!;
        if (isBlank(one)) return { kind: 'number', value: 0 };
        if (one.kind !== 'text') return { code: 'type_mismatch', detail: one.kind };
        return { kind: 'number', value: [...one.value].length };
      }

      case 'lower':
      case 'upper': {
        const one = values[0]!;
        if (isBlank(one)) return BLANK;
        if (one.kind !== 'text') return { code: 'type_mismatch', detail: one.kind };
        return {
          kind: 'text',
          value: name === 'lower' ? one.value.toLowerCase() : one.value.toUpperCase(),
        };
      }

      case 'contains': {
        const [haystack, needle] = values as [Value, Value];
        if (isBlank(haystack) || isBlank(needle)) return { kind: 'boolean', value: false };
        if (haystack.kind !== 'text' || needle.kind !== 'text') {
          return { code: 'type_mismatch', detail: `${haystack.kind}/${needle.kind}` };
        }
        return { kind: 'boolean', value: haystack.value.includes(needle.value) };
      }

      case 'concat': {
        // Blanks contribute nothing rather than the word "blank", and a number
        // is written out — this is the one place where mixing types is what
        // somebody meant.
        let out = '';
        for (const one of values) {
          // Narrowed here rather than through `isBlank`, which also treats an
          // empty text as blank and so cannot tell the compiler that this one
          // has a value.
          if (one.kind === 'blank') continue;
          out +=
            one.kind === 'number'
              ? String(one.value)
              : one.kind === 'boolean'
                ? String(one.value)
                : one.kind === 'date'
                  ? one.value
                  : one.value;
        }
        return { kind: 'text', value: out };
      }

      case 'abs': {
        if (isBlank(values[0]!)) return BLANK;
        const got = numbers();
        if (!Array.isArray(got)) return got;
        return { kind: 'number', value: Math.abs(got[0]!) };
      }

      case 'round': {
        if (isBlank(values[0]!)) return BLANK;
        const got = numbers();
        if (!Array.isArray(got)) return got;
        const places = got[1] ?? 0;
        const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(places)));
        return { kind: 'number', value: Math.round(got[0]! * factor) / factor };
      }

      case 'min':
      case 'max': {
        const present = values.filter((one) => !isBlank(one));
        if (present.length === 0) return BLANK;
        const got: number[] = [];
        for (const one of present) {
          const number = asNumber(one);
          if (typeof number !== 'number') return number;
          got.push(number);
        }
        return { kind: 'number', value: name === 'min' ? Math.min(...got) : Math.max(...got) };
      }

      case 'days': {
        const [from, to] = values as [Value, Value];
        if (isBlank(from) || isBlank(to)) return BLANK;
        if (from.kind !== 'date' || to.kind !== 'date') {
          return { code: 'not_a_date', detail: `${from.kind}/${to.kind}` };
        }
        const a = Date.parse(from.value);
        const b = Date.parse(to.value);
        if (Number.isNaN(a) || Number.isNaN(b)) return { code: 'not_a_date' };
        // Whole days, and truncated rather than rounded: "one and a half days
        // ago" is one day ago in every sentence somebody would write.
        return { kind: 'number', value: Math.trunc((b - a) / DAY) };
      }

      default:
        return { code: 'unknown_function', detail: name };
    }
  };

  const outcome = go(expr);
  return 'code' in outcome ? { error: outcome } : { value: outcome };
}
