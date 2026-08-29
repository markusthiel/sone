/**
 * Recording who wrote what.
 *
 * Yjs knows which client id made every item; what it does not know is which
 * person a client id was. That mapping is the whole of the recording side.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import {
  attributionUsers,
  liveClientIds,
  recordAttribution,
} from '../src/attribution.js';

test('a session is recorded against a person', () => {
  const doc = new Y.Doc();
  recordAttribution(doc, { userId: 'user-1', enabled: true });

  assert.deepEqual([...attributionUsers(doc).keys()], ['user-1']);
  doc.destroy();
});

test('an anonymous visitor is not recorded', () => {
  // A share-link guest has no user id to record against, and attributing to
  // "a guest" would produce one contributor that is really several people —
  // worse than saying nothing.
  const doc = new Y.Doc();
  assert.equal(recordAttribution(doc, { userId: null, enabled: true }), null);
  assert.equal(attributionUsers(doc).size, 0);
  doc.destroy();
});

test('switched off writes nothing at all', () => {
  // Off means off: no mapping from that point, and the document is untouched
  // rather than carrying an empty structure that syncs to everybody.
  const doc = new Y.Doc();
  assert.equal(recordAttribution(doc, { userId: 'user-1', enabled: false }), null);
  assert.equal(doc.share.has('users'), false);
  doc.destroy();
});

test('reading does not create the mapping', () => {
  // `getMap` would make an empty one, turning a read into a write that syncs
  // to every other client.
  const doc = new Y.Doc();
  assert.equal(attributionUsers(doc).size, 0);
  assert.equal(doc.share.has('users'), false);
  doc.destroy();
});

test('recording twice does not accumulate entries', () => {
  // Reconnects and re-opens both call this, and a mapping that grew each time
  // would be a leak nobody would notice until a document was large.
  const doc = new Y.Doc();
  recordAttribution(doc, { userId: 'user-1', enabled: true });
  recordAttribution(doc, { userId: 'user-1', enabled: true });

  assert.deepEqual(attributionUsers(doc).get('user-1')?.length, 1);
  doc.destroy();
});

test('one person writing in two sessions has two client ids', () => {
  // Which is why the mapping exists at all: a client id is per session, so
  // "who wrote this" cannot be answered from the item alone.
  const first = new Y.Doc();
  recordAttribution(first, { userId: 'user-1', enabled: true });

  const second = new Y.Doc();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  recordAttribution(second, { userId: 'user-1', enabled: true });
  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));

  assert.equal(attributionUsers(first).get('user-1')?.length, 2);
  first.destroy();
  second.destroy();
});

// --- what pruning would be allowed to remove --------------------------------

test('a client with live content is reported as live', () => {
  const doc = new Y.Doc();
  doc.getXmlFragment('content').insert(0, [new Y.XmlText('hello')]);
  assert.ok(liveClientIds(doc).has(doc.clientID));
  doc.destroy();
});

test('a client whose content was deleted is not', () => {
  // The request this answers: if my text was completely rewritten, my entry can
  // go. Removing it makes that content unattributed and does not touch the
  // content — safe in a way the tombstones underneath are not, because a CRDT
  // must keep deletions for ever while attribution is only a label.
  const original = new Y.Doc();
  original.getXmlFragment('content').insert(0, [new Y.XmlText('mine')]);

  const rewriter = new Y.Doc();
  Y.applyUpdate(rewriter, Y.encodeStateAsUpdate(original));
  const fragment = rewriter.getXmlFragment('content');
  fragment.delete(0, fragment.length);
  fragment.insert(0, [new Y.XmlText('theirs')]);

  const live = liveClientIds(rewriter);
  assert.ok(!live.has(original.clientID), 'nothing of theirs is left');
  assert.ok(live.has(rewriter.clientID));

  original.destroy();
  rewriter.destroy();
});

test('the mapping does not keep itself alive', () => {
  // Counting it as content would mean every entry is live by its own
  // existence, which is the opposite of pruning.
  const doc = new Y.Doc();
  recordAttribution(doc, { userId: 'user-1', enabled: true });
  assert.equal(liveClientIds(doc).size, 0, 'no content, no live clients');
  doc.destroy();
});

test('content nested inside another node counts', () => {
  // A paragraph inside the fragment has its own author, who is not the author
  // of the node containing it.
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  doc.getXmlFragment('content').insert(0, [paragraph]);

  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  (other.getXmlFragment('content').get(0) as Y.XmlElement).insert(0, [
    new Y.XmlText('written by somebody else'),
  ]);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

  const live = liveClientIds(doc);
  assert.ok(live.has(doc.clientID), 'the paragraph');
  assert.ok(live.has(other.clientID), 'and the text inside it');

  doc.destroy();
  other.destroy();
});
