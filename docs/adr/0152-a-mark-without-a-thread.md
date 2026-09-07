# ADR-0152: A mark without a thread

## Status

Accepted. Built. The third of the rounds sketched in
`claude/pdf-markierungen-und-kommentare.md`, after ADR-0150 and ADR-0151.

## Context

ADR-0151 made a place in a PDF something a *comment* can be about. This is the
other thing a reader does to a document: marking a passage and saying nothing
about it — the highlighter rather than the margin note.

## Decisions

### It is not a thread with no messages

That was the obvious first answer, and ADR-0046 had already ruled it out from
the other side: *"a thread with no messages is not a thread — it would arrive on
another screen as a highlight over nothing"*. A highlight over nothing is
precisely what this is meant to be, so the two want opposite things from one
shape. Every reader of the comments would then have to ask "and does this one
have anything in it" — the same rule in five files again, which is the mistake
ADR-0151 spent a section undoing.

So: `pdfMarks`, its own map beside `comments` in the same document. A mark
carries a place, the words it sits on, who put it there, and when.

An absent map reads as an empty one, so this needed no schema bump — the rule
`SCHEMA_VERSION` states, applied rather than assumed.

### The quotation is kept, and here it matters more than on a thread

A thread explains itself in its messages. A mark has none, so without the words
it sits on it is a rectangle on page seven of a file, and the only way to learn
what it is about is to open the file and look.

### Two weights of one colour, not two colours

A commented passage and a marked one differ by *degree* — "being discussed"
against "worth a second look" — and a second hue would be a second convention to
learn for that. The accent at 16% for a thread, at 8% for a plain mark. The same
argument ADR-0046 used to reject highlighter yellow for a comment mark.

### There is nothing to click on a mark, so un-marking is a selection

The marks are `pointer-events: none` so that pdf.js's text layer above them stays
selectable (ADR-0151). Turning that off to make a mark clickable would mean **a
passage could be marked exactly once**, after which it was no longer selectable —
the feature disabling itself on first use.

So un-marking is asked with the gesture marking is: select the passage again. One
button, which says which of the two it would do.

**Touching, not containing** — and this was measured rather than reasoned about
(below). Nobody re-selects the same run of glyphs twice.

**Every mark the selection touches comes off**, not the nearest one. A drag that
lands across two marks, removing one and leaving the other, is a result nobody
could predict from the gesture they made.

### The page is compared before the rectangles

Two pages of a document share a coordinate system, so on rectangles alone a mark
at the top of page three sits exactly where one at the top of page four does —
and un-marking one would have taken the other with it, on a page nobody was
looking at. Same file, same page, then overlap.

### A member may mark; a share-link visitor may not, in this round

Not because a highlighter is more dangerous than a sentence — it says strictly
less, and a `commenter` link can already write one. It is that **taking a mark
off again would have to be offered too**, and the only thing a link can tell two
visitors apart by is the name they typed (ADR-0046). A mark that can be made and
never un-made is worse than one that is not offered, so the pair is offered
together or not at all.

The refusal is a 403 with a code of its own rather than this module's usual 404.
Those 404s exist so a page id cannot be confirmed by probing; this person has
already been told the page exists — they may comment on it — so hiding the
reason would only mean a button that fails and says nothing.

Reversing this needs the name on the request, exactly as the comment routes take
it, and nothing else.

### A mark is silent

No notification, and no "the person who shared this should hear about it" of the
kind ADR-0090 added for a visitor's first comment. Telling somebody about a
highlight would make it a comment with no words in it, which is the shape this
record opens by refusing to store.

### The announcement module grew a second channel, written once

ADR-0151 gave the threads a channel with a per-document cache and a replay for a
late subscriber. The marks need exactly that again, so the three lines are a
`channel<T>()` and the two exported pairs are wrappers over it. The second copy
is where a fix stops being applied to both.

### The hook does not listen to document updates

`useComments` must: a thread's *range* resolves against the text, so it changes
when the text does. A place cannot move — it names a file whose bytes are fixed
and a rectangle in that file's own coordinates. Observing the map is the whole of
it, and re-reading every mark on every keystroke would be work for a number that
cannot have changed.

## Consequences

**Twenty-eight new tests** — nine in the core over the document shape, five over
the server routes, and fourteen in the web over the overlap rule, the hook and
the viewer's wiring.

### Measured in Chromium, and the overlap rule earned itself

Against ADR-0150's probe document. A stored mark on the footer line at
`[72, 117, 80, 11]`; selecting that line gives:

```
[71.97, 117.62, 84.04, 13.34]
```

**Neither contains the other** — the selection is four points wider and starts
three hundredths of a point to the left. A containment rule would have answered
"there is nothing marked here" while the reader was looking straight at the mark.
Overlap answered correctly, and `sone:pdf-unmark` carried the right id.

The width is 84.04 where Helvetica's own metrics for `Fusszeile unten` sum to
7003/1000 em, or **84.036pt at 12pt** — the second time this round-trip has
landed on the type designer's arithmetic.

And both weights, drawn on one page:

| | left edge | fill |
|---|---|---|
| text span | 102.9 | — |
| commented place | 102.9 | `color(srgb 0.184 0.490 0.435 / 0.16)` |
| plain mark | 102.9 | `color(srgb 0.184 0.490 0.435 / 0.08)` |

One hue, two alphas, both on the glyphs they belong to.

### What is not in this round

**Marks are not listed anywhere.** A mark is on the page, which is where a
highlighter's marks are. If "show me everything marked in this document" turns
out to be wanted, it is a list and its own small round.

**Writing the marks into the file** is round four (`saveDocument`), and is what
the whole sequence was for.

## Alternatives considered

**A thread with no messages.** ADR-0046 refused that shape, and correctly.

**A colour per mark.** A palette is a vocabulary nobody has agreed on, and the
first question it raises — what does yellow mean here — has no answer the
software can give.

**Make the marks clickable.** They would take the pointer the selection needs,
and a passage could be marked exactly once.

**Remove only the nearest mark.** Unpredictable from the gesture.

**Offer marking to a share link.** Then removal has to be offered on the strength
of a typed name, or not at all — and a one-way act is worse than none.

**A second announcement module.** The same cache, replay and guard again, and one
of the two copies would have kept a bug.
