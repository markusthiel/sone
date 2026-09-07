/**
 * The marks, written into the file (ADR-0154).
 *
 * The last of the four rounds, and the one the other three were for: a copy of
 * the document that carries what was marked and said about it, readable by
 * anything that opens a PDF.
 *
 * **These tests run the engine and read the bytes back.** That is unusual here —
 * ADR-0150 and ADR-0151 both had to settle for reading source, because pdf.js
 * needs a worker, a canvas and a real layout to *draw*. Writing needs none of
 * those: `getDocument` and `saveDocument` work in Node, so the honest test is to
 * produce a file and look inside it. A test that asserted "we called
 * `setValue`" would be a test that a wire exists (ADR-0091), and every mistake
 * worth making here — the quad-point order, the page index, the appearance
 * stream, saving twice — is a mistake in what comes out.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { burnMarks, conversationText, type Burnable } from '../src/lib/pdfBurn.ts';
import { codeOf } from './helpers/source.ts';

/**
 * A one-page PDF with text at coordinates chosen in advance.
 *
 * The same probe ADR-0150 and ADR-0151 measured against: `Hallo Welt` in 24pt
 * Helvetica with its origin at (72, 700) on a 612×792 page, and a footer line
 * at (72, 120).
 */
const PROBE = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 88 >>
stream
BT /F1 24 Tf 72 700 Td (Hallo Welt) Tj ET
BT /F1 12 Tf 72 120 Td (Fusszeile unten) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000379 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
449
%%EOF
`;

/** The engine, loaded the way Node can load it. */
async function engine(): Promise<typeof import('pdfjs-dist')> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist');
}

/** A document opened on the probe, ready to be written into. */
async function probe(): Promise<Burnable> {
  const pdfjs = await engine();
  const data = new Uint8Array(Buffer.from(PROBE, 'latin1'));
  return (await pdfjs.getDocument({ data }).promise) as unknown as Burnable;
}

const read = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const countOf = (text: string, needle: RegExp): number => (text.match(needle) ?? []).length;

const HELLO = [72, 695, 119, 22] as [number, number, number, number];
const FOOTER = [72, 117, 84, 13] as [number, number, number, number];

describe('the marks in the file', () => {
  test('a plain mark comes out as a real highlight in the page’s own points', async () => {
    const { bytes } = await burnMarks(
      await probe(),
      [{ page: 1, rects: [FOOTER] }],
      { color: [47, 125, 111] },
    );
    const text = read(bytes);

    assert.match(text, /\/Subtype\s*\/Highlight/, 'a highlight, not an ink scribble');
    /*
     * The four corners, and the order is the specification's rather than a
     * reading order: upper-left, upper-right, lower-left, lower-right. Written
     * as a loop around the rectangle, a viewer draws a bow tie.
     */
    assert.match(text, /\/QuadPoints \[72 130 156 130 72 117 156 117\]/);
    assert.match(text, /\/Rect \[72 117 156 130\]/);
    // The accent the reader was looking at, on the page's 0–1 scale.
    assert.match(text, /\/C \[0\.18\d+ 0\.49\d+ 0\.43\d+\]/);
  });

  test('and it carries an appearance, or some viewers draw nothing', async () => {
    /*
     * `quadPoints` is what the annotation *is*; the appearance stream is what a
     * viewer draws. Without one, each viewer renders a highlight to its own
     * taste — and several render it not at all.
     */
    const { bytes } = await burnMarks(await probe(), [{ page: 1, rects: [HELLO] }], {
      color: [47, 125, 111],
    });
    const text = read(bytes);
    assert.match(text, /\/AP <<\s*\/N/);
    assert.match(text, /\/Subtype \/Form/);
  });

  test('a thread brings its conversation, and a plain mark brings nothing', async () => {
    /*
     * The whole difference between the two kinds, carried out of SONE. A note
     * with an empty `/Contents` is a thing that opens onto nothing, so a plain
     * mark has none.
     */
    const { bytes } = await burnMarks(
      await probe(),
      [
        { page: 1, rects: [FOOTER] },
        {
          page: 1,
          rects: [HELLO],
          author: 'Markus Thiel',
          contents: 'Markus Thiel: Stimmt die Zahl?\n\nRieke: Ja.',
        },
      ],
      { color: [47, 125, 111] },
    );
    const text = read(bytes);

    assert.equal(countOf(text, /\/Subtype\s*\/Highlight/g), 2);
    assert.equal(countOf(text, /\/Contents \(/g), 1, 'only the discussed one');
    assert.match(text, /\/T \(Markus Thiel\)/);
    assert.match(text, /\/Subtype \/Popup/);
    // Closed. A note that opens itself covers the words it is about.
    assert.match(text, /\/Open false/);
  });

  test('the two weights survive the crossing', async () => {
    // On screen the accent at 16% and at 8% (ADR-0152). A PDF multiplies `CA`
    // over the page rather than mixing, so the numbers differ and the ratio
    // does not — which is what the distinction is made of.
    const { bytes } = await burnMarks(
      await probe(),
      [
        { page: 1, rects: [FOOTER] },
        { page: 1, rects: [HELLO], contents: 'etwas' },
      ],
      { color: [47, 125, 111] },
    );
    const text = read(bytes);
    assert.match(text, /\/CA 0\.2\b/, 'the plain one');
    assert.match(text, /\/CA 0\.4\b/, 'and the discussed one');
  });

  test('saving twice does not mark the same passage twice', async () => {
    /*
     * **The fault this was written for.** pdf.js's storage is a map that
     * outlives a save, and somebody downloading, commenting and downloading
     * again is ordinary — so a fresh key per mark per save puts every mark in
     * the file as many times as the button was pressed.
     */
    const doc = await probe();
    const first = await burnMarks(doc, [{ page: 1, rects: [HELLO] }], {
      color: [47, 125, 111],
    });
    const again = await burnMarks(doc, [{ page: 1, rects: [HELLO] }], {
      color: [47, 125, 111],
      previous: first.keys,
    });
    assert.equal(countOf(read(again.bytes), /\/Subtype\s*\/Highlight/g), 1);
  });

  test('and a mark taken off in between is gone from the next copy', async () => {
    const doc = await probe();
    const first = await burnMarks(
      doc,
      [
        { page: 1, rects: [HELLO] },
        { page: 1, rects: [FOOTER] },
      ],
      { color: [47, 125, 111] },
    );
    assert.equal(countOf(read(first.bytes), /\/Subtype\s*\/Highlight/g), 2);

    const again = await burnMarks(doc, [{ page: 1, rects: [HELLO] }], {
      color: [47, 125, 111],
      previous: first.keys,
    });
    assert.equal(countOf(read(again.bytes), /\/Subtype\s*\/Highlight/g), 1);
  });

  test('the original is left where it was, and the marks are appended', async () => {
    /*
     * An incremental update: the bytes that were there stay byte for byte, and
     * what is new is written after them with a cross-reference table pointing
     * back. That is what makes this safe to hand somebody — a signature over
     * the original still verifies, and nothing has been re-encoded.
     */
    const { bytes } = await burnMarks(await probe(), [{ page: 1, rects: [HELLO] }], {
      color: [47, 125, 111],
    });
    const text = read(bytes);
    assert.ok(text.startsWith('%PDF-1.4'), 'the same file, still');
    assert.ok(text.includes('(Hallo Welt) Tj'), 'with its own contents untouched');
    assert.match(text, /\/Prev 449/, 'and the original cross-reference table behind it');
    assert.ok(bytes.length > PROBE.length, 'longer, not rewritten');
  });

  test('a mark on a page that is not the first lands on that page', async () => {
    // Zero-based here and nowhere else in this feature — the one place the two
    // countings meet, which is exactly where an off-by-one hides.
    const doc = await probe();
    let stored: { pageIndex?: number } = {};
    const spy: Burnable = {
      annotationStorage: {
        setValue: (_key, value) => {
          stored = value as { pageIndex?: number };
        },
        remove: () => undefined,
      },
      saveDocument: () => Promise.resolve(new Uint8Array()),
    };
    await burnMarks(spy, [{ page: 7, rects: [HELLO] }], { color: [0, 0, 0] });
    assert.equal(stored.pageIndex, 6);
    void doc;
  });

  test('the engine still calls a highlight what we call one', async () => {
    /*
     * The copied constant, compared with its source — the arrangement ADR-0150
     * arrived at for the vendored stylesheet. Importing the engine to read one
     * integer would put half a megabyte in front of everybody who never opens a
     * PDF; not checking it would mean an upgrade that renumbers turns every
     * mark into an ink scribble with nothing going red.
     */
    const source = await import('../src/lib/pdfBurn.ts');
    const pdfjs = await engine();
    const doc = await probe();
    await burnMarks(doc, [{ page: 1, rects: [HELLO] }], { color: [1, 2, 3] });
    void source;
    assert.equal(
      (pdfjs.AnnotationEditorType as unknown as { HIGHLIGHT: number }).HIGHLIGHT,
      9,
      'pdfjs-dist has renumbered its editor types',
    );
  });
});

describe('a conversation, as the one string a note can hold', () => {
  const nameOf = (author: string): string =>
    ({ u1: 'Markus Thiel', u2: 'Rieke' })[author] ?? '';

  test('each message with the person who wrote it', () => {
    assert.equal(
      conversationText(
        [
          { author: 'u1', text: 'Stimmt die Zahl?' },
          { author: 'u2', text: 'Ja, geprüft.' },
        ],
        nameOf,
      ),
      'Markus Thiel: Stimmt die Zahl?\n\nRieke: Ja, geprüft.',
    );
  });

  test('and a name nobody knows is left off rather than invented', () => {
    // "Unknown: …" is worse than the sentence on its own: it says somebody has
    // been forgotten, which is a fact about our records and not about the
    // document.
    assert.equal(
      conversationText([{ author: 'u9', text: 'Kurz notiert.' }], nameOf),
      'Kurz notiert.',
    );
  });
});

describe('the viewer’s half of it', () => {
  const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));

  test('the offer is hidden while there is nothing to write', () => {
    /*
     * A button that produces an identical copy of the file is a button with
     * nothing to do, and offering it is a small promise broken every time
     * somebody presses it.
     */
    assert.match(viewer, /download\.hidden = burnable === null \|\| whatToWrite\(\)\.length === 0/);
    // And it is re-asked whenever the marks change, which is the same news.
    assert.match(viewer, /offerTheCopy\(\);\s*\n\s*\};/);
  });

  test('the colour is the one the reader is looking at', () => {
    /*
     * Not a fixed one: somebody who has looked at green marks all afternoon
     * should not open the copy and find yellow. And not the stored theme —
     * a treated surface redefines the same name (ADR-0122), so the only honest
     * answer is what the browser resolved *inside this viewer*.
     */
    assert.match(viewer, /resolvedColor\(container, '--accent'\)/);
  });

  test('a second copy replaces the first rather than doubling it', () => {
    // pdf.js\'s storage is a map that outlives a save.
    assert.match(viewer, /previous: written/);
    assert.match(viewer, /written = keys/);
  });

  test('the copy is named beside the original, never over it', () => {
    // Two files in a downloads folder with one name is a pair nobody can tell
    // apart.
    assert.match(viewer, /link\.download = filename\.replace\(/);
  });

  test('and a copy that cannot be made says so', () => {
    // ADR-0150\'s rule: a button that does nothing and explains nothing is an
    // afternoon somebody else loses.
    assert.match(viewer, /console\.warn\(\s*'SONE: this PDF could not be copied/);
    /*
     * And it says *what*, not what class the failure was. The measurement in
     * Chromium reported `UnknownErrorException`, which named nothing; the
     * message underneath it was `getOrInsertComputed is not a function`, which
     * named everything — the same browser floor ADR-0150 lost an afternoon to,
     * this time in the worker, where a page's polyfill never reaches.
     */
    assert.match(viewer, /error instanceof Error \? error\.message : error/);
  });
});

describe('mounting a viewer on a page that already has marks', () => {
  let dom: JSDOM;

  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    for (const name of ['window', 'document', 'Event', 'CustomEvent', 'Element', 'Node'] as const) {
      Object.defineProperty(globalThis, name, {
        value: (dom.window as unknown as Record<string, unknown>)[name],
        configurable: true,
        writable: true,
      });
    }
  });

  after(() => dom.window.close());

  test('does not throw before it has finished being built', async () => {
    /*
     * **Reported as „The editor stopped working", and it is a rule rather than
     * a typo.**
     *
     *   ReferenceError: Cannot access 'H' before initialization
     *
     * `subscribeToThreads` replays the last announcement **synchronously,
     * before it returns** — that is its whole point (ADR-0151): a viewer
     * mounted long after the page opened would otherwise draw no marks at all.
     * So the listener runs *in the middle of* `mountPdfViewer`'s own body, and
     * everything it touches has to exist by then.
     *
     * It did not. The listener redraws, redrawing asks whether there is
     * anything to offer a copy of (ADR-0154), and that question was declared
     * two hundred lines further down — a `const`, so reading it early is a
     * throw and not an `undefined`. The whole editor came down with it, because
     * this runs while ProseMirror is building a node view.
     *
     * The order is fixed. This is the test that keeps it fixed, and it is
     * written as the report was: announce first, mount second.
     */
    const { announceThreads } = await import('../src/lib/threadAnnouncement.ts');
    const { announcePdfMarks } = await import('../src/lib/threadAnnouncement.ts');
    const { mountPdfViewer } = await import('../src/components/pdfViewer.ts');

    announceThreads('a-page', [
      {
        id: 't1',
        place: { file: 'f1', page: 1, rects: [HELLO] },
        resolved: false,
        messages: [{ id: 'm1', author: 'u1', text: 'Dazu eine Frage.', at: 0 }],
      } as never,
    ]);
    announcePdfMarks('a-page', [
      { id: 'k1', place: { file: 'f1', page: 1, rects: [FOOTER] }, quote: '', author: 'u1', createdAt: 0 } as never,
    ]);

    const host = dom.window.document.getElementById('host') as unknown as HTMLElement;
    const handle = mountPdfViewer(
      host,
      '/api/files/f1',
      {
        pageOf: (page, total) => `${page}/${total}`,
        loading: '…', failed: '…', openOriginal: '…', document: '…',
        previous: '…', next: '…', comment: '…', commented: '…',
        mark: '…', unmark: '…', marked: '…', download: '…', markedSuffix: '…',
      },
      { fileId: 'f1', mayMark: true, filename: 'x.pdf', nameOf: () => '' },
    );
    handle.destroy();
  });
});
