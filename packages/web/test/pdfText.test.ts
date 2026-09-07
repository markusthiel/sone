/**
 * Text in a PDF, selectable (ADR-0150).
 *
 * The viewer has drawn pages to canvases since ADR-0048, which makes a document
 * a picture of a document: nothing can be selected, nothing copied, and there
 * is no quotation for a comment to be *about*. This is the layer that changes
 * that — pdf.js's own, a transparent span per run of glyphs, laid over the
 * canvas at the size the column gave it.
 *
 * Read rather than mounted, and that is not laziness: pdf.js needs a worker, a
 * canvas and a real layout, and jsdom has none of the three. What a test here
 * can hold is the contract — the numbers the layer is positioned by, the
 * vendored stylesheet staying in step with the engine, and the layer being
 * released with the page it belongs to. **The alignment itself was measured in
 * Chromium against a real document**, and that measurement is recorded in
 * ADR-0150 rather than pretended at here.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));
const vendored = readFileSync(new URL('../src/pdfTextLayer.css', import.meta.url), 'utf8');

test('the layer is the engine’s, not a second implementation of it', () => {
  /*
   * Positioning a glyph run is the engine's business: it knows the page's
   * transform, the font's ascent and the letter-spacing trick that makes a
   * proportional font line up with what was rasterised. A hand-written layer is
   * that arithmetic copied, and it is wrong in ways that only show as a
   * selection landing one word to the left.
   */
  assert.match(viewer, /new pdfjs\.TextLayer\(\{/);
  assert.match(viewer, /textContentSource: await page\.getTextContent\(\)/);
  assert.doesNotMatch(viewer, /item\.transform/, 'nothing here computes a glyph position');
});

test('and it is measured in the pixels the reader sees, not the ones we rasterise at', () => {
  /*
   * The canvas is drawn at `fit * devicePixelRatio` and displayed at 100% of the
   * column, so its buffer is two or three times its box. The text layer is DOM:
   * its numbers are CSS pixels. Handing it the rasterising viewport would put
   * every span at two or three times the right offset — on a phone, off the
   * page entirely.
   */
  assert.match(viewer, /const cssViewport = page\.getViewport\(\{ scale: fit \}\)/);
  assert.match(viewer, /viewport: cssViewport/);
  assert.doesNotMatch(
    viewer,
    /new pdfjs\.TextLayer\([^)]*viewport: viewport/s,
    'never the device-pixel one',
  );
});

test('the page slot carries the four properties the engine sizes by', () => {
  /*
   * `setLayerDimensions` writes `width: round(down, var(--total-scale-factor) *
   * 612px, var(--scale-round-x))`. Those names are the engine's contract with
   * whoever hosts its layer, and with none of them defined the width is
   * `round(down, NaN, NaN)` — a layer of zero size holding every span at the
   * origin.
   *
   * They live on our own class rather than in the vendored file because the
   * scale is ours: it is the width our column gave the canvas.
   */
  assert.match(css, /\.pdf-page \{[^}]*--user-unit: 1/s);
  assert.match(css, /\.pdf-page \{[^}]*--total-scale-factor: calc\(var\(--scale-factor\)/s);
  assert.match(css, /\.pdf-page \{[^}]*--scale-round-x: 1px/s);
  assert.match(css, /\.pdf-page \{[^}]*--scale-round-y: 1px/s);
  // And a positioned box, or `inset: 0` on the layer is the whole column.
  assert.match(css, /\.pdf-page \{[^}]*position: relative/s);
});

test('the scale follows the column, because a stale one is a misaligned page', () => {
  /*
   * Everything the engine positions is expressed against `--scale-factor`, which
   * is what makes zooming a variable change rather than a re-render. Our
   * "zoom" is the column resizing — a sidebar opening, a window dragged — and
   * the canvas follows it for free because it is `width: 100%`. The layer does
   * not: without this, text stays where it was drawn while the picture under it
   * grows.
   */
  assert.match(viewer, /new ResizeObserver/);
  assert.match(viewer, /setProperty\('--scale-factor'/);
});

test('a released page takes its text with it', () => {
  // A hundred-page document read to the end holds a hundred canvases without
  // the release ADR-0048 built; a text layer is a few thousand spans on top of
  // that, so a layer that outlived its canvas would be the same leak again,
  // in the DOM instead of in memory.
  assert.match(viewer, /slot\.textContent = ''/);
  assert.doesNotMatch(viewer, /layers\.set\(/, 'nothing holds a layer past its slot');
});

test('a page that will not draw leaves a trace', () => {
  /*
   * The gap stays a gap — a damaged object should not cost the pages either
   * side of it — but the failure is no longer swallowed whole. It was, and a
   * blank page with nothing anywhere to explain it cost an afternoon: the cause
   * was a browser older than the engine's own requirements, which no amount of
   * looking at our own code would have found.
   */
  assert.match(viewer, /console\.warn\(`SONE: page \$\{number\}/);
  assert.doesNotMatch(viewer, /\} catch \{\s*\n\s*(\/\*|\/\/)?[^}]*slot\.dataset\['drawn'\] = 'failed'/s);
});

test('the stylesheet is loaded with the engine, not with the application', () => {
  // Half a megabyte must not land on somebody who never opens a PDF (ADR-0048),
  // and the same is true of a stylesheet for a layer they will never see.
  assert.match(viewer, /import\('\.\.\/pdfTextLayer\.css'\)/);
  assert.doesNotMatch(viewer, /^import .*pdfTextLayer\.css/m, 'never statically');
});

test('the vendored block is still what the engine ships', () => {
  /*
   * **The point of vendoring it at all.** The rules are the contract pdf.js's
   * own positioning assumes; a fork of them has nothing to notice when the
   * engine moves. So this reads the stylesheet out of the installed package and
   * compares the block, and an upgrade that changes it goes red here — which is
   * the moment to look, rather than the moment a selection stops landing on the
   * word under the cursor.
   */
  const require = createRequire(import.meta.url);
  const shipped = readFileSync(
    require.resolve('pdfjs-dist/web/pdf_viewer.css'),
    'utf8',
  );

  const lines = shipped.split('\n');
  const start = lines.findIndex((line) => line.startsWith('.textLayer{'));
  assert.ok(start >= 0, 'the engine still ships a .textLayer block');

  let depth = 0;
  let end = start;
  for (let at = start; at < lines.length; at += 1) {
    depth += (lines[at]!.match(/\{/g) ?? []).length - (lines[at]!.match(/\}/g) ?? []).length;
    if (depth === 0) {
      end = at;
      break;
    }
  }
  const block = lines.slice(start, end + 1).join('\n').trim();

  // Ours, with its provenance comment taken off — the comment is the part that
  // is ours to write.
  const mine = vendored.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
  assert.equal(mine, block, 'the vendored text layer has drifted from pdfjs-dist');
});
