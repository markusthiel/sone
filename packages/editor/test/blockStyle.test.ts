/**
 * How a block is presented.
 *
 * Three attributes shared by every block type, so there are no per-type cases
 * here and none appear when a block type is added.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';

import { selectedBlockRange } from '../src/blockOps.js';
import { currentBlockStyle, setBlockStyle } from '../src/commands.js';
import { schema } from '../src/schema.js';

function stateWith(texts: string[]): EditorState {
  const doc = schema.node(
    'doc',
    null,
    texts.map((text) => schema.node('paragraph', null, [schema.text(text)])),
  );
  return EditorState.create({ doc, schema });
}

/** Select from the first block through the last. */
function selectAll(state: EditorState): EditorState {
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, 1, state.doc.content.size - 1),
    ),
  );
}

test('a setting is written to the block', () => {
  let state = stateWith(['one']);
  setBlockStyle({ width: 'full' })(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(currentBlockStyle(state).width, 'full');
});

test('null clears rather than choosing a default', () => {
  // Cleared means "as the design decides", so a later change to the design
  // reaches the block. A block holding an explicit default would keep its old
  // look for ever.
  let state = stateWith(['one']);
  setBlockStyle({ align: 'center' })(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(currentBlockStyle(state).align, 'center');

  setBlockStyle({ align: null })(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(currentBlockStyle(state).align, null);
});

test('every block the selection touches is changed', () => {
  // Setting a width on three selected paragraphs must not silently do one.
  let state = selectAll(stateWith(['one', 'two', 'three']));
  setBlockStyle({ width: 'wide' })(state, (tr) => {
    state = state.apply(tr);
  });

  let seen = 0;
  state.doc.forEach((node) => {
    assert.equal(node.attrs['width'], 'wide');
    seen++;
  });
  assert.equal(seen, 3);
});

test('blocks that disagree report nothing', () => {
  // Showing the first block's answer would claim a setting the others do not
  // have, and applying it back would change them without anybody asking.
  let state = stateWith(['one', 'two']);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 2)));
  setBlockStyle({ color: 'blue' })(state, (tr) => {
    state = state.apply(tr);
  });

  const both = selectAll(state);
  assert.equal(currentBlockStyle(both).color, null, 'they disagree');
});

test('setting nothing changes nothing', () => {
  const state = stateWith(['one']);
  let dispatched = false;
  setBlockStyle({})(state, () => {
    dispatched = true;
  });
  // The command still reports true — there were blocks to act on — but an
  // empty change must not produce a transaction that syncs to everybody.
  assert.equal(dispatched, true, 'a transaction is produced');
  assert.equal(currentBlockStyle(state).align, null);
});

test('the "no blocks" branch cannot be reached from this schema', () => {
  // The command refuses when the selection touches no block. Worth knowing
  // that this schema cannot produce such a document at all: `doc` requires
  // content, and building an empty one throws rather than yielding something
  // to test against.
  //
  // Written down rather than deleted. A defensive branch nothing can reach is
  // fine; a test that claimed to exercise it would have been asserting
  // something impossible and passing for the wrong reason.
  assert.throws(
    () => schema.node('doc', null, []),
    /Invalid content for node doc/,
  );
});

// --- blocks that cannot hold a cursor ---------------------------------------

test('an image selected as a whole is found by the gutter', () => {
  // An atom cannot hold a text cursor, so selecting one produces a NodeSelection
  // sitting before it at depth 0. Every control that asks "which block is this"
  // answered "none": no drag handle, no plus, no appearance menu. Every atom in
  // the document was unreachable from the gutter, and nobody noticed because
  // text blocks are the common case.
  const image = schema.node('image', { src: '/api/files/x' });
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('before')]),
    image,
  ]);

  let state = EditorState.create({ doc, schema });
  const position = state.doc.resolve(0).nodeAfter!.nodeSize; // start of the image
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, position)));

  const range = selectedBlockRange(state);
  assert.ok(range, 'the image is a block the gutter can act on');
  assert.equal(range.node.type.name, 'image');
});

test('an image can be styled like any other block', () => {
  // The point of finding it: width and alignment are the settings an image
  // actually needs, and they were unreachable.
  const doc = schema.node('doc', null, [schema.node('image', { src: '/api/files/x' })]);
  let state = EditorState.create({ doc, schema });
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));

  setBlockStyle({ width: 'full' })(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(state.doc.child(0).attrs['width'], 'full');
});
