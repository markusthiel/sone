# ADR-0166: Take me to the top

## Status

Accepted. Built.

## Context

Reported after living with the right sidebar:

> Momentan scheint der Anker Mittig im Bildschirm zu sitzen. Gewohnheitsmäßig
> habe ich aber direkt ganz oben am Bildschirmrand gesucht. … Daher zwei
> Möglichkeiten das zu verbessern: Entweder wird der Inhalt kurz hervorgehoben,
> durch ein kurzes aufblinken … Oder die Seite sollte an die entsprechende
> Stelle scrollen so dass sie oben auf der Seite liegt. … Vielleicht auch beides.

Both, and the answer to *why both* is the interesting part: they are not two
ways of saying the same thing.

## Decisions

### `start`, and the old reason was backwards

`scrollToBlock` centred, with this beside it:

> `center` rather than `start`: a heading pinned to the very top of the viewport
> hides the paragraph that follows it, which is what the person actually wanted
> to read.

A heading at the top has everything that follows it **below** it — which is
exactly what somebody who pressed a heading wants to read. Centring is what puts
the paragraph *before* it on screen: the one they did not ask for.

Measured at 1400 × 900, distances from the top of the scrolling box:

| | block's top |
|---|---|
| `center` (before) | 469 |
| `start` (now) | **64** |

### The bar owns the first fifty-two pixels, so the block starts under it

`block: 'start'` means the top of the scrolling box, and the bar is sticky over
the top of that box — so without help, the thing somebody asked to see arrives
underneath the thing they asked from. Every block therefore carries

```css
scroll-margin-block-start: calc(var(--topbar-block-size) + var(--sone-space-5));
```

which is the length ADR-0163 had to name for the cover, earning its second
reader. Measured: block top 64, bar bottom 52 — **twelve pixels clear**, so it
reads as *below* the bar rather than *against* it.

### And the flash, because the scroll cannot always keep its promise

This is why it is both and not either. The scroll decides where to look; the
flash says *this one*. They come apart at the end of a document:

| | block's top | clear of the bar |
|---|---|---|
| block 20 of 40, `start` | 64 | 12 |
| **the last block, `start`** | **497** | 445 |

The page has nothing left to scroll, so the last paragraph lands in the middle
of the screen however faithfully the instruction is followed — and **arriving
near something is not being shown it**. The flash is the half that still works
there.

### It is ADR-0156's flash, not a second one

The PDF marks already had this: a stronger fill and a ring that hold, with a
short pulse on top, and **only the pulse removed** under
`prefers-reduced-motion` — because which of a page's marks is the one you asked
for is information, and this stylesheet switches decoration off, not
information.

A block reuses the ring, the keyframes and the duration. What differs is the
weight of the fill: 34% is right for a few highlighted words and wrong for a
paragraph, which at that weight is a paragraph nobody can read while it is being
pointed at. 10%.

**`FOUND_MS` moved into `lib/found.ts`.** It was a local constant in the PDF
viewer, and the second reader made it two answers to "how long is a moment".
The lighting itself could not be shared — a mark is redrawn from state the
viewer holds, a block is an element already in the document — but the number is
one decision.

### One lit thing at a time, explicitly

`showAsFound` clears the previous element's attribute rather than trusting the
timeout it is about to cancel. Two jumps in quick succession must leave exactly
one thing lit; a block that stayed lit would make the *second* jump look like
nothing happened, which is the fault this mechanism exists to prevent.

### The flash can be cut short, and that is the right trade

The element belongs to ProseMirror, which owns its DOM: a re-render of that node
while the flash is on takes the attribute with it. That needs a keystroke inside
that block during the second and a half after pressing something in a panel. The
alternative is a decoration plugin and a transaction for something that is not
part of the document.

## Consequences

Every caller gets both halves, because they all go through one function: the
outline, the files, the images, the links, the tasks, and the deep link a search
result follows into a page (`#block-…`).

The PDF viewer's own reveal moved to `start` as well. One rule for *take me
there*, rather than one caller centring for reasons nobody wrote down.

**Eight tests.** Four drive `scrollToBlock` against a real DOM with a stubbed
scroll — the options it asks for, the attribute appearing, the attribute going
away on time, and two jumps leaving one thing lit. Three read the stylesheet.
One holds that the duration has a single home.

### The assertion that failed against correct CSS

`/@media \(prefers-reduced-motion: reduce\) \{[^}]*\[data-block-id\]\[data-found\]/`
cannot match, because `[^}]*` stops at the first closing brace — and the rule it
was looking for sits after another rule inside the same block. The stylesheet
said exactly the right thing and the test said no. Bounded `[\s\S]{0,4000}?`
instead.

## Alternatives considered

**Only the scroll.** It cannot keep its promise at the end of a document, which
is where a link panel's last entry usually points.

**Only the flash.** Then the answer to *„ich habe oben gesucht"* is a light in
the middle of the screen.

**Scroll the block to the very top edge.** The bar covers it, which is the
version of `start` that would have justified the old comment.

**A second highlight style for blocks.** Two things to keep in step, drifting
the first time either was tuned.
