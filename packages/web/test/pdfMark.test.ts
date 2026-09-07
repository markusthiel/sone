/**
 * The highlighter (ADR-0152).
 *
 * ADR-0151 made a place in a PDF something a comment can be *about*. This is the
 * other thing a reader does to a document: marking a passage and saying nothing.
 *
 * The interesting decisions are all about what a mark is *not*. It is not a
 * thread with no messages — ADR-0046 ruled that shape out from the other side.
 * It is not a second colour on the page. It is not clickable, because the marks
 * must not take the pointer the selection needs. And it is not offered to a
 * share-link visitor, because taking one off again could not be.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { touches } from '../src/lib/pdfPlace.ts';
import { codeOf, stylesOf } from './helpers/source.ts';

const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));
const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
const hook = codeOf(new URL('../src/hooks/usePdfMarks.ts', import.meta.url));
const app = codeOf(new URL('../src/App.tsx', import.meta.url));
const client = codeOf(new URL('../src/api/client.ts', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

const place = (page: number, rects: Array<[number, number, number, number]>) => ({
  file: 'f1',
  page,
  rects,
});

describe('whether a selection is sitting on a mark', () => {
  test('touching is enough, because nobody selects the same words twice', () => {
    /*
     * Un-marking is asked with the same gesture as marking: select the passage
     * again. A drag over "roughly that sentence" starts a character early and
     * ends a character late, so a rule that asked for containment would answer
     * "there is nothing here" while the reader is looking straight at it.
     */
    assert.equal(
      touches(place(1, [[72, 700, 120, 20]]), place(1, [[100, 705, 200, 12]])),
      true,
    );
  });

  test('and a passage further down the page is not the same passage', () => {
    assert.equal(
      touches(place(1, [[72, 700, 120, 20]]), place(1, [[72, 400, 120, 20]])),
      false,
    );
  });

  test('the page is asked before the rectangles, or every page touches every other', () => {
    /*
     * The find. Two pages of a document use the same coordinate system, so on
     * rectangles alone a mark at the top of page three sits exactly where a mark
     * at the top of page four does — and un-marking one would have taken the
     * other with it, on a page nobody was looking at.
     */
    assert.equal(
      touches(place(3, [[72, 700, 120, 20]]), place(4, [[72, 700, 120, 20]])),
      false,
    );
  });

  test('and so is the file', () => {
    // Two PDFs can sit in one page, and they have their own coordinates too.
    assert.equal(
      touches({ ...place(1, [[72, 700, 120, 20]]), file: 'a' }, {
        ...place(1, [[72, 700, 120, 20]]),
        file: 'b',
      }),
      false,
    );
  });

  test('edges that meet do not overlap', () => {
    // Two marks on consecutive lines share an edge, and a rule of `<=` would
    // have made every line of a page touch the one below it.
    assert.equal(
      touches(place(1, [[72, 700, 120, 20]]), place(1, [[72, 680, 120, 20]])),
      false,
    );
  });
});

describe('the hook', () => {
  test('a mark is not re-read on every keystroke', () => {
    /*
     * `useComments` listens to `doc.on('update')` because a thread's *range*
     * resolves against the text and therefore changes when the text does. A
     * place cannot move: it names a file whose bytes are fixed and a rectangle
     * in that file's own coordinates (ADR-0151). Observing the map is the whole
     * of it, and re-reading every mark on every keystroke would be work for a
     * number that cannot have changed.
     */
    assert.match(hook, /map\.observeDeep\(read\)/);
    assert.doesNotMatch(hook, /doc\.on\('update'/);
  });

  test('it announces on its own channel, and retires it with the document', () => {
    assert.match(hook, /announcePdfMarks\(doc\.guid, list\)/);
    assert.match(hook, /forgetPdfMarks\(doc\.guid\)/);
  });

  test('and it goes down the transport when there is one', () => {
    // Somebody graded `commenter` may not write the document at all
    // (ADR-0090), and a mark is a comment-shaped act.
    assert.match(hook, /if \(transport\) \{\s*\n\s*void transport\.add/);
    assert.match(hook, /if \(transport\) \{\s*\n\s*void transport\.remove/);
  });
});

describe('the viewer', () => {
  test('one button does both, because there is nothing to click on a mark', () => {
    /*
     * The marks are `pointer-events: none` so the text layer above them stays
     * selectable (ADR-0151) — a mark that took the pointer would mean a passage
     * could be marked exactly once. So there is no click target, and un-marking
     * is asked with the gesture marking is: select it again.
     */
    assert.match(viewer, /paint\.textContent = touching\.length > 0 \? labels\.unmark : labels\.mark/);
    assert.doesNotMatch(viewer, /mark\.addEventListener\('click'/);
  });

  test('every mark the selection touches comes off, not the nearest one', () => {
    // A drag that lands across two marks, taking one off and leaving the other,
    // is a result nobody could predict from the gesture they made.
    assert.match(viewer, /\.filter\(\(mark\) => touches\(mark\.place, place\)\)/);
  });

  test('the highlighter is not offered to somebody who could not undo it', () => {
    assert.match(viewer, /if \(mayMark\) tools\.append\(paint\)/);
  });

  test('a plain mark and a discussed one are two weights of one colour', () => {
    /*
     * The difference between "being discussed" and "worth a second look" is one
     * of degree. A second hue would be a second convention to learn — the same
     * argument that put a commented passage in the accent rather than in
     * highlighter yellow (ADR-0046).
     */
    assert.match(viewer, /mark\.dataset\['kind'\] = drawn\.kind/);
    assert.match(css, /\.pdf-mark\[data-kind='plain'\] \{[^}]*var\(--accent\) 8%/s);
    assert.match(css, /\.pdf-mark \{[^}]*var\(--accent\) 16%/s);
  });

  test('and both live under the same layer, which still takes no pointer', () => {
    assert.match(css, /\.pdf-marks \{[^}]*pointer-events: none/s);
  });

  test('the two buttons are one shell', () => {
    // Two things positioning themselves against the same corner is two things
    // that drift apart by a pixel at some widths.
    assert.match(viewer, /tools\.style\.left = `\$\{[^`]*\}%`/);
    assert.doesNotMatch(viewer, /paint\.style\.left/);
  });

  test('and the viewer lets go of both subscriptions', () => {
    assert.match(viewer, /cleanups\.push\(\(\) => stopThreads\(\)\)/);
    assert.match(viewer, /cleanups\.push\(\(\) => stopMarks\(\)\)/);
  });
});

describe('the surface and the page', () => {
  test('two events, so each listener reads as one sentence', () => {
    assert.match(surface, /'sone:pdf-mark'/);
    assert.match(surface, /'sone:pdf-unmark'/);
    assert.match(surface, /isPlace\(detail\.place\)/);
  });

  test('a mark goes into the document at once — there is nothing to wait for', () => {
    /*
     * The opposite of a comment. An anchor is *held* until somebody has written
     * something, because a thread with an empty first message is a highlight
     * over nothing (ADR-0046). A mark is that highlight on purpose, so waiting
     * for words that are never coming would mean it never happened.
     */
    assert.match(app, /onMark=\{\(place, quote\) => pdfMarks\.add\(place, quote\)\}/);
    assert.doesNotMatch(app, /onMark=\{\([^)]*\) => setPending/);
  });

  test('and a share link is told so, rather than left to find out', () => {
    assert.match(app, /mayMark=\{false\}/);
    assert.match(app, /mayMark=\{!session\.user\.isGuest\}/);
  });
});

describe('the wire', () => {
  test('a mark carries no name, because it needs an account', () => {
    /*
     * The comment routes take the visitor's name with the request (ADR-0092).
     * This one does not: a mark's author is a user id, and the route refuses
     * anybody without one — so a name parameter here would be a parameter that
     * can never be right.
     */
    assert.match(client, /markPdfPlace: \(pageId: string, input: \{ place: PdfPlace; quote: string \}\)/);
    // The body, said exactly: a place and the words it is on, and nothing else.
    assert.match(
      client,
      /body: JSON\.stringify\(\{ place: input\.place, quote: input\.quote \}\)/,
    );
    assert.match(client, /unmarkPdfPlace: \(pageId: string, markId: string\)/);
  });
});
