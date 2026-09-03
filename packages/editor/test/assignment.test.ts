/**
 * Assigning a task (ADR-0052).
 *
 * Ids rather than names, only on a task, and the chip is a widget rather than
 * text — the last of which is what stops somebody selecting a colleague's name
 * and pasting it into another page as if it were content.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState, TextSelection } from 'prosemirror-state';

import { readAssignee, setAssignee } from '../src/assignment.js';
import { schema } from '../src/schema.js';

function withTask(): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('todo', null, [schema.text('Rechnung prüfen')]),
    schema.node('paragraph', null, [schema.text('Ein Satz')]),
  ]);
  return EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
}

test('a task takes an assignee, by id', () => {
  let state = withTask();
  const ok = setAssignee('user-b')(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(ok, true);
  assert.equal(readAssignee(state.doc.child(0)), 'user-b');
});

test('clearing it removes the property rather than emptying it', () => {
  let state = withTask();
  setAssignee('user-b')(state, (tr) => { state = state.apply(tr); });
  setAssignee(null)(state, (tr) => { state = state.apply(tr); });
  assert.equal(readAssignee(state.doc.child(0)), null);
});

test('a paragraph cannot be assigned', () => {
  // A paragraph assigned to somebody is a note about them rather than work, and
  // offering it everywhere would make the notification mean less each time.
  const state = withTask();
  const inParagraph = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 2)),
  );
  assert.equal(setAssignee('user-b')(inParagraph, () => {}), false);
});
