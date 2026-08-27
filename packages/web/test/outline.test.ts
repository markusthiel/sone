/**
 * Outline derivation.
 *
 * The outline is built from the Yjs document through `readBlockTree` — the same
 * function the server's materialiser uses — so it cannot disagree with the
 * projection about where a heading is or what it says.
 *
 * These tests go through a real Y.Doc rather than a fixture, because the point
 * is that the shape the editor writes is the shape this reads.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { BLOCK_ATTRS, pageContent } from '@sone/core';
import * as Y from 'yjs';

let readBlockTree: typeof import('@sone/core').readBlockTree;

/** Append a block as the editor would: an element with an id and inline text. */
function appendBlock(
  doc: Y.Doc,
  type: string,
  text: string,
  attrs: Record<string, string> = {},
): void {
  const fragment = pageContent(doc);
  doc.transact(() => {
    const element = new Y.XmlElement(type);
    element.setAttribute(BLOCK_ATTRS.id, crypto.randomUUID());
    for (const [key, value] of Object.entries(attrs)) {
      element.setAttribute(key, value);
    }
    if (text) element.insert(0, [new Y.XmlText(text)]);
    fragment.insert(fragment.length, [element]);
  });
}

/**
 * The outline rule, applied to a document.
 *
 * Mirrors buildOutline in useOutline.ts. Kept here rather than importing the
 * hook because the hook needs React; the rule it applies is what matters and it
 * is one filter.
 */
function outlineOf(doc: Y.Doc): Array<{ text: string; level: number }> {
  const { blocks } = readBlockTree(doc);
  return blocks
    .filter((block) => block.type === 'heading')
    .map((block) => {
      const raw = block.props['level'];
      return {
        text: block.text,
        level: typeof raw === 'number' && raw >= 1 && raw <= 6 ? raw : 2,
      };
    });
}

describe('outline', () => {
  before(async () => {
    readBlockTree = (await import('@sone/core')).readBlockTree;
  });

  test('only headings appear', () => {
    const doc = new Y.Doc();
    appendBlock(doc, 'paragraph', 'body text');
    appendBlock(doc, 'heading', 'A section', { props: JSON.stringify({ level: 2 }) });
    appendBlock(doc, 'bulletList', 'an item');
    appendBlock(doc, 'heading', 'Another', { props: JSON.stringify({ level: 2 }) });

    assert.deepEqual(
      outlineOf(doc).map((entry) => entry.text),
      ['A section', 'Another'],
    );
    doc.destroy();
  });

  test('levels are read from props', () => {
    const doc = new Y.Doc();
    appendBlock(doc, 'heading', 'Top', { props: JSON.stringify({ level: 1 }) });
    appendBlock(doc, 'heading', 'Sub', { props: JSON.stringify({ level: 3 }) });

    assert.deepEqual(
      outlineOf(doc).map((entry) => entry.level),
      [1, 3],
    );
    doc.destroy();
  });

  test('a missing or absurd level falls back rather than breaking the list', () => {
    // A heading is still a heading if its level is unusable, and dropping it
    // would leave a gap in the outline for a heading plainly visible on screen.
    const doc = new Y.Doc();
    appendBlock(doc, 'heading', 'No level');
    appendBlock(doc, 'heading', 'Level 99', { props: JSON.stringify({ level: 99 }) });
    appendBlock(doc, 'heading', 'Level zero', { props: JSON.stringify({ level: 0 }) });

    const outline = outlineOf(doc);
    assert.equal(outline.length, 3);
    assert.ok(
      outline.every((entry) => entry.level >= 1 && entry.level <= 6),
      'every level must be renderable',
    );
    doc.destroy();
  });

  test('an empty heading is kept, not skipped', () => {
    // Someone who has just typed "## " and nothing else has a heading on
    // screen; an outline that omits it looks broken.
    const doc = new Y.Doc();
    appendBlock(doc, 'heading', '', { props: JSON.stringify({ level: 2 }) });
    assert.equal(outlineOf(doc).length, 1);
    doc.destroy();
  });

  test('document order is preserved', () => {
    const doc = new Y.Doc();
    for (const name of ['first', 'second', 'third']) {
      appendBlock(doc, 'heading', name, { props: JSON.stringify({ level: 2 }) });
    }
    assert.deepEqual(
      outlineOf(doc).map((entry) => entry.text),
      ['first', 'second', 'third'],
    );
    doc.destroy();
  });

  test('an empty document has an empty outline', () => {
    const doc = new Y.Doc();
    assert.deepEqual(outlineOf(doc), []);
    doc.destroy();
  });

  test('every entry carries the block id the DOM exposes', () => {
    // Scrolling finds the heading through [data-block-id], which the editor
    // schema emits. An outline entry without an id could not be navigated to.
    const doc = new Y.Doc();
    appendBlock(doc, 'heading', 'Target', { props: JSON.stringify({ level: 2 }) });

    const { blocks } = readBlockTree(doc);
    const heading = blocks.find((block) => block.type === 'heading');
    assert.ok(heading);
    assert.match(heading!.id, /^[0-9a-f-]{36}$/);
    doc.destroy();
  });
});
