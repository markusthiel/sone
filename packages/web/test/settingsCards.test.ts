/**
 * How a settings screen is laid out (ADR-0028).
 *
 * These are the rules that went wrong twice by being written in two halves — a
 * class styled in one place and given a margin in another, four hundred lines
 * apart. So each of these asserts the whole rule, and one of them asserts there
 * is only one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('a note keeps its distance from whatever is above it', () => {
  // It had a negative top margin for the one case where it follows a card, and
  // that applied everywhere — so a note after a table or a button was pulled
  // twenty pixels up into it. The pull is asked for by what comes before now.
  assert.match(css, /\.settings-note \{[^}]*margin-block: 0 var\(--sone-space-6\)/s);
  assert.match(css, /\.settings-card \+ \.settings-note[^}]*margin-block-start: calc\(/s);
  assert.match(css, /\.maintenance-actions \+ \.settings-note[^}]*margin-block-start: 0/s);

  // And one rule for the class, not two. The second set the measure and the size
  // four hundred lines from the first, which is how the margin went unnoticed.
  assert.equal([...css.matchAll(/^\.settings-note \{/gm)].length, 1);
});

test('a checkbox has room between its box and its words', () => {
  // The class was used in three places and had no rule at all.
  assert.match(css, /^\.checkbox \{[^}]*gap: var\(--sone-space-3\)/ms);
  // Top-aligned, because a label that wraps should start level with its box
  // rather than float beside the middle of two lines.
  assert.match(css, /^\.checkbox \{[^}]*align-items: flex-start/ms);
  // The sentence under it lines up with the label's text, not with the box.
  assert.match(css, /\.checkbox \+ p \{[^}]*padding-inline-start: calc\(var\(--sone-marker\)/s);
});

test('a counted thing with a paragraph is stacked, not columned', () => {
  assert.match(css, /\.settings-list\.explained \{\s*display: block/);
  const admin = codeOf(new URL('../src/components/Admin.tsx', import.meta.url));
  assert.match(admin, /className="settings-list explained"/);
});
