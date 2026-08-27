/**
 * Block tree read and write.
 *
 * The tree walk here is the one the server's materialiser uses, so anything it
 * gets wrong is wrong in the projection and in search too.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import {
  readBlockTree,
  serialiseProps,
  setBlockProps,
  setPageBlocks,
} from '../src/doc/blockTree.js';

// --- setBlockProps ---------------------------------------------------------

test('setBlockProps changes one block and merges the patch', () => {
  // Merged rather than replaced: a caller that knows about `checked` should not
  // have to know what else a block carries, and replacing would silently drop
  // properties written by a newer version of SONE.
  const doc = new Y.Doc();
  setPageBlocks(doc, [
    { id: 'a', type: 'todo', text: 'task', props: { checked: false, colour: 'red' } },
  ]);

  assert.equal(setBlockProps(doc, 'a', { checked: true }), true);

  const { blocks } = readBlockTree(doc);
  assert.equal(blocks[0]!.props['checked'], true);
  assert.equal(blocks[0]!.props['colour'], 'red', 'other props survive');
  doc.destroy();
});

test('setBlockProps finds a nested block', () => {
  // A task inside a table cell or under an indented parent is still a task.
  const doc = new Y.Doc();
  setPageBlocks(doc, [
    { id: 'parent', type: 'bulletList', text: 'outer', props: {} },
    { id: 'child', type: 'todo', text: 'inner', props: { checked: false }, indent: 1 },
  ]);

  assert.equal(setBlockProps(doc, 'child', { checked: true }), true);
  const { blocks } = readBlockTree(doc);
  assert.equal(blocks.find((b) => b.id === 'child')!.props['checked'], true);
  doc.destroy();
});

test('setBlockProps reports a missing block rather than throwing', () => {
  // A normal outcome: a panel built a moment ago may describe a document that
  // has since changed.
  const doc = new Y.Doc();
  setPageBlocks(doc, [{ id: 'a', type: 'paragraph', text: 'x', props: {} }]);
  assert.equal(setBlockProps(doc, 'gone', { checked: true }), false);
  doc.destroy();
});

test('setting a prop to undefined removes it', () => {
  // Absent and null mean different things to a reader that checks for presence.
  const doc = new Y.Doc();
  setPageBlocks(doc, [
    { id: 'a', type: 'todo', text: 'x', props: { checked: true, note: 'keep' } },
  ]);
  setBlockProps(doc, 'a', { checked: undefined });
  const { blocks } = readBlockTree(doc);
  assert.equal('checked' in blocks[0]!.props, false);
  assert.equal(blocks[0]!.props['note'], 'keep');
  doc.destroy();
});

test('props serialise with sorted keys', () => {
  // The same props must always produce the same string, or two writers record a
  // CRDT change for something nobody edited.
  assert.equal(
    serialiseProps({ b: 2, a: 1 }),
    serialiseProps({ a: 1, b: 2 }),
  );
  assert.equal(serialiseProps({}), null, 'empty is absent, not "{}"');
});
