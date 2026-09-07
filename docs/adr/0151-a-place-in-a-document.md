# ADR-0151: A place in a document

## Status

Accepted. Built. The second of the rounds sketched in
`claude/pdf-markierungen-und-kommentare.md`, after ADR-0150.

## Context

ADR-0150 put the words back over the picture of them, which was the half a
comment needs: *something to quote*. This is the other half. A passage of a PDF
can now be selected and commented on, and the places somebody has already
commented on are drawn on the page.

The comment model has had two anchors since ADR-0046: a range of text, held as
two `Y.RelativePosition`s, and — since ADR-0057 — a canvas item, held as an id.
Neither fits a PDF. The document is not in the CRDT; it is a file, reached by id,
and the same file may sit on two pages.

## Decisions

### The third anchor is a file, a page and rectangles in points

```ts
interface PdfPlace { file: string; page: number; rects: PlaceRect[] }
type PlaceRect = [x, y, width, height];   // the page's own points, origin bottom left
```

**Nothing about it can move.** Storage is content-addressed, so the bytes a file
id names never change — which is why this anchor needs neither a relative
position nor a resolution step, and why it is the simplest of the three by a
wide margin.

The file is named **by its id, never by the hash of its contents**. The same
bytes uploaded into two workspaces are one stored object; a mark keyed by that
hash would be a comment leaking across a boundary the rest of the system spends
a great deal of effort defending.

Points rather than pixels, for the obvious reason and one less obvious one: a
mark in screen pixels is right on the machine that made it and wrong on the next
one, and it is also wrong on the *same* machine the moment a sidebar opens.

### One rectangle per line, joined by overlap

`Range.getClientRects()` returns one rectangle per span, and pdf.js's text layer
is one span per run of glyphs — so an ordinary line is six or eight of them and a
sentence and a half is forty. Stored, that is an anchor larger than the comment
on it; drawn, it is a mark with a seam every few characters.

Lines are found by **vertical overlap, not by an equal top**. A superscript, a
footnote marker and a smaller font in the same line all sit at tops of their own;
grouping by the number gives each of them a mark of its own floating above the
sentence it belongs to.

Over `MAX_PLACE_RECTS` lines, the *first* ones are kept rather than one box
around the lot. Where a long selection begins is what somebody scrolling to it is
looking for, and a single bounding box draws over the margins and the lines
between — claiming a great deal that was not selected. The quotation carries the
whole of it either way: the mark says where, the quotation says what.

### A place is a place on one page

A selection dragged past the foot of a page carries on into the next one. The
honest answer is the part on the page it began on — mark *and* quotation both,
rather than a quotation from page four drawn on page three.

### Both directions go through the engine's viewport

`convertToPdfPoint` and `convertToViewportPoint` invert the transform the page
was drawn with, rotation included. The hand-written version is `height - y`, and
it is silently wrong on every landscape scan. This is ADR-0150's rule — *the
layer is the engine's, not a second implementation of it* — applied to the
arithmetic beside it.

The viewport kept per page is at **scale one**, so it is the page as the PDF
describes it and not as this column happens to be showing it.

### A mark is positioned in percentages, and therefore needs no observer

The text layer has to be re-scaled on every resize because the engine positions
its spans in pixels (ADR-0150). A mark does not: a fraction of the page box is
the same fraction at every width. So the marks follow a sidebar opening, a window
drag and a scrollbar appearing with no `ResizeObserver` and no work at all.

Measured at three column widths — the mark's left edge sits on the glyphs'
at 688px, at 408px and at 848px (below).

### The marks sit under the text layer

`pointer-events: none`, and they are inserted *before* the layer. A mark that
took the pointer would mean a passage could be commented on exactly once, after
which it was no longer selectable — the feature disabling itself on first use.

### "Detached" got one home, and it was four

The panel asked `item === null && range === null` in three places and the hook in
a fourth. Each of them had already had to gain the `item` term separately when
the canvas arrived (ADR-0057) — so a third anchor was four separate chances to
tell somebody "the text this was about has been deleted" about a thread that was
never text. `isDetached(thread)` is in the core beside the shape it is about.

**And the fourth one was worse than a wrong sentence.** The hook's `open` group
asked the *positive* form, `item !== null || range !== null`, which a place
satisfies no more than the negative one — so a comment about a place would have
been in neither `open` nor `detached`: written, stored, announced, and drawn
nowhere. The two are complements and are now written as complements.

### The announcement says which document, and remembers

`sone:comments-changed` has carried the thread list since ADR-0046. Putting it in
one module (`threadAnnouncement.ts`) turned up two faults that had nothing to do
with PDFs:

**Two documents were shouting on one channel.** A page with a protected section
has a second comment document (ADR-0093), read by a second copy of the hook, and
both announced on the same event with nothing to tell them apart. Whichever ran
last is what the editor drew — so an internal reply rebuilt the public marks from
threads whose anchors resolve against a document the editor is not showing, which
is to say from nothing. Every announcement now carries the document's guid, and
the editor ignores the other one.

**A listener that arrives late heard nothing.** An event is gone the moment it is
dispatched. The hook announces when the page opens; the viewer is mounted later,
by the editor, when a file block comes into view — so it missed every
announcement and would have drawn no marks at all until somebody happened to
write a comment. The last announcement per document is kept and replayed to a new
subscriber at once, and retired when the hook lets the document go.

### The viewer speaks to the page by event, not by callback

The viewer is a ProseMirror node view, built from a map of constructors handed to
`createEditor`. Handing it `onComment` would mean threading a function through
`createEditor`, the node views map, the file block and a viewer handle — five
parameters for one message, each rebuilt on every render. It dispatches
`sone:pdf-comment`; the editor surface listens, **checks the shape with the
core's own `isPlace`**, and hands it to the page as an anchor like any other.

## Consequences

**Twenty-three new tests**, in three kinds, and the split is the point:

- the line arithmetic is *run*, because it is arithmetic;
- the announcement is *run* in jsdom, because it is window events and a cache;
- the viewer's wiring is *read*, for ADR-0150's reason — pdf.js needs a worker, a
  canvas and a real layout, and jsdom has none of the three.

### Measured, both directions, against the probe document

The same hand-written PDF as ADR-0150: `Hallo Welt` in 24pt Helvetica with its
origin at (72, 700) on a 612×792 page.

**A selection, read back as points.** Dragging across the line and reading what
the button would send:

```
[71.97, 694.73, 109.35, 26.69]
```

The width is the number that settles it. Helvetica's own metrics for those ten
characters sum to 4556/1000 em, which at 24pt is **109.34pt** — the round trip
through the browser's line boxes, the column's scale and the engine's inverse
transform lands on the type designer's arithmetic. The left edge is 71.97 against
the PDF's 72. The box is about 4pt taller than the glyphs at the top, which is
the browser's line box rather than the font's, and is what a reader sees selected.

**A place, drawn back as a mark.** A thread at `[72, 695, 119, 22]`:

| | x | y | width | height |
|---|---|---|---|---|
| expected | 102.94 | 134.29 | 133.77 | 24.73 |
| measured | 102.9 | 134.3 | 133.8 | 24.7 |

and the mark's left edge is the text span's left edge to the tenth of a pixel.

**And it holds through a resize**, with nothing watching:

| column | scale | span x | mark x |
|---|---|---|---|
| 688px | 1.1242 | 102.9 | 102.9 |
| 408px | 0.6667 | 70.0 | 70.0 |
| 848px | 1.3856 | 121.7 | 121.8 |

### What is not in this round

**Clicking a mark does not reveal its thread.** The canvas's marks are not
clickable either (ADR-0057) — a mark says a thing has been discussed and the
panel is where it is read — and the panel's own reveal button needs a scroll
target inside a node view, which is a mechanism of its own.

**Marking without commenting** is round three, and **writing the marks into the
file** is round four.

## Alternatives considered

**Rectangles in screen pixels.** Right on the machine that made them, wrong on
the next one and wrong on the same one after a resize.

**The file by content hash.** One stored object is shared between workspaces; a
mark keyed by the hash is a comment crossing a boundary everything else defends.

**Store the raw client rectangles.** Forty per selection, a seam every few
characters, and an anchor larger than the comment.

**Mend a bad place instead of refusing it.** Then every reader has to decide what
a rectangle of three numbers means, instead of one line here.

**A callback threaded down to the node view.** Five parameters for one message.

**Reposition the marks on resize, like the text layer.** Unnecessary: the layer
needs it because the engine works in pixels, and a percentage does not.
