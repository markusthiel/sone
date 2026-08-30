/**
 * Dropping attribution for writing that is gone.
 *
 * ADR-0022's second half. The point is not tidiness: deleted text should not
 * keep somebody's name in the record, which is what anybody deleting a sentence
 * assumes has happened.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';

import { USERS_KEY } from '@sone/core';

import { pruneAttribution } from '../src/doc/docStore.js';

/**
 * A document with one person's writing, as the server sees it.
 *
 * Built with Y.PermanentUserData and then *reloaded from the update*, because
 * that instance observes the mapping map and throws when an entry is removed
 * from under it. The server never attaches one — it loads a document from
 * storage and writes it back — so pruning is safe there and would not be in a
 * client that still has the observer running.
 *
 * Found by writing this test the obvious way first, which crashed inside Yjs.
 */
function withAuthor(userId: string, text: string): { doc: Y.Doc; clientId: number } {
  const authored = new Y.Doc();
  const users = new Y.PermanentUserData(authored, authored.getMap(USERS_KEY));
  users.setUserMapping(authored, authored.clientID, userId);
  authored.getText('body').insert(0, text);

  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(authored));
  return { doc, clientId: authored.clientID };
}

test('somebody whose writing is still there keeps their attribution', () => {
  const { doc } = withAuthor('alice', 'a sentence');
  assert.equal(pruneAttribution(doc), 0);
  assert.equal(doc.getMap(USERS_KEY).size, 1);
});

test('somebody whose writing is gone loses it', () => {
  // The whole point. Writing something and removing it should leave no trace of
  // having written it.
  const { doc } = withAuthor('alice', 'a sentence');
  doc.getText('body').delete(0, 'a sentence'.length);

  assert.equal(pruneAttribution(doc), 1);
  assert.equal(doc.getMap(USERS_KEY).size, 0);
});

test('one surviving sentence is enough to stay an author', () => {
  // Somebody who wrote two and deleted one is still the author of the other.
  const { doc } = withAuthor('alice', 'first second');
  doc.getText('body').delete(0, 6);

  assert.equal(pruneAttribution(doc), 0);
  assert.equal(doc.getMap(USERS_KEY).size, 1);
});

test('pruning removes an annotation and never content', () => {
  // Safe in a way the tombstones underneath are not: a CRDT has to keep
  // deletions for ever because convergence depends on them, and an annotation
  // costs a label.
  const { doc } = withAuthor('alice', 'kept');
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

  doc.getText('body').delete(0, 4);
  doc.getText('body').insert(0, 'replaced');
  pruneAttribution(doc);

  // The other side still converges, which is what pruning must not break.
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  assert.equal(other.getText('body').toString(), doc.getText('body').toString());
});

test('a document nobody has been mapped in is left alone', () => {
  // Most documents, and the cheap path: no mapping, nothing to walk.
  const doc = new Y.Doc();
  doc.getText('body').insert(0, 'anonymous');
  assert.equal(pruneAttribution(doc), 0);
});

test('the mapping itself does not keep anybody alive', () => {
  // Counting it as content would keep every entry alive by its own existence,
  // which is the opposite of pruning.
  const { doc } = withAuthor('alice', 'x');
  doc.getText('body').delete(0, 1);
  assert.equal(pruneAttribution(doc), 1, 'not kept by the map it lives in');
});
