/**
 * Which client wrote which characters.
 *
 * The arithmetic behind highlighting, tested against plain Yjs documents where
 * the expected answer can be written down by hand. A highlight in the wrong
 * place is worse than none — it makes a confident false claim about who wrote a
 * sentence — so this is the part that gets the tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import {
  authoredRanges,
  eachAuthoredText,
  rangesForClients,
  writingClients,
} from '../src/authorship.js';

/** Two documents that sync to each other, as two people would. */
function pair(): { a: Y.Doc; b: Y.Doc; sync: () => void } {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = (): void => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { a, b, sync };
}

test('one author, one range covering everything', () => {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.insert(0, 'hello');

  assert.deepEqual(authoredRanges(text), [
    { from: 0, to: 5, client: doc.clientID },
  ]);
  doc.destroy();
});

test('an insertion in the middle splits the original into two', () => {
  // The case the whole feature is about: somebody typing inside another
  // person's sentence.
  const { a, b, sync } = pair();
  a.getText('t').insert(0, 'hello world');
  sync();
  b.getText('t').insert(5, ' brave');
  sync();

  const ranges = authoredRanges(a.getText('t'));
  assert.equal(a.getText('t').toString(), 'hello brave world');
  assert.deepEqual(ranges, [
    { from: 0, to: 5, client: a.clientID },
    { from: 5, to: 11, client: b.clientID },
    { from: 11, to: 17, client: a.clientID },
  ]);

  a.destroy();
  b.destroy();
});

test('deleted characters take up no room and no attribution', () => {
  // Indices count what is still present. Counting tombstones would put every
  // highlight after a deletion further along than the text it describes.
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.insert(0, 'hello world');
  text.delete(0, 6);

  assert.equal(text.toString(), 'world');
  assert.deepEqual(authoredRanges(text), [
    { from: 0, to: 5, client: doc.clientID },
  ]);
  doc.destroy();
});

test('two runs by the same author are one range', () => {
  // Yjs splits items for reasons that have nothing to do with authorship, and a
  // highlight broken at those points would show seams the writing does not
  // have.
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.insert(0, 'hello');
  text.insert(5, ' again');

  assert.deepEqual(authoredRanges(text), [
    { from: 0, to: 11, client: doc.clientID },
  ]);
  doc.destroy();
});

test('formatting occupies no characters', () => {
  // A mark is an item with no length. Advancing the index for it would shift
  // every highlight after the first bold word.
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.insert(0, 'hello world');
  text.format(0, 5, { bold: true });

  const ranges = authoredRanges(text);
  assert.equal(ranges[ranges.length - 1]?.to, 11, 'the text is still 11 long');
  doc.destroy();
});

test('a person is several clients, and their ranges join up', () => {
  // A client id is per session (ADR-0022). Two sessions either side of a gap
  // belong to one highlight.
  const first = new Y.Doc();
  const text = first.getText('t');
  text.insert(0, 'aaa');

  const second = new Y.Doc();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  second.getText('t').insert(3, 'bbb');
  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));

  const ranges = authoredRanges(first.getText('t'));
  assert.equal(ranges.length, 2, 'two clients, two runs');

  const mine = rangesForClients(ranges, new Set([first.clientID, second.clientID]));
  assert.deepEqual(mine, [{ from: 0, to: 6, client: first.clientID }]);

  first.destroy();
  second.destroy();
});

test('filtering to a client nobody used yields nothing', () => {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, 'hello');
  assert.deepEqual(rangesForClients(authoredRanges(doc.getText('t')), new Set([999])), []);
  doc.destroy();
});

test('an empty text has no ranges', () => {
  const doc = new Y.Doc();
  assert.deepEqual(authoredRanges(doc.getText('t')), []);
  doc.destroy();
});

test('every text in a fragment is visited, nested ones included', () => {
  // A paragraph inside the fragment, and text inside that. Missing the nested
  // case would silently highlight only the top level.
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('content');

  const paragraph = new Y.XmlElement('paragraph');
  fragment.insert(0, [paragraph]);
  const inner = new Y.XmlText();
  paragraph.insert(0, [inner]);
  inner.insert(0, 'inside');

  const seen: string[] = [];
  eachAuthoredText(fragment, (text) => seen.push(text.toString()));
  assert.deepEqual(seen, ['inside']);

  doc.destroy();
});

test('a text nobody has written in is skipped', () => {
  // Visiting it would mean building an empty decoration set per empty
  // paragraph, which is most of a fresh document.
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('content');
  fragment.insert(0, [new Y.XmlText()]);

  let visits = 0;
  eachAuthoredText(fragment, () => visits++);
  assert.equal(visits, 0);

  doc.destroy();
});

// --- who has written here ---------------------------------------------------

test('a document written by one person names one client', () => {
  // The question the margin asks before drawing anything: a page written alone
  // needs no marks, because every block is yours and a column of the same
  // initial says only that you were the one writing.
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('body');
  const text = new Y.XmlText();
  fragment.insert(0, [text]);
  text.insert(0, 'alone');

  assert.equal(writingClients(fragment).size, 1);
});

test('a second person writing makes it two', () => {
  const one = new Y.Doc();
  const fragment = one.getXmlFragment('body');
  const text = new Y.XmlText();
  fragment.insert(0, [text]);
  text.insert(0, 'mine ');

  const two = new Y.Doc();
  Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
  // Typed as the fragment's child union, so the cast says which one it is
  // rather than the test asserting a string into a list of nodes.
  (two.getXmlFragment('body').get(0) as Y.XmlText).insert(5, 'yours');
  Y.applyUpdate(one, Y.encodeStateAsUpdate(two));

  assert.equal(writingClients(fragment).size, 2);
});

test('an empty document names nobody', () => {
  // Not zero-by-accident: a new page has a paragraph and no text, and drawing
  // marks on it would be marks about nothing.
  const doc = new Y.Doc();
  assert.equal(writingClients(doc.getXmlFragment('body')).size, 0);
});
