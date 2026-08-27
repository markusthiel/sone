/**
 * Enter, and what it continues.
 *
 * ProseMirror's `splitBlock` creates a block of the parent's *default* type, so
 * Enter at the end of a to-do produced a paragraph. Pressing Enter to add the
 * next item is the most common keystroke in a notes app, and getting it wrong
 * means every list has to be re-typed with the slash menu.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { keymap } from 'prosemirror-keymap';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';

import { blockIds } from '../src/blockIds.js';
import { soneKeymap } from '../src/keymap.js';
import { readIndent, schema } from '../src/schema.js';

const block = (
  type: string,
  text: string,
  id: string,
  indent = 0,
  attrs: Record<string, unknown> = {},
) => ({
  type,
  attrs: {
    [BLOCK_ATTRS.id]: id,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: indent > 0 ? String(indent) : null,
    ...attrs,
  },
  content: text ? [{ type: 'text', text }] : undefined,
});

let generated = 0;

/** A state with the real keymap, so Enter goes through the real chain. */
function stateWith(content: unknown[], caret: number): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({ type: 'doc', content }),
    plugins: [
      blockIds({ generateId: () => `gen-${++generated}` }),
      ...soneKeymap().map((plugin) => plugin),
    ],
  });
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(caret))));
}

/** Press Enter by invoking the bound command directly. */
function pressEnter(state: EditorState): EditorState {
  // Read from the plugin's own keymap, so the test exercises the binding the
  // editor installs rather than a command chosen here.
  for (const plugin of state.plugins) {
    const handler = plugin.props?.handleKeyDown;
    if (!handler) continue;
    let next: EditorState = state;
    const handled = handler.call(
      plugin,
      {
        state,
        dispatch: (tr: never) => {
          next = state.apply(tr);
        },
      } as never,
      { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: false, metaKey: false,
        shiftKey: false, altKey: false, preventDefault: () => {} } as never,
    );
    if (handled) return next;
  }
  assert.fail('Enter was not handled');
}

const layout = (state: EditorState): string =>
  state.doc.children
    .map((node) => `${node.type.name}("${node.textContent}")@${readIndent(node.attrs)}`)
    .join(' | ');

test('Enter in a to-do continues with another to-do', () => {
  const state = stateWith([block('todo', 'first task', 't1')], 3);
  const next = pressEnter(
    state.apply(state.tr.setSelection(TextSelection.create(state.doc, 11))),
  );
  assert.equal(layout(next), 'todo("first task")@0 | todo("")@0');
});

test('a new to-do is not already ticked', () => {
  // Inheriting `checked` would be actively wrong rather than merely
  // surprising: the next task would arrive done.
  const state = stateWith([block('todo', 'done task', 't1', 0, { checked: true })], 10);
  const next = pressEnter(state);
  assert.equal(next.doc.child(1).type.name, 'todo');
  assert.equal(next.doc.child(1).attrs['checked'], false);
});

test('Enter in a bullet continues the list', () => {
  const state = stateWith([block('bulletList', 'item', 'b1')], 5);
  assert.equal(layout(pressEnter(state)), 'bulletList("item")@0 | bulletList("")@0');
});

test('Enter keeps the indent', () => {
  // Otherwise the next item in a nested list jumps back to the top level.
  const initial = stateWith(
    [block('bulletList', 'parent', 'b1'), block('bulletList', 'child', 'b2', 1)],
    1,
  );
  // At the end of the nested item, computed rather than guessed: a hand-written
  // position lands mid-word and splits the text instead of adding an item.
  const end = initial.doc.child(0).nodeSize + initial.doc.child(1).nodeSize - 1;
  const state = initial.apply(
    initial.tr.setSelection(TextSelection.near(initial.doc.resolve(end))),
  );

  assert.equal(
    layout(pressEnter(state)),
    'bulletList("parent")@0 | bulletList("child")@1 | bulletList("")@1',
  );
});

test('Enter after a heading starts body text, not another heading', () => {
  // What every editor does. A second heading is almost never what was meant.
  const state = stateWith([block('heading', 'A title', 'h1', 0, { level: 2 })], 8);
  const next = pressEnter(state);
  assert.equal(next.doc.child(1).type.name, 'paragraph');
});

test('Enter on an empty list item leaves the list', () => {
  // Otherwise Enter on an empty bullet creates another empty bullet forever.
  const state = stateWith(
    [block('bulletList', 'item', 'b1'), block('bulletList', '', 'b2')],
    8,
  );
  const next = pressEnter(
    state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(state.doc.content.size - 1)))),
  );
  assert.ok(
    next.doc.children.some((node) => node.type.name === 'paragraph'),
    `expected to leave the list, got ${layout(next)}`,
  );
});

test('the continued block gets its own id', () => {
  // Block ids are globally unique because the projection keys on them; two
  // blocks sharing one would have the second overwrite the first.
  const state = stateWith([block('todo', 'task', 't1')], 5);
  let next = pressEnter(state);
  // The plugin assigns on the following transaction, as it does after any edit.
  next = next.apply(next.tr.insertText('x'));

  const ids = next.doc.children.map((node) => node.attrs[BLOCK_ATTRS.id]);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${JSON.stringify(ids)}`);
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
});
