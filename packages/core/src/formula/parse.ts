/**
 * SONE core — reading a formula (ADR-0056).
 *
 * Hand-written recursive descent, a few hundred lines, bounded in input and in
 * depth. No `Function`, no `eval`, no library: this parses strings out of a
 * document and the result is evaluated on the server, so a formula language is a
 * sandbox escape waiting to be found if it is anything other than a small parser
 * that does exactly what it says.
 *
 * In core because both sides need it: the server evaluates, and the interface
 * resolves field names to ids when a formula is saved.
 */

/** What a formula may hold, before it is evaluated. */
export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'blank' }
  /** A field, by id once resolved and by name until then. */
  | { kind: 'field'; name: string; fieldId?: string }
  | { kind: 'unary'; op: '-' | 'not'; operand: Expr }
  | {
      kind: 'binary';
      op: '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'and' | 'or';
      left: Expr;
      right: Expr;
    }
  | { kind: 'call'; name: string; args: Expr[] };

export interface ParseError {
  /** What is wrong, as a message key so the interface can translate it. */
  code:
    | 'formula_too_long'
    | 'formula_too_deep'
    | 'unexpected_end'
    | 'unexpected_token'
    | 'unclosed_bracket'
    | 'unclosed_string';
  /** Where, as an index into the text — enough to put a caret under it. */
  at: number;
  /** The offending text, for a message that can quote it. */
  found?: string;
}

export const MAX_FORMULA = 500;
const MAX_DEPTH = 32;

/**
 * The functions a formula may call.
 *
 * A small set, and adding to it is a decision each time rather than a namespace.
 * Arity is checked here so the evaluator never has to guess what a call meant.
 */
export const FUNCTIONS: Record<string, { min: number; max: number }> = {
  if: { min: 3, max: 3 },
  round: { min: 1, max: 2 },
  abs: { min: 1, max: 1 },
  min: { min: 1, max: 8 },
  max: { min: 1, max: 8 },
  concat: { min: 1, max: 8 },
  length: { min: 1, max: 1 },
  lower: { min: 1, max: 1 },
  upper: { min: 1, max: 1 },
  contains: { min: 2, max: 2 },
  coalesce: { min: 2, max: 8 },
  /** Whole days from the first date to the second. Negative when it is earlier. */
  days: { min: 2, max: 2 },
  /** Today, so a formula can say how old something is. */
  today: { min: 0, max: 0 },
  isblank: { min: 1, max: 1 },
};

// --- tokens ----------------------------------------------------------------

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'string'; value: string; at: number }
  | { kind: 'name'; value: string; at: number }
  /** `[a name with spaces]`, which is how a column with a space is written. */
  | { kind: 'field'; value: string; at: number }
  | { kind: 'op'; value: string; at: number }
  | { kind: 'end'; at: number };

const OPERATORS = ['<=', '>=', '<>', '+', '-', '*', '/', '(', ')', ',', '=', '<', '>'];

function tokenise(text: string): Token[] | ParseError {
  const tokens: Token[] = [];
  let at = 0;

  while (at < text.length) {
    const char = text[at]!;

    if (/\s/.test(char)) {
      at += 1;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[at + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]+/.exec(text.slice(at))!;
      tokens.push({ kind: 'number', value: Number(match[0]), at });
      at += match[0].length;
      continue;
    }

    if (char === '"') {
      const end = text.indexOf('"', at + 1);
      if (end === -1) return { code: 'unclosed_string', at };
      tokens.push({ kind: 'string', value: text.slice(at + 1, end), at });
      at = end + 1;
      continue;
    }

    if (char === '[') {
      const end = text.indexOf(']', at + 1);
      if (end === -1) return { code: 'unclosed_bracket', at };
      tokens.push({ kind: 'field', value: text.slice(at + 1, end).trim(), at });
      at = end + 1;
      continue;
    }

    // Letters, including anything a German column name contains: a name is
    // whatever is not an operator, a digit or a space, which is the only rule
    // that does not accidentally exclude somebody's language.
    if (/[\p{L}_]/u.test(char)) {
      const match = /^[\p{L}\p{N}_]+/u.exec(text.slice(at))!;
      tokens.push({ kind: 'name', value: match[0], at });
      at += match[0].length;
      continue;
    }

    const operator = OPERATORS.find((op) => text.startsWith(op, at));
    if (operator) {
      tokens.push({ kind: 'op', value: operator, at });
      at += operator.length;
      continue;
    }

    return { code: 'unexpected_token', at, found: char };
  }

  tokens.push({ kind: 'end', at: text.length });
  return tokens;
}

// --- the grammar -----------------------------------------------------------

/**
 * Precedence, lowest first — the shape everybody expects from a spreadsheet:
 * `or` < `and` < comparison < `+ -` < `* /` < unary < primary.
 */
export function parseFormula(text: string): { expr: Expr } | { error: ParseError } {
  if (text.length > MAX_FORMULA) return { error: { code: 'formula_too_long', at: MAX_FORMULA } };

  const tokens = tokenise(text);
  if (!Array.isArray(tokens)) return { error: tokens };

  let index = 0;
  let depth = 0;
  let failure: ParseError | null = null;

  const peek = (): Token => tokens[index] ?? { kind: 'end', at: text.length };
  const isOp = (value: string): boolean => {
    const token = peek();
    return token.kind === 'op' && token.value === value;
  };
  const isWord = (value: string): boolean => {
    const token = peek();
    return token.kind === 'name' && token.value.toLowerCase() === value;
  };
  const fail = (error: ParseError): Expr => {
    failure ??= error;
    return { kind: 'blank' };
  };

  const binary = (
    ops: string[],
    next: () => Expr,
    words = false,
  ): Expr => {
    let left = next();
    for (;;) {
      const token = peek();
      const matched = words
        ? token.kind === 'name' && ops.includes(token.value.toLowerCase())
        : token.kind === 'op' && ops.includes(token.value);
      if (!matched) return left;
      const op = (token as { value: string }).value.toLowerCase();
      index += 1;
      const right = next();
      left = { kind: 'binary', op: op as never, left, right };
    }
  };

  const primary = (): Expr => {
    if (failure) return { kind: 'blank' };
    depth += 1;
    if (depth > MAX_DEPTH) return fail({ code: 'formula_too_deep', at: peek().at });
    try {
      const token = peek();

      if (token.kind === 'number') {
        index += 1;
        return { kind: 'number', value: token.value };
      }
      if (token.kind === 'string') {
        index += 1;
        return { kind: 'text', value: token.value };
      }
      if (token.kind === 'field') {
        index += 1;
        return { kind: 'field', name: token.value };
      }

      if (token.kind === 'name') {
        const lower = token.value.toLowerCase();
        if (lower === 'true' || lower === 'false') {
          index += 1;
          return { kind: 'boolean', value: lower === 'true' };
        }
        if (lower === 'not') {
          index += 1;
          return { kind: 'unary', op: 'not', operand: primary() };
        }
        index += 1;
        // A name followed by `(` is a call; otherwise it is a column, which is
        // what makes `Menge * Preis` read the way somebody writes it.
        if (isOp('(')) {
          index += 1;
          const args: Expr[] = [];
          if (!isOp(')')) {
            for (;;) {
              args.push(expression());
              if (isOp(',')) {
                index += 1;
                continue;
              }
              break;
            }
          }
          if (!isOp(')')) return fail({ code: 'unclosed_bracket', at: token.at });
          index += 1;
          return { kind: 'call', name: lower, args };
        }
        return { kind: 'field', name: token.value };
      }

      if (isOp('(')) {
        index += 1;
        const inner = expression();
        if (!isOp(')')) return fail({ code: 'unclosed_bracket', at: token.at });
        index += 1;
        return inner;
      }

      if (isOp('-')) {
        index += 1;
        return { kind: 'unary', op: '-', operand: primary() };
      }

      if (token.kind === 'end') return fail({ code: 'unexpected_end', at: token.at });
      return fail({ code: 'unexpected_token', at: token.at, found: String(token.value) });
    } finally {
      depth -= 1;
    }
  };

  const product = (): Expr => binary(['*', '/'], primary);
  const sum = (): Expr => binary(['+', '-'], product);
  const comparison = (): Expr => binary(['=', '<>', '<', '<=', '>', '>='], sum);
  const conjunction = (): Expr => binary(['and'], comparison, true);
  const expression = (): Expr => binary(['or'], conjunction, true);

  const expr = expression();
  if (failure) return { error: failure };
  if (peek().kind !== 'end') {
    return { error: { code: 'unexpected_token', at: peek().at, found: String((peek() as { value?: unknown }).value ?? '') } };
  }
  return { expr };
}

/** Every column a formula names, for resolving them to ids when it is saved. */
export function fieldsUsed(expr: Expr): string[] {
  const found = new Set<string>();
  const walk = (node: Expr): void => {
    switch (node.kind) {
      case 'field':
        found.add(node.name);
        return;
      case 'unary':
        walk(node.operand);
        return;
      case 'binary':
        walk(node.left);
        walk(node.right);
        return;
      case 'call':
        for (const arg of node.args) walk(arg);
        return;
      default:
        return;
    }
  };
  walk(expr);
  return [...found];
}

/**
 * Attach the field ids a formula was saved with (ADR-0056).
 *
 * The stored text still says `Menge`; the binding is what turns that into a
 * column that may since have been renamed. A name with no binding is left
 * unbound, so the evaluator reports it by name rather than treating it as
 * blank — which is the difference between "no column called Preis" and a
 * silently wrong total.
 */
export function bindFormula(expr: Expr, idOf: (name: string) => string | undefined): Expr {
  switch (expr.kind) {
    case 'field': {
      const fieldId = idOf(expr.name);
      return fieldId ? { ...expr, fieldId } : expr;
    }
    case 'unary':
      return { ...expr, operand: bindFormula(expr.operand, idOf) };
    case 'binary':
      return {
        ...expr,
        left: bindFormula(expr.left, idOf),
        right: bindFormula(expr.right, idOf),
      };
    case 'call':
      return { ...expr, args: expr.args.map((arg) => bindFormula(arg, idOf)) };
    default:
      return expr;
  }
}
