/**
 * The `/` menu's rows (ADR-0037 brought the last of them).
 *
 * Two things are checked here: that every block on offer has a mark, and that
 * the highlight follows a mouse rather than only a mouse that has just arrived.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const menu = codeOf(new URL('../src/components/SlashMenu.tsx', import.meta.url));

test('the highlight follows the mouse while it is moving, not only on entry', () => {
  // `pointerenter` fires once. Two ordinary things then leave the highlight
  // elsewhere with the mouse sitting on this row and no event to correct it:
  // the arrow keys move the selection away, and scrolling slides a different
  // row under a stationary pointer. Both read as "the mouse is not over the
  // entry", which is what was reported.
  assert.match(menu, /onPointerMove=\{\(\) => \{/);
  assert.match(menu, /if \(!selected\) setSlashIndex\(view, index\)/);
  // Guarded, or an idle wobble dispatches a transaction per pixel.
  assert.doesNotMatch(menu, /onPointerMove=\{\(\) => setSlashIndex/);
});

test('every item can be marked, and one without a mark keeps its place', () => {
  // A list where some names are indented and others are not is harder to scan
  // than a list with no marks at all.
  assert.match(menu, /const MARKS = BLOCK_MARKS;/);
  assert.match(menu, /<span className="slash-mark">\{Icon \? <Icon \/> : null\}<\/span>/);

  // Every item the editor offers has one, checked against the editor's own list
  // rather than a copy of it — so adding a block shows up here. The table is
  // shared with the gutter's "Turn into" list now, so this reads that file.
  const marks = codeOf(new URL('../src/components/blockMarks.ts', import.meta.url));
  const items = codeOf(new URL('../../editor/src/slashMenu.ts', import.meta.url));
  const ids = [...items.matchAll(/^\s*id: '([\w-]+)'/gm)].map(([, id]) => id);
  assert.ok(ids.length >= 14, 'the item list was found');
  for (const id of ids) {
    assert.match(marks, new RegExp(`\\b'?${id}'?: \\w+Icon`), `${id} has a mark`);
  }
});

test('the headings share one mark', () => {
  // Three symbols meaning the same thing at different sizes would be three
  // symbols to learn for one idea; the names already say which level.
  const marks = codeOf(new URL('../src/components/blockMarks.ts', import.meta.url));
  const table = marks.slice(marks.indexOf('export const BLOCK_MARKS'));
  // Four now, not three: the gutter offers a heading at any level, so the table
  // carries the bare `heading` beside the menu's three.
  assert.equal([...table.matchAll(/HashIcon/g)].length, 4);
});
