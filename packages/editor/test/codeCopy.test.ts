/**
 * Copying code.
 *
 * The rule worth testing is what gets copied, not that a button exists: reading
 * the DOM would pick up whatever the renderer added, and copying the selection
 * would copy nothing when the caret merely sits inside a code phrase.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import { codeTextAt } from '../src/codeCopy.js';
import { schema } from '../src/schema.js';

const attrs = (id: string) => ({
  [BLOCK_ATTRS.id]: id,
  [BLOCK_ATTRS.props]: null,
  [BLOCK_ATTRS.indent]: null,
});

function stateAt(content: unknown[], pos: number, to?: number): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({ type: 'doc', content }),
  });
  return state.apply(
    state.tr.setSelection(
      to === undefined
        ? TextSelection.near(state.doc.resolve(pos))
        : TextSelection.create(state.doc, pos, to),
    ),
  );
}

test('the caret in a code block copies the whole block', () => {
  const state = stateAt(
    [
      {
        type: 'code',
        attrs: attrs('c1'),
        content: [{ type: 'text', text: 'npm install sone' }],
      },
    ],
    3,
  );
  assert.equal(codeTextAt(state), 'npm install sone');
});

test('a partial selection in a code block still copies the whole block', () => {
  // The button on a code block means "this block", not "what I happen to have
  // highlighted".
  const state = stateAt(
    [{ type: 'code', attrs: attrs('c1'), content: [{ type: 'text', text: 'one two' }] }],
    2,
    5,
  );
  assert.equal(codeTextAt(state), 'one two');
});

test('the caret inside inline code copies the whole run', () => {
  // Somebody who marked three words as code and put the caret in the middle
  // means those three words. Copying the selection would copy nothing.
  const state = stateAt(
    [
      {
        type: 'paragraph',
        attrs: attrs('p1'),
        content: [
          { type: 'text', text: 'run ' },
          { type: 'text', text: 'git status', marks: [{ type: 'inlineCode' }] },
          { type: 'text', text: ' first' },
        ],
      },
    ],
    8,
  );
  assert.equal(codeTextAt(state), 'git status');
});

test('plain text offers nothing to copy', () => {
  // Which is what tells the toolbar not to show the button.
  const state = stateAt(
    [{ type: 'paragraph', attrs: attrs('p1'), content: [{ type: 'text', text: 'ordinary' }] }],
    3,
  );
  assert.equal(codeTextAt(state), null);
});

test('a caret just outside a code run offers nothing', () => {
  const state = stateAt(
    [
      {
        type: 'paragraph',
        attrs: attrs('p1'),
        content: [
          { type: 'text', text: 'x', marks: [{ type: 'inlineCode' }] },
          { type: 'text', text: ' plain' },
        ],
      },
    ],
    6,
  );
  assert.equal(codeTextAt(state), null);
});

test('an empty code block copies nothing rather than throwing', () => {
  const state = stateAt([{ type: 'code', attrs: attrs('c1') }], 1);
  assert.equal(codeTextAt(state), '');
});
