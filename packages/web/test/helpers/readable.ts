/**
 * The strings a reader can see, read from the syntax rather than guessed at.
 *
 * The i18n guard was three regular expressions, and it reported a file clean
 * three times while English sat in it:
 *
 * - a paragraph written across three lines never matched, so every long
 *   explanation in the administration area was invisible to it;
 * - `{busy ? 'Creating…' : 'Create invitation'}` is not text after a `>`, so a
 *   button's two words hid behind a brace (ADR-0146);
 * - and a label written after `{' '}` is text after a `}`, which is the shape
 *   half the accounts row was written in.
 *
 * Each hole was closed by widening a pattern, and the next shape hid in the
 * next gap. **Whether a string reaches the screen is a property of the syntax
 * tree, and the compiler that ships with this package already builds one.** So
 * this reads the tree: what a JSX element renders, what a readable attribute
 * carries, and what a label in a data structure holds.
 *
 * It is deliberately narrow about *reaching the screen*. Only shapes that carry
 * a value straight through count — a ternary's branches, the right of `&&`, the
 * text of a template, `+`, parentheses. A call is not one of them, which is
 * exactly what `t('key')` is, so a translated string is never reported and no
 * exception list is needed for the ordinary case.
 */

import ts from 'typescript';

export interface ReadableString {
  /** Where it reaches somebody: JSX text, an expression rendered as text, a
   *  readable attribute, or a label held in a data structure. */
  kind: 'text' | 'expression' | `attribute:${string}` | 'label';
  text: string;
  line: number;
}

/**
 * Attributes a person reads.
 *
 * `title` and `aria-label` are read aloud or on hover and are invisible to a
 * screenshot, which is how they stay English longest. `alt` is the same
 * sentence for somebody who cannot see the picture.
 */
const READABLE_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder', 'alt']);

/** Keys in a data structure that hold something somebody reads (ADR-0041). */
const READABLE_FIELDS = /^(?:label|hint|title|heading|placeholder|note)$/;

/**
 * The literals an expression can put on the screen.
 *
 * Recursion only through the shapes that pass a value along unchanged. A call,
 * a property access, an identifier: not here — the value they produce is not in
 * this file's text.
 */
function rendered(node: ts.Expression | undefined, out: ts.Node[] = []): ts.Node[] {
  if (!node) return out;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node);
  } else if (ts.isTemplateExpression(node)) {
    // The template's own text is written here; the holes are other expressions
    // and are followed in case one of them is a literal too.
    out.push(node);
    for (const span of node.templateSpans) rendered(span.expression, out);
  } else if (ts.isParenthesizedExpression(node)) {
    rendered(node.expression, out);
  } else if (ts.isConditionalExpression(node)) {
    rendered(node.whenTrue, out);
    rendered(node.whenFalse, out);
  } else if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      // Only the right side is drawn; the left is the condition.
      rendered(node.right, out);
    } else if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      rendered(node.left, out);
      rendered(node.right, out);
    } else if (operator === ts.SyntaxKind.PlusToken) {
      rendered(node.left, out);
      rendered(node.right, out);
    }
  }
  return out;
}

/** A template's own words, with the holes taken out. */
const wordsOf = (node: ts.Node): string =>
  ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.getText().replace(/^[`}]|[`{$]+$/g, '').replace(/\$\{[^}]*\}/g, '…')
    : (node as ts.StringLiteral).text;

/**
 * Two letters in a row.
 *
 * A separator (`·`), a space, a number or a single letter is not a sentence
 * anybody translates. Everything longer is, until somebody says otherwise in
 * the caller's own list of exceptions.
 */
const hasWords = (text: string): boolean => /[A-Za-z]{2}/.test(text);

/** Every string in this source that somebody reads. */
export function readableStrings(source: string, file = 'source.tsx'): ReadableString[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: ReadableString[] = [];
  const lineOf = (node: ts.Node): number =>
    tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;

  const keep = (kind: ReadableString['kind'], node: ts.Node): void => {
    const text = wordsOf(node).replace(/\s+/g, ' ').trim();
    if (hasWords(text)) found.push({ kind, text, line: lineOf(node) });
  };

  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim();
      if (hasWords(text)) found.push({ kind: 'text', text, line: lineOf(node) });
    } else if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const literal of rendered(node.expression)) keep('expression', literal);
    } else if (ts.isJsxAttribute(node) && READABLE_ATTRIBUTES.has(node.name.getText(tree))) {
      const value = node.initializer;
      const literals =
        value === undefined
          ? []
          : ts.isJsxExpression(value)
            ? rendered(value.expression)
            : [value];
      for (const literal of literals) keep(`attribute:${node.name.getText(tree)}`, literal);
    } else if (
      ts.isPropertyAssignment(node) &&
      READABLE_FIELDS.test(node.name.getText(tree))
    ) {
      for (const literal of rendered(node.initializer)) {
        // A key is dotted and has no spaces — `you.signIn` is a key, `Sign in`
        // is a sentence. Capitals are no help: the keys are camel-cased.
        const text = wordsOf(literal);
        if (/\s/.test(text) || !text.includes('.')) keep('label', literal);
      }
    }
    ts.forEachChild(node, walk);
  };

  walk(tree);
  return found;
}
