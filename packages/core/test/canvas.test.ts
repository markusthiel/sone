/**
 * A canvas and the things on it (ADR-0043).
 *
 * The property that matters is the one the record is about: two people moving
 * two different things must not meet. So these are merge tests, not shape tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';

import {
  addItem,
  bringToFront,
  canvasText,
  moveItem,
  readCanvas,
  removeItem,
} from '../src/doc/canvas.js';

function docWith(items: Parameters<typeof addItem>[1][]): Y.Doc {
  const doc = new Y.Doc();
  for (const item of items) addItem(doc, item);
  return doc;
}

test('two people moving two things merge without meeting', () => {
  // The reason the items are a map keyed by id and not an array: a move is two
  // numbers on one key, so these two edits touch different data entirely.
  const a = docWith([
    { id: 'one', kind: 'text', x: 0, y: 0, text: 'One' },
    { id: 'two', kind: 'text', x: 100, y: 0, text: 'Two' },
  ]);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  moveItem(a, 'one', 50, 60);
  moveItem(b, 'two', 300, 400);

  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  for (const doc of [a, b]) {
    const items = Object.fromEntries(readCanvas(doc).map((item) => [item.id, item]));
    assert.deepEqual([items['one']?.x, items['one']?.y], [50, 60]);
    assert.deepEqual([items['two']?.x, items['two']?.y], [300, 400]);
  }
});

test('two people moving the same thing end up in one place, not between', () => {
  // Last writer wins on that key, and that is the honest outcome: there is no
  // merge of "here" and "there" that is not simply one of them. What must not
  // happen is an average, or an item in two places.
  const a = docWith([{ id: 'one', kind: 'text', x: 0, y: 0 }]);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  moveItem(a, 'one', 10, 10);
  moveItem(b, 'one', 90, 90);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  const from = readCanvas(a)[0];
  const to = readCanvas(b)[0];
  assert.deepEqual([from?.x, from?.y], [to?.x, to?.y], 'both screens agree');
  assert.ok([10, 90].includes(from?.x ?? -1), 'and it is one of the two, not an average');
});

test('two people typing in one text box merge', () => {
  // A text item holds Y.Text rather than a string, which is the difference
  // between merging and overwriting.
  const a = docWith([{ id: 'one', kind: 'text', x: 0, y: 0, text: 'Hello' }]);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  const textOf = (doc: Y.Doc): Y.Text =>
    (doc.getMap('canvas').get('one') as Y.Map<unknown>).get('text') as Y.Text;
  textOf(a).insert(5, ' there');
  textOf(b).insert(0, 'Oh, ');

  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.equal(textOf(a).toString(), textOf(b).toString());
  assert.match(textOf(a).toString(), /Oh, /);
  assert.match(textOf(a).toString(), / there/);
});

test('bringing something to the front writes one key', () => {
  const doc = docWith([
    { id: 'one', kind: 'text', x: 0, y: 0 },
    { id: 'two', kind: 'text', x: 0, y: 0 },
    { id: 'three', kind: 'text', x: 0, y: 0 },
  ]);
  assert.deepEqual(readCanvas(doc).map((item) => item.id), ['one', 'two', 'three']);

  const before = Object.fromEntries(readCanvas(doc).map((item) => [item.id, item.z]));

  bringToFront(doc, 'one');
  assert.deepEqual(readCanvas(doc).map((item) => item.id), ['two', 'three', 'one']);

  // No renumbering: the two that did not move kept the index they had, which is
  // why this cannot fight somebody reordering something else at the same time.
  const after = Object.fromEntries(readCanvas(doc).map((item) => [item.id, item.z]));
  assert.equal(after['two'], before['two']);
  assert.equal(after['three'], before['three']);
  assert.notEqual(after['one'], before['one']);
});

test('an item of an unknown kind is skipped, not deleted', () => {
  // The opposite of what happens to an unknown *block*, and deliberately: a
  // client that does not know a kind must not take it off somebody's board.
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>('canvas');
  const odd = new Y.Map<unknown>();
  odd.set('kind', 'hologram');
  odd.set('x', 5);
  map.set('odd', odd);

  assert.deepEqual(readCanvas(doc), []);
  assert.equal(map.size, 1, 'still in the document');
});

test('a stroke keeps its points, and a canvas keeps its text in reading order', () => {
  const doc = docWith([
    { id: 'low', kind: 'text', x: 0, y: 500, text: 'Below' },
    { id: 'high', kind: 'text', x: 0, y: 10, text: 'Above' },
    { id: 'ink', kind: 'path', x: 0, y: 0, points: [0, 0, 5, 5, 10, 2] },
  ]);
  assert.deepEqual(readCanvas(doc).find((i) => i.id === 'ink')?.points, [0, 0, 5, 5, 10, 2]);
  // Top to bottom: a fiction, and the one everybody already has. A stroke is not
  // text and is not in there.
  assert.equal(canvasText(doc), 'Above\nBelow');
});

test('removing something removes it', () => {
  const doc = docWith([{ id: 'one', kind: 'text', x: 0, y: 0 }]);
  removeItem(doc, 'one');
  assert.deepEqual(readCanvas(doc), []);
});

test('the schema version moved with the canvas', async () => {
  // The prerequisite ADR-0043 named, and the reason it is not optional: the
  // release before this one also called itself version 2. "Same version,
  // different format" is the one thing the handshake cannot catch, so the only
  // fix is to stop being the same version — a client from yesterday is refused
  // at the handshake rather than shown a blank sheet where a drawing is.
  const { SCHEMA_VERSION } = await import('../src/types/ids.js');
  const { DOCUMENT_MIGRATIONS } = await import('../src/doc/migrations.js');
  assert.equal(SCHEMA_VERSION, 3);

  // The chain has no gaps: `migrateDocument` refuses one, so a version bumped
  // without a step would take every document down rather than one client.
  const steps = DOCUMENT_MIGRATIONS.map((step) => [step.from, step.to]);
  assert.deepEqual(steps, [
    [1, 2],
    [2, 3],
  ]);
});

test('a group moves as one transaction, by a delta', async () => {
  const { moveItems } = await import('../src/doc/canvas.js');
  const doc = docWith([
    { id: 'a', kind: 'text', x: 0, y: 0 },
    { id: 'b', kind: 'text', x: 100, y: 50 },
    { id: 'c', kind: 'text', x: 300, y: 0 },
  ]);

  // One update on the wire, not three: five separate moves arrive one after
  // another and a group crawls across somebody else's board instead of moving.
  let updates = 0;
  doc.on('update', () => (updates += 1));
  moveItems(doc, ['a', 'b'], 10, -20);
  assert.equal(updates, 1);

  const items = Object.fromEntries(readCanvas(doc).map((item) => [item.id, item]));
  assert.deepEqual([items['a']?.x, items['a']?.y], [10, -20]);
  assert.deepEqual([items['b']?.x, items['b']?.y], [110, 30]);
  // And nothing else moved.
  assert.deepEqual([items['c']?.x, items['c']?.y], [300, 0]);
});

test('two people dragging two overlapping groups each move their own', async () => {
  // A delta rather than a position is what makes this work: the two edits are
  // about how far, not about where, so the shared item ends up moved by one of
  // them rather than snapped to one of two places.
  const { moveItems } = await import('../src/doc/canvas.js');
  const a = docWith([
    { id: 'one', kind: 'text', x: 0, y: 0 },
    { id: 'two', kind: 'text', x: 0, y: 0 },
  ]);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  moveItems(a, ['one'], 100, 0);
  moveItems(b, ['two'], 0, 100);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  const items = Object.fromEntries(readCanvas(a).map((item) => [item.id, item]));
  assert.deepEqual([items['one']?.x, items['one']?.y], [100, 0]);
  assert.deepEqual([items['two']?.x, items['two']?.y], [0, 100]);
});
