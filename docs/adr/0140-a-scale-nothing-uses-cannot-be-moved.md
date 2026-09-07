# ADR-0140: A scale nothing uses cannot be moved

## Status

Accepted. Built. Closes *„Dichte als Stufe"*, which had been outstanding since
step 3 and could not have been built where it stood.

## Context

The interface has a scale: three control heights and seven spacing steps, named
by use, written down for a reason it states about itself —

> every control picked its own height and padding, some of them by accident, and
> the result reads as unfinished even when nothing is individually wrong.

*„Dichte als Stufe"* — how tightly the interface is packed — was filed as step
3's leftover, beside the corners, as a workspace theme value.

**Neither half of that was right.**

### A third of the spacing did not go through the scale

Ninety-four `gap` and `padding` declarations were the scale's own numbers typed
out: `gap: 4px` where `--sone-space-2` is 4px, `padding: 8px 12px` where those
are steps four and five. Against 216 that used the names.

So a density that moved the scale would have tightened two hundred places and
left ninety-four exactly where they were. **An interface that is partly denser
reads as broken rather than as compact** — which is the same sentence the scale
section already wrote about itself, arriving from the other direction.

Measured before anything was decided, because the alternative was building a
setting and discovering it afterwards.

### And density is not the workspace's to choose

The answer to *whose is it* was already written, two files away, about a
different setting:

> **The scales are per browser and the scheme is not.** A text size is a
> property of the screen being read: a scale that suits a phone is wrong on a
> 27-inch monitor, and **syncing it would make one device's setting the other's
> problem.**

That is truer of density than of a text size. Density is about the screen *and
the pointer* — comfortable under a thumb, compact under a mouse — and somebody
who works on both wants two answers, not one carried between them. As a
workspace theme it would have been a workspace deciding how close together
somebody else's fingers are.

## Decisions

### The scale becomes the scale first

Ninety-four declarations, replaced mechanically, and **proved to change
nothing**: the whole stylesheet with every step resolved back to its number is
byte-identical to what it was. That is the ideal shape for a refactor of this
size — not "it looks the same", but "it is the same".

### The rule is not "no numbers". It is "wholly on the scale or wholly off it"

The failure a density cares about is not a literal, it is a **mixture**.
`padding: var(--sone-space-3) 10px` looks tidier than `6px 10px` and is worse:
under compact the first axis shrinks and the second does not, so the box changes
*proportion* rather than size. **A field that gets narrower without getting
shorter reads as a mistake; one that does not move at all reads as a decision.**

Nineteen declarations are wholly off the scale — `padding: 10px 12px`, `1px 6px`
— and stay that way. The scale's own note allows exactly that: *"anything
between these is a decision that has to justify itself."* They are what a later
density has to look at one at a time, with eyes on them, and this record does
not pretend to have done that.

### Density is a shift along the scale, not a multiplier

`calc(2px * 0.75)` is 1.5px, and half a pixel is a hairline the browser rounds
somewhere different at every zoom level. **Compact means each of the larger
spaces takes the value of the step below it** — a step by construction, and a
whole number by construction.

**The two smallest steps do not move.** 2px and 4px are a hairline and a hair's
breadth; there is no denser version of them, and a 1px gap is a gap somebody has
to be told is there.

### The tap target never moves — and compact stops where a finger is the pointer

44px is the smallest target reliably hittable with a thumb: a floor from outside
this design rather than a taste.

The stronger form of that rule was already in the codebase, written for the
collection table's own row heights:

> A tap target is a tap target: on a touch device the smallest level still has
> to be hittable, so **compact stops shrinking where a finger is the pointer.**

`@media (pointer: coarse)` relaxes compact rather than a token refusing to move,
which is better because it asks about the actual pointer. **It is also the
strongest argument for keeping this in the browser**: the browser is where the
pointer is. A phone that inherited "compact" from a desktop and honoured it is a
phone nobody can tap.

### A collection's rows join the scale

`--row-control` was `34px`, `26px` and `44px` — the three control heights typed
out — which made a table the one part of the interface a density could not
reach. They are the names now, and the two densities compound: a compact table in
a compact interface is tighter still, which is what asking for both means.

The collection's own `data-density` keeps its name. It is a different setting —
the row height of one view, chosen per collection — scoped to the table where
this one is on the root, and the record says so rather than leaving somebody to
find out.

## Consequences

**Seven tests.** One is the precondition and the rest are what a density may not
do: every density fills the same names (the lesson of the three dark themes,
ADR-0135), the steps stay ordered and whole in each, the tap target is not among
them, compact is relaxed on a coarse pointer, and no row height is a number.

**The default renders identically.** Proved, not asserted.

**Not done, and named:** the nineteen off-scale distances, and whether compact's
numbers are the right numbers. The second is taste, and taste needs eyes on it —
this record can say a density is *correct* (ordered, whole, hittable) and cannot
say it is *right*.

## Alternatives considered

**A multiplier on the scale.** One line instead of six, and half-pixel gaps at
every zoom level. CSS has `round()` now; relying on it to make a scale whole is
relying on a browser to define the design.

**Density as a workspace theme, where it was filed.** A workspace deciding how
close together somebody else's fingers are.

**Density on the account, with the colour scheme.** Closer, and still wrong for
the reason `useAppearance` gives about the text scales: it would carry a desktop
answer to a phone. The scheme is a property of the person; density is a property
of the screen in front of them.

**Replace all 123 literals that happen to equal a scale value.** `inline-size:
2px` on a drop indicator is a hairline that happens to be two pixels, not the
first step of the scale, and a test forbidding it would forbid a line for ever.
`gap` and `padding` are distances by definition, which is what makes the rule
checkable rather than a matter of taste.

**Move the nineteen odd values onto the scale.** Twenty-five nudges of one or
two pixels each, none of which anybody looked at. The scale's own note says an
in-between value is a decision that has to justify itself — not one that has to
be abolished.
