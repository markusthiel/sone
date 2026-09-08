# ADR-0156: The panel takes you there

## Status

Accepted. Built. Closes the dead control ADR-0159 named on its way past.

## Context

The comments panel has been able to show you a passage since ADR-0046: pressing
a thread's quotation dispatches `sone:reveal-comment`, the editor resolves the
anchor into its own coordinates and scrolls there. Resolving is the editor's
job, so revealing is a message rather than a scroll from the page.

A place in a PDF had no such message. The page dispatched only for a thread with
a **range**, so every comment about page seven of a document listed a quotation
and, when pressed, did nothing at all. ADR-0159 disabled the button where the
document had gone from the page and wrote down what it was leaving behind: for
every other place thread the button was still dead.

## Decisions

### The same arrangement, a different reader

Only the viewer knows where page seven currently is. The column has its own
scroll, the pages are drawn as they come near (ADR-0048), and neither fact
belongs in the page component. So `sone:reveal-place` carries the file, the page
and the thread, and the viewer answers it.

**The file travels with it** because a page may hold two documents, and a message
with only a page number would be answered by both.

### Two scrolls, because the viewer is a column inside a page

`goTo` moves the right page to the top of the column. The column itself may be
entirely below the fold — measured: 1416px below the window's top, with nothing
of it visible.

So the block is brought into view as well. `scrollIntoView` here and deliberately
**not** in `goTo`: ADR-0048 refused it for paging because it moves every
ancestor, and paging a PDF should not move the page around it. Moving every
ancestor is exactly what somebody who pressed *show me this* has asked for.

### The wanted thread is remembered, not acted on once

The page being revealed is usually **not drawn yet** at the moment of the ask —
that is what the scroll is for. So the viewer keeps which thread was wanted, and
`drawMarks` marks it found when its turn comes. Measured: page three had no marks
at all before the reveal and its mark came up already found.

It stops being found after 1.6 seconds. A mark that stayed lit would make the
*next* reveal look like nothing happened.

### What "found" looks like: the ring carries it, the pulse is decoration

This stylesheet has a rule about motion, and it states its own test:

> Off, not shortened, for somebody who asked for less motion. **None of this
> carries information** — which is the test of whether motion is decoration.

This carries information. Which of a page's marks is the one you asked for is the
whole message. So the fill goes to 34% and a ring is drawn, and both simply
*hold* for as long as the viewer keeps the attribute; a short pulse sits on top,
and only the pulse is removed under `prefers-reduced-motion`. Turning the whole
thing off would answer "show me this" with nothing at all.

### And the ring is `--accent-line`, which a test insisted on

The first version drew it in `var(--accent)` and `contrast.test.ts` went red:
this stylesheet derives a line's colour for the ground it is drawn on, and a ring
in the raw brand colour is a ring a pale brand makes invisible. The rule was
already written down and already checked; I had simply not applied it.

### A mark now says which thread it belongs to

`data-thread` on every comment mark. The reveal needs it, and so will the round
that answers a **click** on a mark — the other half of this connection, which is
still open because the marks take no pointer events by design (ADR-0152).

## Consequences

**Seven tests**, read rather than run, for ADR-0150's reason: the viewer needs a
worker, a canvas and a real layout, and jsdom has none of the three.

### Measured in Chromium, against a three-page probe

The viewer placed 1416px down the page, the panel asking for page three:

| | before | after |
|---|---|---|
| window scroll | 0 | 1333 |
| viewer's top edge | 1416 | 83 |
| column scroll | 0 | 1793 |
| indicator | Seite 1 von 3 | Seite 3 von 3 |
| marks drawn | 0 | 1, `data-thread="t-page3"` |
| its ring | — | `rgb(47, 125, 111)` 2px |
| its fill | — | `color(srgb … / 0.34)` against 0.16 for an ordinary one |

Two seconds later the found state is gone and the mark remains. A message naming
another file moves nothing.

The row that matters most is **marks drawn: 0 → 1**. The mark did not exist when
the ask arrived; the scroll caused the page to draw, and it came up found. That
is the "remembered rather than acted on once" decision, proven rather than
asserted.

## Alternatives considered

**Scroll from the page component.** It would have to know the column's scroll,
which page is drawn, and how the slots are laid out — three facts that belong to
the viewer and change with it.

**Flash by finding the mark afterwards.** There is nothing to find: the page is
not drawn yet, which is the whole reason a scroll was needed.

**Leave the flash out and just scroll.** On a page with several marks, arriving
at "one of these" is a worse answer than arriving at the one you asked for.

**Keep the mark lit until something else happens.** Then the second reveal is
indistinguishable from a broken button.

**Use `scrollIntoView` in `goTo` as well.** ADR-0048's objection stands: paging
with the arrows should move the document, not the page around it.
