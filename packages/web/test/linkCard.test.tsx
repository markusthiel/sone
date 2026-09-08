/**
 * Standing in a link (ADR-0157).
 *
 * The other half of *„wenn man im Text einen Link setzt dann kann man den nicht
 * öffnen"*. In an editable view a plain click keeps putting the caret in the
 * word — a link nobody can correct is worse than one nobody can follow — so the
 * click is answered by a card over the caret, with the four things a browser's
 * own context menu offers.
 *
 * Mounted, because what is worth holding is what somebody sees when the caret
 * is in a link, and the interesting part is the condition for showing it at all.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const toolbar = codeOf(new URL('../src/components/SelectionToolbar.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

describe('the card over a link', () => {
  test('appears for a caret in a link, with nothing selected', () => {
    /*
     * The toolbar has only ever appeared for a selection. A caret inside a link
     * is not a selection, and it is the state somebody is in immediately after
     * clicking one — which is the state the report is about.
     */
    assert.match(
      toolbar,
      /const onlyALink = empty && existingLink !== null && !editingLink;/,
    );
    assert.match(toolbar, /const visible = !empty \|\| editingLink \|\| onlyALink;/);
  });

  test('and is measured against the link, not against the caret', () => {
    // Measured against `selection.from` it would sit over the one character the
    // caret happens to be in, which on a long link is nowhere near the middle
    // of it.
    assert.match(toolbar, /onlyALink && existingLink \? existingLink\.from : state\.selection\.from/);
  });

  test('it is the same overlay, not a second one', () => {
    /*
     * The hard half of this is the positioning: a range that may wrap a line, a
     * coordinate that is stale for a frame after a change, and a reading column
     * that re-centres when a panel opens without any window event (ADR-0083). A
     * second card would be a second copy of all of that to get wrong.
     */
    assert.equal(
      (toolbar.match(/useViewportChanges\(/g) ?? []).length,
      1,
      'one measured overlay in this file',
    );
  });

  test('the address is shown, because the words rarely say where it goes', () => {
    assert.match(toolbar, /className="link-card-href"/);
    // Monospaced: an address is not prose, and a proportional font makes a long
    // one harder to compare at a glance.
    assert.match(css, /\.link-card-href \{[^}]*font-family: var\(--sone-font-mono\)/s);
    // And truncated rather than wrapped, or the card becomes a paragraph.
    assert.match(css, /\.link-card-href \{[^}]*text-overflow: ellipsis/s);
  });

  test('it offers open, copy, change and remove — and nothing new to learn', () => {
    for (const key of [
      'format.linkOpen',
      'format.linkCopy',
      'format.linkEdit',
      'format.removeLink',
    ]) {
      // Plain inclusion rather than a regular expression: a key is a literal,
      // and the first version of this line escaped the dot into `\\.` — which
      // as a pattern means a backslash followed by anything, and matched none
      // of them.
      assert.ok(toolbar.includes(`t('${key}')`), key);
    }
  });

  test('changing and removing are offered only to somebody who may', () => {
    // Open and copy are things a reader does. The other two change the page.
    assert.match(toolbar, /\{canFormat && \(\s*\n\s*<>\s*\n\s*<button[\s\S]{0,400}format\.linkEdit/);
  });

  test('and opening goes through the one function that refuses a script', () => {
    // Not `window.open` from here: `openLink` asks `isFollowable` first, which
    // is the same door the schema and `normaliseHref` stand at (ADR-0157).
    assert.match(toolbar, /openLink\(existingLink\.href\)/);
    assert.doesNotMatch(toolbar, /window\.open\(/);
  });
});
