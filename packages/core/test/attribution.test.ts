/**
 * Pruning attribution (ADR-0022).
 *
 * Whose writing is still here, which decides whose name the record keeps. The
 * function lived in the client package until the server needed it too; its tests
 * stayed behind, and this hole is the kind that falls between two packages.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';

import { liveClientIds } from '../src/doc/attribution.js';

test('writing inside anything held in a map counts as live', () => {
  // The walk recursed into nested types found in a *list* and not into those
  // found in a *map*. So writing inside a canvas note — an item is a map, its
  // words a Y.Text inside it — was invisible to pruning, and the person who
  // wrote it lost their attribution: they appeared in the people panel and then
  // vanished when the pruner next ran, having written something still on the
  // page. A collection's properties had the same hole.
  const mine = new Y.Doc();
  const canvas = mine.getMap('canvas');
  const item = new Y.Map();
  item.set('text', new Y.Text());
  canvas.set('one', item);

  const theirs = new Y.Doc();
  Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine));
  const shared = (theirs.getMap('canvas').get('one') as Y.Map<unknown>).get('text') as Y.Text;
  shared.insert(0, 'Their words');
  Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs));

  assert.ok(liveClientIds(mine).has(theirs.clientID));

  // And deleted writing still does not count, which is the whole point of
  // pruning: a name should not outlive the words it belonged to.
  const gone = (mine.getMap('canvas').get('one') as Y.Map<unknown>).get('text') as Y.Text;
  gone.delete(0, gone.length);
  assert.ok(!liveClientIds(mine).has(theirs.clientID));
});
