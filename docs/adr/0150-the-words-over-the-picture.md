# ADR-0150: The words over the picture

## Status

Accepted. Built. The first of the rounds sketched in
`claude/pdf-markierungen-und-kommentare.md`.

## Context

The viewer draws each page to a canvas (ADR-0048), which makes a document a
*picture* of a document: nothing can be selected, nothing copied, nothing found,
and — the reason this comes first — there is no quotation for a comment to be
about. The comment model calls the quotation *"not a cache — it is what the
comment is about"*, and a mark on a PDF with nothing quotable behind it would be
a thread nobody can read a week later.

pdf.js draws a text layer of its own: one transparent span per run of glyphs,
positioned from the page's transform, sitting over the canvas.

## Decisions

### The layer is the engine's

Positioning a glyph run means knowing the page transform, the font's ascent and
the letter-spacing trick that makes a proportional font line up with what was
rasterised. Writing that here would be the engine's arithmetic copied, and wrong
in ways that only ever show as a selection landing one word to the left.

### Its stylesheet is vendored, and checked against the engine

The `.textLayer` rules are the contract that positioning assumes. They are copied
verbatim into `src/pdfTextLayer.css` — with a test that reads the block out of
`pdfjs-dist/web/pdf_viewer.css` and compares it, so an upgrade that changes it
goes red at that moment rather than at the moment somebody's selection stops
landing on the word under the cursor.

Only that block. The shipped stylesheet is 160KB and carries five `:root` rules;
importing it would put pdf.js's custom properties into our theme. It is loaded
on demand beside the engine, for ADR-0048's reason.

### CSS pixels, not device pixels

The canvas is rasterised at `fit × devicePixelRatio` and displayed at 100% of its
slot, so its buffer is two or three times its box. The layer is DOM: its numbers
are CSS pixels, and it gets a second viewport at `scale: fit`. Handed the
rasterising viewport, every span would sit two or three times too far along.

### The slot is the zoom, and the slot is what is watched

Everything the engine positions is written against `--scale-factor`, which is
what lets a zoom be a variable change rather than a re-render. Our zoom is the
column resizing, so a `ResizeObserver` re-sets that one property per drawn slot.

**It observes the slots, not the column**, and that distinction is the round's
sharpest find (below).

## Consequences

**Eight tests.** They hold the contract — the viewport the layer is measured in,
the four custom properties the engine sizes by, the vendored block, the release
with the slot. **They do not hold the alignment**: pdf.js needs a worker, a
canvas and a real layout, and jsdom has none of the three. So the alignment was
measured in Chromium against a hand-written PDF whose text sits at coordinates
chosen in advance, and the arithmetic is here rather than pretended at in a test.

### Measured, and it was wrong by a scrollbar

The first version took the width from the column (`pages.clientWidth`) and the
canvas took its width from the slot. Those differ by a scrollbar, and the
document is longer than the window in every case that matters:

| | width |
|---|---|
| canvas (100% of the slot) | 688px |
| text layer (`--scale-factor` from the column) | 700px |

Twelve pixels, spread across the page: at the left margin nothing looks wrong,
and by the right margin the invisible text runs a word past the drawn glyphs.
The slot is measured now, at draw and on resize.

**And the `ResizeObserver` was watching the wrong box for the same reason.** A
scrollbar appearing changes the column's *content* box and leaves its border box
alone — so an observer on the column sleeps through the one resize that is
certain to happen. It observes the slots.

After the fix, measured: layer and canvas are the same box to the pixel, the
first span sits at 87px where the arithmetic says 87px (72pt × 1.1242 + 6px of
padding), and the alignment holds when the column is narrowed to 420px and
widened to 848px.

### A page that will not draw now leaves a trace

The catch around a page render set `data-drawn="failed"` and said nothing
anywhere. That cost an afternoon in this round: pages were silently blank, and
the cause was **the measuring browser**, not the code — pdf.js 6 calls
`Map.prototype.getOrInsertComputed`, which the bundled Chromium here predates.
No amount of reading our own code would have found it.

The gap stays a gap; a damaged object should not cost the pages either side of
it. But there is a `console.warn` with the page number now, because a blank page
nobody can explain is worse than a blank page with a line to go on.

## Alternatives considered

**Write the text layer ourselves** from `getTextContent()` items. It is the
engine's arithmetic, copied, and the failure mode is silent misalignment.

**Import `pdf_viewer.css`.** 160KB and five `:root` rules into our theme, for one
block of it.

**Flatten the vendored block into our own stylesheet.** Then it cannot be
compared to its source, which is the whole reason for vendoring rather than
rewriting.

**Re-render the page on resize** instead of moving a custom property. That is a
canvas re-rasterisation per drag frame, for a layout the engine can do with one
variable.

**Wait and do this with the markings.** The text layer is worth having on its
own — selecting and copying out of a PDF is what people expect of one — and
folding it into a larger round would have hidden the scrollbar find inside a
feature nobody could review.
