# ADR-0134: What is drawn over what

## Status

Accepted. Built. Fixes a bug reported twice.

## Context

> Die Anfasser und das + liegen leider **immer noch** über dem Menü, wenn die
> Seitenleiste ausgeklappt wird. […] wenn ein Anfasser sichtbar ist und ich die
> Leiste ausklappe liegt es darüber.

The block gutter — the `+` and the grip that sit beside a paragraph — was drawn
on top of the sidebar drawer, and on top of the dimming behind it. Open the
sidebar on a narrow screen and two editor controls float over the folder list,
bright, over a page that is otherwise dimmed.

Reproduced before anything was changed, in a real browser with the real
stylesheet rather than by reading it: `elementsFromPoint` at the gutter's centre
returned `['block-gutter', 'sidebar open', 'scrim', …]`. The gutter was first.

Three numbers, each chosen sensibly, on its own:

```css
.block-gutter { z-index: 30; }   /* above the block it annotates */
.sidebar      { z-index: 20; }   /* above the page, as a drawer */
.scrim        { z-index: 10; }   /* above the page, under the drawer */
```

**Nothing anywhere said which of the two is the page and which is the thing
covering it.** That sentence is the whole bug. `30` won against the paragraph it
was picked to win against, and it went on winning against everything else.

## Decisions

### The gutter is page, not chrome

`z-index: 6`. Above every layer drawn inside the reading column — the drawing
plane's marks, its ink, its handles, a collection's frozen title column, all of
which stop at 5 — and below the dimming at 10.

It still has to win against what it sits on: beside a paragraph the gutter is
over empty margin, and over a full-width photograph it is over the photograph,
which is why it carries its own chip. That half was never in question and is now
asserted rather than assumed.

**Fixing the drawer by putting the gutter under the page would have traded a
reported bug for an unreported one.** The requirement is a range, not a
direction.

### The order is a test, not a comment

A stylesheet has nowhere to write "this element is the page and that one covers
it". So the order lives in `packages/web/test/layers.test.ts`, as **pairs**:
what is underneath, what is on top, and the reason it has to hold.

```
.block-gutter → .scrim    the gutter belongs to the page, and the scrim is what
                          dims the page — a control that stays bright over a
                          dimmed page looks pressable and is not
.scrim        → .sidebar  the dimming is for the drawer, so the drawer stands in
                          front of it
.app-error    → .drag-preview  what is being dragged follows the pointer over
                          everything, or it disappears behind whatever it is
                          being dragged towards
```

**It reads the numbers out of the stylesheet rather than restating them.** That
is the distinction ADR-0131 was written about: a test that says
`z-index: 6` is a second copy of the line it is checking, and it passes for as
long as nobody changes that line and no longer. A pair says what the line is
*for*, and it fails when either side moves.

Eleven of the thirteen pairs passed the moment they were written. That is the
useful thing about writing them: the model was already right everywhere except
one selector, so the model is not something invented to describe the fix.

### And the general form of it

One test takes the scrim as the boundary — everything drawn inside the reading
area is below it, everything covering the reading area is above it — and checks
every in-page selector against it. The next control that picks a number while
looking at one problem is caught by that rather than by somebody's screenshot.

`.sidebar` is read at its **highest** value, because it is a grid column above
800px and a fixed drawer below it, and what matters is the largest level it can
reach.

## Consequences

**Thirteen pairs, and the boundary rule.** Four of them failed before the change
and all four named `.block-gutter`.

**One dead rule removed.** There were two `@media (hover: none)` blocks for the
gutter's controls, `opacity: 1` and then `opacity: 0.7`. Later wins, so the
first had never applied to anything, and the comment above it described a value
no phone has ever rendered. One block now, holding the value it has actually
had.

**Not done:** the other thirty-odd `z-index` declarations keep their numbers.
Naming them all as steps is the change this file's reasoning points at, and it
is a change to make with a browser in the loop rather than beside a bug fix —
the pairs are what make it safe to attempt later.

## Alternatives considered

**Hide the gutter while a drawer is open.** It would work, and it answers a
narrower question: the gutter is only one of the things at that level. The
ordering is the fact that was missing.

**Put the gutter below everything in the page.** Then it loses to the
full-width image it sits on, which is the bug it was given `30` to fix.

**Name every layer as a custom property now.** The right end state, and a
thirty-eight-line rewrite of stacking in a round about one control. The pairs
are the part that makes that rewrite checkable, so they come first.

**Assert the number.** `assert.match(css, /z-index: 6/)` passes until somebody
edits the line it copies, and says nothing about why 6.
