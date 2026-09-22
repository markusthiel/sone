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
import { BLOCK_ATTRS } from '@sone/core';
import { blockLock, setBlockLocked, isBlockLocked } from '../src/blockLock.js';
import { setBlockStyle } from '../src/commands.js';
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

test('a locked block refuses a change of its appearance, silently (ADR-0194)', () => {
  /*
   * Reported as: *„Ich habe hier einen Info-Block eingesetzt den ich jetzt
   * nicht mehr bearbeiten kann. Weder Farben noch Typ ändern klappt. Es bleibt
   * blau."* The block was locked, and this is why nothing happened.
   *
   * `setBlockStyle` uses `setNodeMarkup`, which produces a `ReplaceAroundStep`
   * — the same step the unlock does, and the filter cannot tell them apart
   * except by the meta the unlock carries. So the refusal is correct: a lock
   * that let the colour through would be a lock over some of the block.
   *
   * What was wrong is that nothing said so. The menu's own dry run asks the
   * command, and the command would act; the refusal happens one layer on, in
   * the filter, where a menu cannot ask. Hence the state on the padlock and the
   * sentence in its place.
   */
  let state = stateWith();
  setBlockLocked(true)(state, (tr) => { state = state.apply(tr); });

  const acted = setBlockStyle({ color: 'red' })(state, (tr) => { state = state.apply(tr); });

  // The command says it acted — that is the trap the menu fell into.
  assert.equal(acted, true);
  // And the document did not change.
  assert.equal(state.doc.child(0).attrs[BLOCK_ATTRS.color] ?? null, null);
});
