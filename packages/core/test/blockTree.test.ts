/**
 * Block tree read and write.
 *
 * The tree walk here is the one the server's materialiser uses, so anything it
 * gets wrong is wrong in the projection and in search too.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import { BLOCK_ATTRS } from '../src/doc/docSchema.js';
import {
  findBlockElement,
  pageContent,
  readBlockTree,
  serialiseProps,
  setBlockProps,
  setPageBlocks,
} from '../src/doc/blockTree.js';

// --- setBlockProps ---------------------------------------------------------

test('setBlockProps changes one property and leaves the others', () => {
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

test('a written property is readable as a node attribute, not only as props', () => {
  // ProseMirror node attributes are the canonical storage: they are what
  // y-prosemirror writes and what the editor reads back. Writing into the props
  // JSON instead produced a value the projection could see and the editor could
  // not — so ticking a box in the task panel changed nothing on the page.
  const doc = new Y.Doc();
  setPageBlocks(doc, [{ id: 'a', type: 'todo', text: 'task', props: {} }]);

  setBlockProps(doc, 'a', { checked: true });

  const element = findBlockElement(doc, 'a')!;
  assert.equal(element.getAttribute('checked'), true, 'stored as an attribute');
  doc.destroy();
});

test('node attributes reach the props a reader sees', () => {
  // y-prosemirror stores an attribute with its original type, so `level` is the
  // number 3 rather than the string "3". A guard that skipped non-strings
  // skipped every attribute the editor had written — the outline saw no heading
  // levels and the task panel saw no checked state.
  const doc = new Y.Doc();
  const fragment = pageContent(doc);
  doc.transact(() => {
    const element = new Y.XmlElement('heading');
    element.setAttribute(BLOCK_ATTRS.id, 'h1');
    // A number, as the editor writes it.
    element.setAttribute('level', 3 as never);
    element.insert(0, [new Y.XmlText('title')]);
    fragment.insert(0, [element]);
  });

  const { blocks } = readBlockTree(doc);
  assert.equal(blocks[0]!.props['level'], 3);
  doc.destroy();
});

test('a string attribute is coerced to the type it serialised from', () => {
  // An element written by an importer or parsed from XML has strings, and the
  // same document can hold both shapes.
  const doc = new Y.Doc();
  const fragment = pageContent(doc);
  doc.transact(() => {
    const element = new Y.XmlElement('todo');
    element.setAttribute(BLOCK_ATTRS.id, 't1');
    element.setAttribute('checked', 'true');
    element.setAttribute('level', '2');
    element.setAttribute('label', 'not-a-number');
    element.setAttribute('odd', '007');
    fragment.insert(0, [element]);
  });

  const props = readBlockTree(doc).blocks[0]!.props;
  assert.equal(props['checked'], true);
  assert.equal(props['level'], 2);
  assert.equal(props['label'], 'not-a-number');
  // Only a value that round-trips exactly becomes a number, so "007" stays a
  // string rather than silently becoming 7.
  assert.equal(props['odd'], '007');
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

test('a block’s text is text, not serialised markup', () => {
  // `Y.XmlText.toString()` serialises: a bold word comes back as
  // `<strong>bold</strong>`. Every mark in every document was going into the
  // search index as literal tags — so searching for "strong" matched half a
  // workspace, and a word at the start of a bold run could not be found at all.
  const doc = new Y.Doc();
  const fragment = pageContent(doc);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.setAttribute(BLOCK_ATTRS.id, 'b1');
  const text = new Y.XmlText();
  text.insert(0, 'Hello world');
  text.format(0, 5, { strong: {} });
  paragraph.insert(0, [text]);
  fragment.insert(0, [paragraph]);

  const { blocks } = readBlockTree(doc);
  assert.equal(blocks[0]?.text, 'Hello world');
  assert.doesNotMatch(blocks[0]?.text ?? '', /</);
});
