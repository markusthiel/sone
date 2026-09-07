/**
 * The panel takes you to the passage (ADR-0156).
 *
 * ADR-0155 disabled the quotation button where there was provably nothing to
 * reach, and named what it left behind: for every *other* place thread the
 * button was still dead, because the page only reveals a thread that has a
 * **range**. A comment about page seven of a PDF listed a quotation and, when
 * pressed, did nothing at all.
 *
 * Read rather than run, for ADR-0150's reason — the viewer needs a worker, a
 * canvas and a real layout, and jsdom has none of the three. The scrolling and
 * the flash were measured in Chromium and the numbers are in the record.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));
const app = codeOf(new URL('../src/App.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

describe('the page asks, and the document answers', () => {
  test('a thread with a place is revealed like one with a range', () => {
    /*
     * The page has dispatched `sone:reveal-comment` for a range since ADR-0046
     * — resolving an anchor into editor coordinates is the editor's job, so
     * revealing is a message rather than a scroll from here. A place is the
     * same arrangement with a different reader: only the viewer knows where
     * page seven currently is.
     */
    assert.match(app, /new CustomEvent\('sone:reveal-place'/);
    // And still nothing for a thread that is neither, which is the case the
    // disabled button already covers.
    assert.match(app, /if \(thread\.range\) \{/);
  });

  test('the message carries the file, because a page may hold two documents', () => {
    assert.match(app, /file: thread\.place\.file/);
    assert.match(viewer, /detail\.file !== fileId/);
  });
});

describe('the document takes you there', () => {
  test('the block comes into view, and the column scrolls inside it', () => {
    /*
     * Two scrolls, and they are two because the viewer is a column *inside* a
     * page that also scrolls. `goTo` alone moves page seven to the top of a
     * column that may be entirely below the fold.
     *
     * `scrollIntoView` here and not in `goTo`: ADR-0048 refused it for paging
     * because it moves every ancestor, and moving every ancestor is exactly
     * what somebody who pressed "show me this" asked for.
     */
    assert.match(viewer, /container\.scrollIntoView\(/);
    assert.match(viewer, /showPage\?\.\(/);
  });

  test('a page that has not been drawn yet still flashes when it is', () => {
    /*
     * Pages are drawn as they come near (ADR-0048), so the one being revealed
     * usually does not exist yet at the moment of the ask. The wanted thread is
     * remembered rather than acted on once, and the mark is drawn found.
     */
    assert.match(viewer, /let wanted: string \| null = null/);
    assert.match(viewer, /drawn\.id !== undefined && drawn\.id === wanted/);
  });

  test('and it stops being found, so the next ask is visible too', () => {
    // A mark that stayed lit would make the second reveal look like nothing
    // happened.
    assert.match(viewer, /wanted = null;\s*\n\s*redrawEverything\(\)/);
  });

  test('a mark carries the thread it belongs to', () => {
    // Which is also what the next round needs to answer a click on one.
    assert.match(viewer, /mark\.dataset\['thread'\]/);
  });
});

describe('what being found looks like', () => {
  test('the fill and the outline carry it, not the movement', () => {
    /*
     * **The stylesheet's own test, applied honestly.** It says motion is turned
     * off rather than shortened for somebody who asked for less, because "none
     * of this carries information".
     *
     * This does. Which of a page's marks is the one you asked for is the whole
     * message, so it is said with a stronger fill and an outline that simply
     * hold — and the pulse on top is the decoration, and the only part that
     * goes.
     */
    assert.match(css, /\.pdf-mark\[data-found\] \{[^}]*outline/s);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]{0,400}?\.pdf-mark\[data-found\] \{ animation: none; \}/);
  });
});
