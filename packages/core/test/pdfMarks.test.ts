/**
 * A mark without a thread (ADR-0152).
 *
 * ADR-0151 made a place in a PDF something a *comment* can be about. This is the
 * other half of what a reader does to a document: marking a passage without
 * saying anything about it — the highlighter, not the margin note.
 *
 * It is deliberately **not** a thread with no messages. ADR-0046 settled that
 * one: *"a thread with no messages is not a thread — it would arrive on another
 * screen as a highlight over nothing"*, and that is exactly what a highlight
 * *is*, so the two want opposite things from the same shape. A mark is its own
 * kind: a place, the words it is on, who put it there and when.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';

import {
  MAX_PDF_MARKS,
  addPdfMark,
  pdfMarksMap,
  readPdfMarks,
  removePdfMark,
} from '../src/doc/pdfMarks.js';
import type { PdfPlace } from '../src/doc/comments.js';

const PLACE: PdfPlace = { file: 'f1', page: 3, rects: [[72, 700, 120, 20]] };

test('a mark is a place, the words it is on, and who put it there', () => {
  const doc = new Y.Doc();
  addPdfMark(doc, { id: 'm1', place: PLACE, quote: 'Hallo Welt', author: 'u1', at: 5 });

  const marks = readPdfMarks(doc);
  assert.equal(marks.length, 1);
  assert.deepEqual(marks[0], {
    id: 'm1',
    place: PLACE,
    quote: 'Hallo Welt',
    author: 'u1',
    createdAt: 5,
  });
});

test('the quotation is kept, because nothing else says what was marked', () => {
  /*
   * A thread has messages to explain itself. A mark has nothing at all — so
   * without the words it sits on, a mark is a rectangle on page seven of a file
   * and the only way to know what it is about is to open the file and look.
   *
   * The same reasoning ADR-0046 gave for a comment's quotation, and it applies
   * harder here: there is no second sentence to fall back on.
   */
  const doc = new Y.Doc();
  addPdfMark(doc, { id: 'm1', place: PLACE, quote: 'Hallo Welt', author: 'u1' });
  assert.equal(readPdfMarks(doc)[0]?.quote, 'Hallo Welt');
});

test('a mark whose place is not one is not read back', () => {
  /*
   * The document is a CRDT: anything that ever reached it stays readable, and a
   * shape written by an older build or by a client that got it wrong must not
   * take the whole page's marks down with it. The same rule `readThread` follows
   * for a place (ADR-0151).
   */
  const doc = new Y.Doc();
  addPdfMark(doc, { id: 'good', place: PLACE, quote: 'ja', author: 'u1' });

  const entry = new Y.Map<unknown>();
  entry.set('place', { file: 'f1', page: 0, rects: [] });
  entry.set('quote', 'nein');
  entry.set('author', 'u1');
  entry.set('createdAt', 1);
  pdfMarksMap(doc).set('bad', entry);

  assert.deepEqual(
    readPdfMarks(doc).map((one) => one.id),
    ['good'],
  );
});

test('a mark with no place at all is refused rather than stored', () => {
  // Refused on the way in as well as on the way out: a rectangle nothing can
  // draw is not a mark, and writing it through would put the question in every
  // reader instead of in one line here.
  const doc = new Y.Doc();
  addPdfMark(doc, {
    id: 'm1',
    place: { file: '', page: 1, rects: [[1, 1, 1, 1]] },
    quote: 'x',
    author: 'u1',
  });
  assert.equal(pdfMarksMap(doc).size, 0);
});

test('marks come back oldest first', () => {
  // A map has no order, and "the order they were made in" is the only one a
  // reader would recognise. Threads are read the same way.
  const doc = new Y.Doc();
  addPdfMark(doc, { id: 'b', place: PLACE, quote: 'zwei', author: 'u1', at: 20 });
  addPdfMark(doc, { id: 'a', place: PLACE, quote: 'eins', author: 'u1', at: 10 });
  assert.deepEqual(
    readPdfMarks(doc).map((one) => one.id),
    ['a', 'b'],
  );
});

test('removing one leaves the others', () => {
  const doc = new Y.Doc();
  addPdfMark(doc, { id: 'm1', place: PLACE, quote: 'eins', author: 'u1' });
  addPdfMark(doc, { id: 'm2', place: PLACE, quote: 'zwei', author: 'u1' });
  removePdfMark(doc, 'm1');
  assert.deepEqual(
    readPdfMarks(doc).map((one) => one.id),
    ['m2'],
  );
});

test('and removing one that is not there changes nothing', () => {
  // The document's own answer is what the route reports, so this has to be a
  // fact and not a throw: a visitor pressing the button twice is ordinary.
  const doc = new Y.Doc();
  addPdfMark(doc, { id: 'm1', place: PLACE, quote: 'eins', author: 'u1' });
  removePdfMark(doc, 'gone');
  assert.equal(readPdfMarks(doc).length, 1);
});

test('there is a bound, and it is not silent about being reached', () => {
  /*
   * A page holding an unbounded number of marks is a page whose document grows
   * without anybody deciding to. Threads have `MAX_THREADS` for the same reason,
   * and the route above this turns the refusal into a 409 rather than a silent
   * success.
   */
  const doc = new Y.Doc();
  for (let at = 0; at < MAX_PDF_MARKS; at += 1) {
    addPdfMark(doc, { id: `m${at}`, place: PLACE, quote: 'x', author: 'u1' });
  }
  addPdfMark(doc, { id: 'one-too-many', place: PLACE, quote: 'x', author: 'u1' });
  assert.equal(pdfMarksMap(doc).size, MAX_PDF_MARKS);
});

test('a mark is not a comment, and neither reads the other', () => {
  /*
   * Two maps in one document. The distinction is the point of the round: the
   * panel lists what was *said*, and a mark says nothing — so a mark appearing
   * among the threads would be an empty row in a list of conversations.
   */
  const doc = new Y.Doc();
  addPdfMark(doc, { id: 'm1', place: PLACE, quote: 'x', author: 'u1' });
  assert.equal(doc.getMap('comments').size, 0);
});
