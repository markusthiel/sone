/**
 * Block operations.
 *
 * Every test here corresponds to a way of quietly damaging a document. Text
 * blocks are flat siblings whose parent-child relationship is an `indent`
 * attribute (ADR-0018), so a block's children are the following blocks with a
 * greater indent — not nodes inside it. Any operation that forgets that
 * produces a document that does not throw, does not look broken, and is wrong.
 *
 * The indent case shipped before these existed: indenting a parent shifted only
 * the parent, and its children became its siblings.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';

import { blockIds, collectBlockIds } from '../src/blockIds.js';
import {
  blockRangeAt,
  deleteBlockSubtree,
  duplicateBlockSubtree,
  indentBlockSubtree,
  moveBlockDown,
  moveBlockUp,
  outdentBlockSubtree,
  selectedBlockRange,
} from '../src/blockOps.js';
import { readIndent, schema } from '../src/schema.js';

/** `text@indent` for every top-level block, which is what these tests assert. */
const layout = (state: EditorState): string =>
  state.doc.children.map((n) => `${n.textContent}@${readIndent(n.attrs)}`).join(' ');

const li = (text: string, id: string, indent = 0) => ({
  type: 'bulletList',
  attrs: {
    [BLOCK_ATTRS.id]: id,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: indent > 0 ? String(indent) : null,
  },
  content: [{ type: 'text', text }],
});

let ids = 0;
function docWith(content: unknown[], caretAtIndex: number): EditorState {
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({ type: 'doc', content }),
    plugins: [blockIds({ generateId: () => `gen-${++ids}` })],
  });
  let pos = 1;
  for (let i = 0; i < caretAtIndex; i++) pos += state.doc.child(i).nodeSize;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function apply(state: EditorState, command: Command, label: string): EditorState {
  let next: EditorState | null = null;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  assert.ok(ok, `command refused: ${label}`);
  return next!;
}

// --- range detection -------------------------------------------------------

test('a block range covers its indented descendants', () => {
  const state = docWith(
    [li('a', '1'), li('a.1', '2', 1), li('a.1.1', '3', 2), li('b', '4')],
    0,
  );
  const range = blockRangeAt(state.doc, 0, 0)!;
  assert.equal(range.index, 0);
  assert.equal(range.endIndex, 3, 'a, a.1 and a.1.1 — but not b');
});

test('a range stops at a sibling of the same indent', () => {
  const state = docWith([li('a', '1'), li('b', '2'), li('b.1', '3', 1)], 0);
  assert.equal(blockRangeAt(state.doc, 0, 0)!.endIndex, 1, 'a has no children');
});

test('a leaf block has a range of one', () => {
  const state = docWith([li('only', '1')], 0);
  const range = selectedBlockRange(state)!;
  assert.equal(range.endIndex - range.index, 1);
});

// --- indent ----------------------------------------------------------------

test('indenting a block takes its children with it', () => {
  // The bug that shipped: shifting only the parent made its child a sibling.
  let state = docWith([li('first', '1'), li('parent', '2'), li('child', '3', 1)], 1);
  state = apply(state, indentBlockSubtree, 'indent');
  assert.equal(layout(state), 'first@0 parent@1 child@2');
});

test('indenting takes a whole deep subtree', () => {
  let state = docWith(
    [li('first', '1'), li('p', '2'), li('c', '3', 1), li('g', '4', 2), li('after', '5')],
    1,
  );
  state = apply(state, indentBlockSubtree, 'indent');
  assert.equal(layout(state), 'first@0 p@1 c@2 g@3 after@0', 'after is untouched');
});

test('the first block of a document cannot be indented', () => {
  // No preceding sibling to become its parent, and the tree reader would
  // normalise the indent back to 0 anyway.
  const state = docWith([li('only', '1'), li('second', '2')], 0);
  assert.equal(indentBlockSubtree(state, undefined), false);
});

test('a block cannot be indented more than one level below its predecessor', () => {
  const state = docWith([li('a', '1'), li('b', '2', 1)], 1);
  assert.equal(indentBlockSubtree(state, undefined), false);
});

test('outdenting takes children with it', () => {
  let state = docWith([li('a', '1'), li('b', '2', 1), li('c', '3', 2)], 1);
  state = apply(state, outdentBlockSubtree, 'outdent');
  assert.equal(layout(state), 'a@0 b@0 c@1');
});

test('outdenting at the top level is refused', () => {
  const state = docWith([li('a', '1')], 0);
  assert.equal(outdentBlockSubtree(state, undefined), false);
});

// --- moving ----------------------------------------------------------------

test('moving down swaps with the next sibling, subtrees intact', () => {
  let state = docWith([li('a', '1'), li('a.1', '2', 1), li('b', '3'), li('b.1', '4', 1)], 0);
  state = apply(state, moveBlockDown, 'move down');
  assert.equal(layout(state), 'b@0 b.1@1 a@0 a.1@1');
});

test('moving up swaps with the previous sibling, subtrees intact', () => {
  let state = docWith([li('a', '1'), li('a.1', '2', 1), li('b', '3'), li('b.1', '4', 1)], 2);
  state = apply(state, moveBlockUp, 'move up');
  assert.equal(layout(state), 'b@0 b.1@1 a@0 a.1@1');
});

test('moving up does not reparent into the block above', () => {
  // Moving past a *child* of the previous block would put this block inside it,
  // which is a reparenting rather than a reorder and not what was asked for.
  const state = docWith([li('parent', '1'), li('child', '2', 1)], 1);
  assert.equal(moveBlockUp(state, undefined), false, 'the child has no sibling above');
});

test('moving down at the end is refused', () => {
  const state = docWith([li('a', '1'), li('b', '2')], 1);
  assert.equal(moveBlockDown(state, undefined), false);
});

test('moving down past a deeper sibling is refused rather than reparenting', () => {
  const state = docWith([li('a', '1'), li('a.1', '2', 1)], 1);
  assert.equal(moveBlockDown(state, undefined), false);
});

test('a move preserves every block id', () => {
  // A move must not look like a delete and an insert to the projection, or the
  // page's blocks all change identity and every reference to them breaks.
  let state = docWith([li('a', '1'), li('a.1', '2', 1), li('b', '3')], 0);
  const before = [...collectBlockIds(state)].sort();
  state = apply(state, moveBlockDown, 'move down');
  assert.deepEqual([...collectBlockIds(state)].sort(), before);
});

// --- duplicate -------------------------------------------------------------

test('duplicating copies the subtree', () => {
  let state = docWith([li('a', '1'), li('a.1', '2', 1), li('b', '3')], 0);
  state = apply(state, duplicateBlockSubtree, 'duplicate');
  assert.equal(layout(state), 'a@0 a.1@1 a@0 a.1@1 b@0');
});

test('duplicating gives the copies fresh ids', () => {
  // Block ids are globally unique — the projection keys on them — so copying
  // them would have two blocks claiming one row and the second overwriting the
  // first.
  let state = docWith([li('a', '1'), li('a.1', '2', 1)], 0);
  state = apply(state, duplicateBlockSubtree, 'duplicate');

  // The plugin assigns ids on the next transaction, as it does after any edit.
  state = state.apply(state.tr.insertText('!', 1));

  const all = collectBlockIds(state);
  assert.equal(all.length, 4);
  assert.equal(new Set(all).size, 4, 'every id must be distinct');
  assert.ok(all.includes('1') && all.includes('2'), 'the originals keep theirs');
});

// --- delete ----------------------------------------------------------------

test('deleting removes the subtree', () => {
  // Deleting only the block would leave its children at a greater indent, where
  // the tree reader reattaches them to whatever now precedes them.
  let state = docWith([li('a', '1'), li('a.1', '2', 1), li('a.1.1', '3', 2), li('b', '4')], 0);
  state = apply(state, deleteBlockSubtree, 'delete');
  assert.equal(layout(state), 'b@0');
});

test('deleting the only block leaves an empty paragraph', () => {
  // The schema requires at least one block, and an empty document cannot be
  // typed into.
  let state = docWith([li('only', '1')], 0);
  state = apply(state, deleteBlockSubtree, 'delete');
  assert.equal(state.doc.childCount, 1);
  assert.equal(state.doc.firstChild!.type.name, 'paragraph');
  assert.equal(state.doc.firstChild!.textContent, '');
});

test('deleting a block keeps unrelated siblings', () => {
  let state = docWith([li('a', '1'), li('b', '2'), li('b.1', '3', 1), li('c', '4')], 1);
  state = apply(state, deleteBlockSubtree, 'delete');
  assert.equal(layout(state), 'a@0 c@0');
});
