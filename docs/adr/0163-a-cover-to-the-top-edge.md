# ADR-0163: A cover to the top edge

## Status

Accepted. Built.

## Context

Asked for the day after ADR-0162, with the consequence named in the same breath:

> Eine weitere Einstellung dass das Titelbild bis oben zum Seitenrand läuft. Das
> hat zur Folge das die buttons für die Seitenleisten und das Synced und die
> User-Kürzel dann im Bild stehen. Die könnte man dann abheben mit den selben
> Flächen, die man beim Hover auf der schmalen Leiste hat.

The second sentence is the whole round. A picture reaching the top of the window
is four lines of CSS; a picture underneath the page's own controls is a contrast
problem that this project has an apparatus for — and the apparatus does not
work here.

## Decisions

### A third step in the width row, not a second setting

`'column' | 'full' | 'bleed'`. One row, three steps, widest last.

A second field would allow "in the reading column, and also up under the bar",
which puts the page's controls over the page's own background — where they
already are. The row is a scale, and *bis oben* is its top end.

### The ink cannot be computed, so every control brings its own ground

`readableInk` decides ink against a **known** ground (ADR-0135), which is how
every treated surface in this application stays legible. A photograph has no
ground: it is dark on one side of the bar and light on the other, so no single
ink is right across it, and sampling pixels to find out is not a thing a
stylesheet can do.

The request already contains the answer: *„die könnte man dann abheben mit den
selben Flächen, die man beim Hover auf der schmalen Leiste hat"*. `--surface-hover`
is **opaque** — a `color-mix` of the theme tint into the page's own background,
not a veil — so a chip under each control puts a known ground back, and the
pairing is the one `contrast.test.ts` already governs everywhere else. A
translucent scrim would have left the ink guessing again, one layer up.

The peers' initials need nothing: they already sit on their own author colour.

### The status is one chip, so it needed a wrapper

The dot and the words were two siblings of the bar. A dot with its own little
pill beside a separate pill of words is two chips where there is one fact, so
`PageStatus` gained an element around them. Its padding is there at every
moment and only the surface comes and goes — a chip that gained room at the
same time as its background would move the status text sideways on the first
scroll.

### The bar's existing rule does the right thing for free

The bar has had no fill until the page is scrolled since ADR-0042, because
*"the line has exactly one job — saying that something is above"*. Over a
bleeding cover that is exactly right: at rest it floats over the picture, and
the first scroll fills it again, because from then on there is writing passing
behind it. Nothing new had to decide when to be transparent.

### It is all in the stylesheet, and `:has()` is why

The bar is rendered by `App` and the cover by `PageView`, two siblings. Wiring
this through React means a callback upward, state in `App`, and a value that is
stale for a frame after every navigation — and for a page it would have to
choose between the tree's projected cover and the document's live one.

```css
.main:not([data-scrolled='true']):has(.topbar + .page-body .entry-cover[data-width='bleed'])
  .topbar { … }
```

reads the live document instead, which cannot be stale. `.main:has(> .page-body[data-kind='canvas'])`
already does the same thing one line further up in this file.

**And the adjacency is load-bearing, not tidiness.** `.topbar + .page-body`
means that a banner between them — a stale-bundle notice, a two-factor deadline
— takes the bleed off by existing. Otherwise the picture would slide underneath
the sentence telling somebody their browser is running an old build. Neither
component has to know about the other for that to hold: the selector is the
agreement.

### Two lengths stopped being results and became decisions

The band is pulled up by the bar's height **and** the page body's top padding,
and made taller by the same two, so it grows into the space it swallows and
nothing below it moves. Both numbers used to be consequences — the bar was as
tall as its tallest control; the padding was written once, in one place — and a
second reader turns a consequence into a promise:

```css
--topbar-block-size: 52px;   /* enforced with min-block-size on .topbar */
--page-body-block-start: 24px;
```

Without the second half of that arithmetic, turning the setting on shifts the
heading and the writing under it up by 24px, which is a setting that moves the
text somebody was reading.

`--page-body-block-start` had to leave the `padding` shorthand to be named:
`padding: var(…) 20px 40vh` is exactly the mixture `density.test.ts` refuses,
because a density would move one axis of it and not the other two.

### A shared link was scrolling behind nothing

`useScrolled` was never wired into `ShareSession`. Invisible until now — its bar
simply never drew its line — but *"not scrolled"* would have meant *"transparent
forever"* here, and a visitor scrolling a shared page would have had the writing
pass behind an invisible bar. Fixed in this round because this round is what
made it matter.

## Consequences

### Measured in Chromium, real stylesheet, real bar contents

1400 × 900, sidebar shown, a picture that is near-black on the left half and
near-white on the right — the case where no single ink is right. Distances are
from the top of `.main`:

| | band | first line of text | bar | toggle's ground | clickable | sideways |
|---|---|---|---|---|---|---|
| nothing set | 76 → 418 | 499 | white | none | yes | 0 |
| full width | 76 → 418 | 499 | white | none | yes | 0 |
| **edge to edge, at rest** | **0** → 418 | **499** | **transparent** | **opaque** | yes | 0 |
| edge to edge, scrolled 300 | −300 → 118 | 199 | white | none | yes | 0 |
| edge to edge, with a banner | 110 → 452 | 533 | white | none | yes | 0 |

Three rows carry the argument. The band starts at **0** and the first line of
text has **not moved** (499 in both) — the picture grew into the space rather
than pushing the page. The controls stay hit-testable over the image. And the
banner row shows the adjacency selector working: the bleed is simply off.

The bar measured **52px** against a declared 52px, with everything it can hold
in it.

### Six more tests

One in `@sone/core` for the third value, one mounted for the third step in the
row, and five reading the stylesheet: the declared height, the grown band, the
adjacency, the transparency, and the ground under each control.

Two existing tests changed rather than being worked around. `contentGutters`
asserted the page body's `padding` shorthand, which now has its top in a
longhand; and the height rules moved from `block-size` to a custom property,
because `calc()` cannot add the bar's height to a value it would have to
re-derive from a selector.

## Alternatives considered

**A second setting, "bis oben", beside the width.** Allows a combination that
means nothing.

**Report the cover up to `App` and put an attribute on `.main`.** A callback, a
piece of state, a stale frame after every navigation, and a choice between two
sources for the same fact. `:has()` asks the document.

**Compute the ink from the picture.** Sampling a canvas at load, per cover, to
decide four colours — and it would still be one answer for a bar that spans a
picture with two halves.

**A translucent scrim behind the whole bar.** It dims the picture precisely
where the picture was the point, and the ink is still being decided against
something unknown underneath.

**Let the banner sit on the picture.** The banner is the more important of the
two things on the screen.
