/**
 * A place in a PDF is a comment's subject (ADR-0151).
 *
 * ADR-0150 put the words back over the picture of them, which was the half a
 * comment needs: something to quote. This is the other half — a selection in a
 * document becomes a thread about a *place*, and the places somebody has already
 * commented on are drawn on the page.
 *
 * Three kinds of test, and the split is deliberate:
 *
 *   - the arithmetic (`linesOf`) is run, because it is arithmetic;
 *   - the announcement is run in jsdom, because it is window events and a cache
 *     and both can be had without layout;
 *   - the viewer's own wiring is **read**, for ADR-0150's reason — pdf.js needs
 *     a worker, a canvas and a real layout, and jsdom has none of the three.
 *
 * What no test here holds is whether a mark lands on the words it is about.
 * That was measured in Chromium against a document whose text sits at
 * coordinates chosen in advance, and the numbers are in ADR-0151.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { linesOf } from '../src/lib/pdfPlace.ts';
import { codeOf, stylesOf } from './helpers/source.ts';

const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));
const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
const hook = codeOf(new URL('../src/hooks/useComments.ts', import.meta.url));
const client = codeOf(new URL('../src/api/client.ts', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe('a selection, made into lines', () => {
  test('the spans of one line become one rectangle', () => {
    /*
     * The text layer is one span per run of glyphs, so an ordinary line of a
     * PDF is six or eight of them and `getClientRects()` hands back one
     * rectangle each. Left as they come, a sentence is a mark with a seam every
     * few characters and an anchor larger than the comment on it.
     */
    const lines = linesOf([
      box(72, 100, 120, 112),
      box(120, 100, 180, 112),
      box(180, 100, 240, 112),
    ]);
    assert.deepEqual(lines, [box(72, 100, 240, 112)]);
  });

  test('and two lines stay two, in reading order', () => {
    const lines = linesOf([
      box(72, 130, 200, 142),
      box(72, 100, 240, 112),
    ]);
    assert.deepEqual(lines, [box(72, 100, 240, 112), box(72, 130, 200, 142)]);
  });

  test('a superscript belongs to its line, not to a line of its own', () => {
    /*
     * The find that made this an overlap test rather than an equal-tops test. A
     * footnote marker is a smaller font on a higher baseline: its rectangle has
     * a top of its own, and grouping by that number gives it a mark floating
     * above the sentence it is part of.
     */
    const lines = linesOf([
      box(72, 100, 240, 112),
      box(240, 97, 245, 105),
      box(245, 100, 300, 112),
    ]);
    assert.deepEqual(lines, [box(72, 97, 300, 112)]);
  });

  test('a line below is not swallowed by the one above it', () => {
    // The other side of the same rule: touching is not overlapping, and two
    // lines of ordinary text nearly touch.
    const lines = linesOf([box(72, 100, 240, 112), box(72, 111, 240, 123)]);
    assert.equal(lines.length, 2);
  });

  test('an empty rectangle is not a mark', () => {
    // A collapsed range at the end of a span produces one, and a mark of no
    // width is a thing every reader would have to decide what to do with.
    assert.deepEqual(linesOf([box(72, 100, 72, 112), box(72, 100, 240, 112)]), [
      box(72, 100, 240, 112),
    ]);
  });

  test('too many lines keeps the first of them, not a box around the lot', () => {
    /*
     * Where a very long selection *begins* is what somebody scrolling to it is
     * looking for. One rectangle around everything would draw over the margins
     * and the lines between, claiming a great deal that was not selected — and
     * the quotation carries the whole of it either way.
     */
    const many = Array.from({ length: 40 }, (_, at) => box(72, at * 20, 240, at * 20 + 12));
    const lines = linesOf(many, 32);
    assert.equal(lines.length, 32);
    assert.deepEqual(lines[0], box(72, 0, 240, 12));
  });
});

describe('what the surfaces are told', () => {
  let dom: JSDOM;
  let announce: typeof import('../src/lib/threadAnnouncement.ts');

  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const globals = ['window', 'document', 'Event', 'CustomEvent'] as const;
    for (const name of globals) {
      (globalThis as Record<string, unknown>)[name] = (dom.window as unknown as Record<
        string,
        unknown
      >)[name];
    }
    announce = await import('../src/lib/threadAnnouncement.ts');
  });

  after(() => dom.window.close());

  const threadIn = (id: string): never =>
    ({ id, item: null, place: null, quote: '', messages: [] }) as never;

  test('an announcement says which document it is about', () => {
    /*
     * **The fault this was written for.** A page with a protected section has a
     * second comment document, read by a second copy of the hook, and both
     * announced on the same event with nothing to tell them apart. Whichever
     * ran last is what the editor drew — so the public marks were rebuilt from
     * threads whose anchors resolve against another document, which is to say
     * from nothing at all.
     */
    const heard: string[] = [];
    const stop = announce.subscribeToThreads((one) => heard.push(one.doc));
    announce.announceThreads('public-guid', [threadIn('a')]);
    announce.announceThreads('internal-guid', [threadIn('b')]);
    stop();
    assert.deepEqual(heard, ['public-guid', 'internal-guid']);
  });

  test('somebody who arrives late is told what was already said', () => {
    /*
     * The viewer is mounted by the editor when a file block comes into view,
     * which is long after the hook announced the page's threads. An event is
     * gone the moment it is dispatched, so without the replay a PDF drew no
     * marks at all until somebody happened to write a comment.
     */
    announce.announceThreads('public-guid', [threadIn('a')]);
    const heard: Array<{ doc: string; count: number }> = [];
    const stop = announce.subscribeToThreads((one) =>
      heard.push({ doc: one.doc, count: one.threads.length }),
    );
    stop();
    assert.ok(
      heard.some((one) => one.doc === 'public-guid' && one.count === 1),
      'the last announcement is replayed',
    );
  });

  test('a document that is closed is forgotten', () => {
    // Otherwise a viewer mounted on the *next* page is replayed the last page's
    // threads, and draws somebody else's comments over this document.
    announce.announceThreads('going-away', [threadIn('a')]);
    announce.forgetThreads('going-away');
    const heard: string[] = [];
    const stop = announce.subscribeToThreads((one) => heard.push(one.doc));
    stop();
    assert.ok(!heard.includes('going-away'));
  });
});

describe('the hook', () => {
  test('announces through the one place that knows the event', () => {
    assert.match(hook, /announceThreads\(doc\.guid, /);
    assert.match(hook, /forgetThreads\(doc\.guid\)/);
    assert.doesNotMatch(hook, /'sone:comments-changed'/, 'the name has one home now');
  });

  test('a place thread is open, not gone', () => {
    /*
     * `open` asked `item !== null || range !== null` and `detached` asks
     * `isDetached`. A thread about a place has no item and no range, so it
     * satisfied neither: it would have been in no group the panel draws, which
     * is a comment somebody wrote and nobody can see. The two are complements
     * and are written as complements.
     */
    assert.match(hook, /open: threads\.filter\(\s*\(thread\) => !thread\.resolved && !isDetached\(thread\)/);
  });
});

describe('the editor surface', () => {
  test('only redraws its own document’s marks', () => {
    assert.match(surface, /\.doc !== handle\.doc\.guid/);
  });

  test('turns a place from the viewer into a comment', () => {
    /*
     * A window event rather than a callback threaded down, for the reason
     * `sone:reveal-comment` is one: the viewer is a node view mounted from
     * inside ProseMirror, and connecting it to the panel by passing a function
     * through the editor, the node views map and the file block is more moving
     * parts than one named event.
     */
    assert.match(surface, /'sone:pdf-comment'/);
    assert.match(surface, /isPlace\(/, 'checked before it is believed');
    assert.match(surface, /onCommentRef\.current\(/);
  });
});

describe('the viewer', () => {
  test('the file is named by its id, handed in rather than parsed', () => {
    /*
     * The id is what a place is keyed by, and the viewer is given a URL. Taking
     * the id back out of `/api/files/<id>` would be a second place that knows
     * how that URL is built, and it would be wrong the day the route changes.
     */
    assert.match(viewer, /fileId: string/);
    assert.doesNotMatch(viewer, /url\.split\(|match\(\/\\\/api\\\/files/);
  });

  test('a selection is converted by the engine, not by arithmetic here', () => {
    /*
     * ADR-0150's rule, applied the other way round. `convertToPdfPoint` is the
     * inverse of the transform the page was drawn with, rotation included; the
     * hand-written version is `height - y` and is silently wrong on every
     * landscape scan.
     */
    assert.match(viewer, /convertToPdfPoint\(/);
    assert.match(viewer, /convertToViewportPoint\(/);
    assert.doesNotMatch(viewer, /height - \(?y/, 'nothing here flips an axis by hand');
  });

  test('a mark is placed in percentages, so a resize costs nothing', () => {
    /*
     * The text layer needs `--scale-factor` re-set on every resize because the
     * engine positions its spans in pixels. A mark does not have to: a
     * percentage of the page box is the same fraction at every width, so the
     * marks follow a sidebar opening with no observer and no work.
     */
    assert.match(viewer, /mark\.style\.left = `\$\{[^`]*\}%`/);
    assert.doesNotMatch(viewer, /mark\.style\.left = `\$\{[^`]*\}px`/);
  });

  test('it draws the marks for its own file and nobody else’s', () => {
    // Every thread on the page is announced, and a page may hold two documents.
    assert.match(viewer, /place\.file [!=]== fileId/);
  });

  test('the marks are under the text, so a selection still works', () => {
    // A mark over the text layer would take the pointer events the layer needs,
    // and commenting on a place would stop being possible as soon as somebody
    // had commented on it.
    assert.match(css, /\.pdf-marks \{[^}]*pointer-events: none/s);
  });

  test('the button to comment goes away with the selection', () => {
    assert.match(viewer, /selectionchange/);
  });

  test('and the viewer lets go of what it subscribed to', () => {
    // Two subscriptions now — the threads and the selection — and a node view is
    // destroyed and recreated as somebody edits around it (ADR-0048).
    assert.match(viewer, /cleanups\.push\(\(\) => stopThreads\(\)\)/);
  });
});

describe('the panel', () => {
  test('a thread about a place is not “the text has been deleted”', () => {
    /*
     * It never was text. The same distinction ADR-0057 drew for a canvas item:
     * "cannot be found" and "was never text" read the same to a reader and are
     * opposite facts.
     */
    assert.match(panel, /thread\.place !== null/);
    assert.match(panel, /comment\.aboutPlace/);
  });

  test('and it keeps its quotation, because that is what it is about', () => {
    // A canvas thread shows a label instead of a quote — it has no words. A
    // place has words, which is the whole reason ADR-0150 came first.
    assert.doesNotMatch(panel, /thread\.place !== null \? t\('comment\.aboutPlace'\)\s*: thread\.quote/);
  });
});

describe('the wire', () => {
  test('a guest’s comment can be about a place too', () => {
    /*
     * Somebody who may comment and may not write the document posts over HTTP
     * instead of into the room (ADR-0090). Without this the place was dropped
     * on the way, and a guest's comment on page three of a PDF arrived as a
     * thread about nothing.
     */
    assert.match(client, /place\?: PdfPlace/);
    assert.match(client, /\.\.\.\(input\.place \? \{ place: input\.place \} : \{\}\)/);
  });
});
