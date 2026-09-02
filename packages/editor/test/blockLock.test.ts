/**
 * Locking a single block (ADR-0049).
 *
 * The case the page lock cannot serve: a page of working notes with one table
 * of figures that must not move.
 *
 * The second test is the one that earned its place. It unlocks what the first
 * locked, and found that my filter refused the unlock — `setNodeMarkup`
 * produces a `ReplaceAroundStep`, so locking a block had locked away the only
 * way out. A test that only ever locks would have passed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { blockLock, setBlockLocked, isBlockLocked } from '../src/blockLock.js';
import { schema } from '../src/schema.js';

function stateWith(): EditorState {
  let state = EditorState.create({ schema, plugins: [blockLock()] });
  state = state.apply(state.tr.insertText('Figures that must not move', 1));
  return state;
}

test('a locked block refuses an edit inside it', () => {
  let state = stateWith();
  // Lock the paragraph.
  const locked = setBlockLocked(true)(state, (tr) => { state = state.apply(tr); });
  assert.equal(locked, true);
  assert.equal(isBlockLocked(state.doc.child(0)), true);

  // Typing into it is refused by the filter, not by a guarded command.
  const before = state.doc.textContent;
  const after = state.apply(state.tr.insertText('!', 5));
  assert.equal(after.doc.textContent, before, 'unchanged');
});

test('unlocking works while it is locked', () => {
  let state = stateWith();
  setBlockLocked(true)(state, (tr) => { state = state.apply(tr); });
  setBlockLocked(false)(state, (tr) => { state = state.apply(tr); });
  assert.equal(isBlockLocked(state.doc.child(0)), false);
  const typed = state.apply(state.tr.insertText('!', 5));
  assert.match(typed.doc.textContent, /!/);
});

test('an unlocked block beside a locked one still takes an edit', () => {
  let state = stateWith();
  state = state.apply(state.tr.split(state.doc.content.size - 1));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
  setBlockLocked(true)(state, (tr) => { state = state.apply(tr); });

  const last = state.doc.childCount - 1;
  assert.equal(isBlockLocked(state.doc.child(0)), true);
  assert.equal(isBlockLocked(state.doc.child(last)), false);
  const at = state.doc.content.size - 1;
  const typed = state.apply(state.tr.insertText('x', at));
  assert.match(typed.doc.textContent, /x/, 'the other block is editable');
});
