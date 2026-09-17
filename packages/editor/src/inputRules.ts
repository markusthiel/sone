/**
 * SONE — input rules.
 *
 * Markdown-style shortcuts: `# ` for a heading, `- ` for a bullet, and so on.
 * These are what make a block editor feel fast, because they remove the trip to
 * a menu for the nine things people actually type.
 *
 * Every rule replaces the *block*, not the text, so `# Title` becomes a heading
 * containing "Title" rather than a paragraph containing "# Title".
 */

import { BLOCK_ATTRS } from '@sone/core';
import {
  InputRule,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import type { NodeType } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

import { schema } from './schema.js';

/**
 * Convert the current block to another type when a pattern matches.
 *
 * `textblockTypeInputRule` handles the conversion; the attribute callback is
 * where the matched text turns into node attributes, which is how `## ` becomes
 * level 2 rather than a generic heading.
 */
const blockRule = (
  pattern: RegExp,
  type: NodeType,
  getAttrs?: (match: RegExpMatchArray) => Record<string, unknown>,
): InputRule => textblockTypeInputRule(pattern, type, getAttrs);

/**
 * A rule that turns a block into a container type.
 *
 * Lists and quotes are containers in this schema (ADR-0015), not wrappers
 * around a paragraph, so this converts rather than wraps.
 */
const containerRule = (pattern: RegExp, type: NodeType): InputRule =>
  textblockTypeInputRule(pattern, type);

/** `---` on its own line becomes a divider. */
const dividerRule = new InputRule(
  /^(?:---|—-|___\s|\*\*\*)$/,
  (state, match, start, end) => {
    const divider = schema.nodes['divider'];
    if (!divider) return null;
    // Three stars typed are three stars drawn: `***` is the printer's section
    // break, and the asterism is its symbol (ADR-0189).
    const attrs = match[0] === '***' ? { [BLOCK_ATTRS.ornament]: 'asterism' } : undefined;
    const tr = state.tr.replaceRangeWith(start, end, divider.create(attrs));
    // A divider is an atom, so the caret has nowhere to sit inside it. A fresh
    // paragraph after it is what the user expects to keep typing into.
    const paragraph = schema.nodes['paragraph'];
    if (paragraph) {
      const pos = tr.selection.from;
      tr.insert(pos, paragraph.create());
    }
    return tr;
  },
);

export function soneInputRules(): Plugin {
  const rules: InputRule[] = [
    // Smart quotes and dashes. Included because typing an apostrophe in a
    // notes app should produce a typographic one, and excluded from code
    // blocks by the schema's `code: true`.
    ...smartQuotes,
    new InputRule(/--$/, '—'),
    new InputRule(/\.\.\.$/, '…'),
  ];

  const heading = schema.nodes['heading'];
  if (heading) {
    // One to six hashes. Capped at six because there is no h7 and a longer run
    // is more likely a literal string than an intent.
    rules.push(
      blockRule(/^(#{1,6})\s$/, heading, (match) => ({
        level: match[1]!.length,
      })),
    );
  }

  const bullet = schema.nodes['bulletList'];
  if (bullet) {
    // `*`, `-` and `+`, matching what Markdown accepts, because people arrive
    // with different habits.
    rules.push(containerRule(/^\s*([-+*])\s$/, bullet));
  }

  const numbered = schema.nodes['numberedList'];
  if (numbered) {
    rules.push(containerRule(/^(\d+)[.)]\s$/, numbered));
  }

  const todo = schema.nodes['todo'];
  if (todo) {
    // `[] ` and `[x] `, with the checked state taken from the brackets so a
    // pasted checklist keeps its state.
    rules.push(
      textblockTypeInputRule(/^\s*\[([ xX]?)\]\s$/, todo, (match) => ({
        checked: (match[1] ?? '').toLowerCase() === 'x',
      })),
    );
  }

  const quote = schema.nodes['quote'];
  if (quote) {
    rules.push(containerRule(/^\s*>\s$/, quote));
  }

  const code = schema.nodes['code'];
  if (code) {
    // Triple backtick, optionally followed by a language.
    rules.push(
      blockRule(/^```([a-zA-Z0-9+#-]*)\s$/, code, (match) => ({
        language: match[1] || null,
      })),
    );
  }

  const toggle = schema.nodes['toggle'];
  if (toggle) {
    rules.push(containerRule(/^\s*>>\s$/, toggle));
  }

  rules.push(dividerRule);

  return inputRules({ rules });
}

/** Exported for tests and for documenting the shortcuts in the UI. */
export const INPUT_RULE_HELP: ReadonlyArray<{ type: string; typed: string }> = [
  { type: 'heading', typed: '# ' },
  { type: 'heading', typed: '## ' },
  { type: 'bulletList', typed: '- ' },
  { type: 'numberedList', typed: '1. ' },
  { type: 'todo', typed: '[] ' },
  { type: 'quote', typed: '> ' },
  { type: 'toggle', typed: '>> ' },
  { type: 'code', typed: '``` ' },
  { type: 'divider', typed: '---' },
];

/** Kept so the wrapping helper is not flagged as unused if rules change. */
export { wrappingInputRule };
