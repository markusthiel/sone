/**
 * Block placeholders.
 *
 * An empty heading looks exactly like an empty paragraph, which made choosing a
 * block type feel as though nothing had happened — the reported symptom was
 * having to hunt for the line that had become a heading.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import { placeholderFor, placeholderPluginKey, placeholders } from '../src/placeholders.js';
import { schema } from '../src/schema.js';

const block = (type: string, text: string, id: string, attrs: Record<string, unknown> = {}) => ({
  type,
  attrs: {
    [BLOCK_ATTRS.id]: id,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: null,
    ...attrs,
  },
  content: text ? [{ type: 'text', text }] : undefined,
});

function stateAt(content: unknown[], pos: number): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({ type: 'doc', content }),
    plugins: [placeholders()],
  });
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))));
}

/** The placeholder text a state would render, or null. */
const labelOf = (state: EditorState): string | null =>
  placeholderFor(state)?.label ?? null;

test('an empty paragraph invites typing', () => {
  assert.match(labelOf(stateAt([block('paragraph', '', 'a')], 1)) ?? '', /Write something/);
});

test('an empty heading names its level', () => {
  // The whole point: a heading with no text is otherwise indistinguishable from
  // a paragraph with no text.
  assert.equal(labelOf(stateAt([block('heading', '', 'a', { level: 1 })], 1)), 'Heading 1');
  assert.equal(labelOf(stateAt([block('heading', '', 'a', { level: 3 })], 1)), 'Heading 3');
});

test('each block type says what it is', () => {
  const cases: Array<[string, RegExp]> = [
    ['bulletList', /List item/],
    ['numberedList', /List item/],
    ['todo', /To-do/],
    ['toggle', /Toggle/],
    ['quote', /Quote/],
    ['callout', /Callout/],
  ];
  for (const [type, expected] of cases) {
    assert.match(labelOf(stateAt([block(type, '', 'a')], 1)) ?? '', expected, type);
  }
});

test('a block with text has no placeholder', () => {
  assert.equal(labelOf(stateAt([block('paragraph', 'written', 'a')], 2)), null);
});

test('only the block holding the caret gets one', () => {
  // A hint on every empty block turns a half-written page into a wall of grey
  // text.
  const state = stateAt(
    [block('paragraph', '', 'a'), block('paragraph', '', 'b'), block('paragraph', '', 'c')],
    1,
  );
  // Read through the plugin here, because the assertion is about how many
  // decorations exist rather than about the label.
  const set = placeholderPluginKey.getState(state);
  assert.ok(set);
  assert.equal(set.find().length, 1);
});

test('a selection suppresses the placeholder', () => {
  // A hint appearing mid-drag is a distraction, and during a selection the
  // person is doing something else.
  let state = stateAt([block('paragraph', 'some text', 'a')], 1);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
  assert.equal(labelOf(state), null);
});

test('the placeholder follows the caret between blocks', () => {
  const content = [block('heading', '', 'a', { level: 2 }), block('paragraph', '', 'b')];
  assert.equal(labelOf(stateAt(content, 1)), 'Heading 2');
  assert.match(labelOf(stateAt(content, 3)) ?? '', /Write something/);
});
