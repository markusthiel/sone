/**
 * Undo on a canvas (ADR-0043).
 *
 * The property that matters is whose changes it takes back. On a shared board,
 * undo that reverses somebody else's work is undo nobody dares press — so this
 * is tested against a real pair of documents rather than by reading the code.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';

import { addItem, canvasMap, readCanvas } from '../../core/src/doc/canvas.ts';
import { codeOf } from './helpers/source.ts';

test('undo takes back what you did, and cannot reach somebody else', () => {
  const mine = new Y.Doc();
  const theirs = new Y.Doc();

  // The network in miniature: each document's updates arrive at the other with
  // an origin, which is what makes them somebody else's.
  mine.on('update', (update: Uint8Array) => Y.applyUpdate(theirs, update, 'network'));
  theirs.on('update', (update: Uint8Array) => Y.applyUpdate(mine, update, 'network'));

  const undo = new Y.UndoManager(canvasMap(mine));

  addItem(mine, { id: 'ours', kind: 'text', x: 0, y: 0, text: 'Mine' });
  addItem(theirs, { id: 'theirs', kind: 'text', x: 50, y: 0, text: 'Theirs' });

  assert.equal(readCanvas(mine).length, 2, 'both are on the board');

  undo.undo();

  const left = readCanvas(mine).map((item) => item.id);
  assert.deepEqual(left, ['theirs'], 'mine went, theirs stayed');
});

test('redo puts it back', () => {
  const doc = new Y.Doc();
  const undo = new Y.UndoManager(canvasMap(doc));
  addItem(doc, { id: 'one', kind: 'text', x: 0, y: 0 });

  undo.undo();
  assert.deepEqual(readCanvas(doc), []);
  undo.redo();
  assert.equal(readCanvas(doc).length, 1);
});

test('the manager is scoped to the canvas, not to the whole document', () => {
  // Pressing undo on a board must not walk back into the page's title.
  const hook = codeOf(new URL('../src/hooks/useCanvasHistory.ts', import.meta.url));
  assert.match(hook, /new Y\.UndoManager\(canvasMap\(doc\)/);
  // And it is destroyed with the page, or a board left open keeps observing a
  // document nobody is looking at.
  assert.match(hook, /next\.destroy\(\)/);
});

test('undo is not taken over while a note is being typed in', () => {
  // A note's own text has the browser's undo, and one keystroke meaning two
  // things is worse than the shortcut being missing in one place.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /if \(!typing && \(event\.metaKey \|\| event\.ctrlKey\)/);
});
