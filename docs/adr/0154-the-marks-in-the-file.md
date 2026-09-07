# ADR-0154: The marks in the file

## Status

Accepted. Built. The last of the four rounds sketched in
`claude/pdf-markierungen-und-kommentare.md`, and the one the other three were
for.

## Context

A place in a PDF has been something a comment can be about since ADR-0151, and
something a reader can simply mark since ADR-0152. Both live in SONE's own
document — which is what makes them live, shared and offline — and it also means
a copy of the file sent to somebody outside carries none of it.

The storage question was settled before any of this was built: *„die echte
PDF-Datei mit eingebrannten Markierungen entsteht auf Abruf beim
Herunterladen"*. This is that.

## Decisions

### On demand, never at rest

A second, annotated copy of every file would be two files that can disagree, a
rewrite on every comment, and a stored object whose bytes no longer match the
hash the store names it by — which is the property the whole anchor rests on
(ADR-0151). The copy is produced when somebody asks for it and is not kept.

### The engine writes it

A `/Highlight` is a dictionary, an appearance stream, a quad-point array in the
page's own space and an incremental update with a correct cross-reference table.
Writing that by hand is a PDF writer, in a module whose job is to turn four
numbers into four other numbers — ADR-0150's rule for the text layer, applied at
the other end.

What is handed to pdf.js is the shape its own highlight editor produces:
`quadPoints` for the writer, `outlines` for the appearance stream, and a `popup`
when there is something to say.

**The one integer that is copied rather than imported** is
`AnnotationEditorType.HIGHLIGHT`. Importing the engine to read it would put half
a megabyte in front of everybody who never opens a PDF (ADR-0048). So it is
copied *and compared*, exactly as the vendored stylesheet is: a test reads it out
of `pdfjs-dist` and asserts they agree, and an upgrade that renumbers goes red
there rather than at the moment somebody's marks come out as ink scribbles.

### An incremental update, so the original is still in there

The bytes that were there stay byte for byte and the annotations are appended
with a table pointing back. A signature over the original still verifies, nothing
is re-encoded, and the copy is the document plus what was said about it rather
than a new rendering of it.

### The colour is the one the reader is looking at

Not a fixed yellow: somebody who has looked at green marks all afternoon should
not open the copy and find yellow ones. Not the stored theme either — a treated
surface redefines the same name (ADR-0122), so the only honest answer is what the
browser resolved *inside this viewer*.

A custom property has no computed colour, because nothing has asked it to be one:
`getPropertyValue('--accent')` hands back `var(--sone-base-accent)` or an
unperformed `color-mix`. So a hidden element inside the viewer is given it as its
`color`, which does compute, and the answer is read off that with the same parser
that reads a ground (ADR-0149) — which moved to `lib/computedColor.ts`, because
it now answers two questions and belongs to neither.

### Two weights, translated rather than copied

The screen draws the accent at 16% for a discussed passage and 8% for a marked
one. A PDF multiplies `CA` over the page instead of mixing, so the numbers are
not the same numbers — `0.4` and `0.2`. The **ratio** is, which is what the
distinction is made of.

### The note is closed, beside the mark

A note that opens itself covers the words it is about the moment the file is
opened, which is the opposite of what a comment on a passage is for.

A plain mark gets no `/Contents` and no popup at all: an annotation with empty
contents is a note that opens onto nothing.

### Names where there are names, and nothing where there are not

The conversation is written the way somebody would read it aloud — `Name: text`,
blank line, next — and the quotation is left out, because it is the text under
the mark and repeating it would say everything twice.

An author nobody can name is written without one. "Unknown: …" is a fact about
our records, not about the document.

The names come from the map the assignment chips already keep (ADR-0052), read
through a ref at the moment of a save: the editor is built once and the
workspace's people arrive over HTTP afterwards.

### The offer is hidden until there is something to write

A button that produces an identical copy of the file is a button with nothing to
do, and offering it is a small promise broken every time somebody presses it.

### Saving twice does not mark the same passage twice

pdf.js's annotation storage is a map that outlives a save, and downloading,
commenting and downloading again is ordinary. The keys are deterministic and the
previous save's keys are removed first, so the second copy *replaces* rather than
adds — and a mark taken off in between is gone from it.

## Consequences

**Sixteen new tests, and eleven of them run the engine and read the bytes.**
That is unusual in this feature: ADR-0150 and ADR-0151 both had to settle for
reading source, because drawing needs a worker, a canvas and a real layout.
*Writing* needs none of those — `getDocument` and `saveDocument` work in Node —
so the honest test is to produce a file and look inside it. Every mistake worth
making here is a mistake in what comes out: the quad-point order, the page index,
the missing appearance stream, the doubled save.

### Measured in Chromium, end to end

Against the probe document, with one comment thread and one plain mark, in the
running viewer:

```
Satzung mit Markierungen.pdf   2276 bytes

/Subtype /Highlight  /Rect [72 695 191 717]
  /QuadPoints [72 717 191 717 72 695 191 695]
  /C [0.1843137255 0.4901960784 0.4352941176]  /CA 0.4
  /T (Markus Thiel)  /Popup 10 0 R
/Subtype /Highlight  /Rect [72 117 156 130]   /CA 0.2
/Subtype /Popup      /Open false
```

Read back with the engine, the note says
`Markus Thiel: Stimmt die Zahl?` / `Rieke: Ja, geprüft am 3.9.` — stored as
UTF-16BE, umlaut intact. The file still begins `%PDF-1.4`, still contains
`(Hallo Welt) Tj`, and carries `/Prev 449` behind the new table.

### Saving needs a newer browser than reading

ADR-0150 recorded that pdf.js 6 calls `Map.prototype.getOrInsertComputed`. The
save path calls **`Math.sumPrecise`** as well, and both run in the *worker*,
which has its own global scope — so a polyfill on the page never reaches them.
The measuring browser here failed on each in turn, and the harness had to serve
the polyfills in front of the worker file.

For an operator that means the floor for *downloading a copy* is at least the
floor for reading one, and the failure is loud rather than silent (below).

### The message, not the class

The first failure reported `UnknownErrorException`, which named nothing. Logging
`error.message` instead named everything: `getOrInsertComputed is not a
function`. The catch keeps the message now — ADR-0150's rule, sharpened: a
trace is only a trace if it says which thing broke.

## Alternatives considered

**Burn on the server.** No PDF library there today, and it would need the marks,
the accent and the names to travel to it — a second implementation of what the
viewer already holds, for a file the viewer already has open.

**Store an annotated copy.** Two files that can disagree, and a stored object
whose bytes stop matching its hash.

**Write the annotations by hand.** That is a PDF writer.

**A fixed highlight colour.** Green on screen, yellow in the copy.

**Export the comments as a separate document.** A list of quotations beside a
file is a thing nobody can line up again; the point of a place is that it is
*in* the page.

**Open the notes in the copy.** They would cover the passages they are about.
