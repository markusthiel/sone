# ADR-0074: The bar is the rail

## Status

Accepted. Stage four of ADR-0069, first half. Amends its sketch of what the bar
holds.

## Context

Above 800px the rail carries the modes and the account. Below it the rail is not
drawn, and until now its contents sat at the foot of the panel — which is to say
inside the drawer, behind a toggle. Everything a phone can reach was one tap
further away than everything a desktop can reach, and the reach itself is the
wrong one: the foot of a drawer is at the top of nobody's thumb.

ADR-0069 named the replacement as "Seiten · Suchen · Posteingang · Du". Writing
it made the problem with that set obvious. It is not the rail's set. Workspaces
and the trash would exist on a phone and be unreachable from it, which is the
same fault ADR-0072 had just repaired from the other direction — and searching
is not a place you are, it is something you do, with a labelled row of its own
above the tree at both widths.

## Decision

**The bar is the rail, laid on its side.** The same modes in the same order from
the same list (`useModes`), and the account at the end, apart, because it is not
a mode. Five items across a phone is the shape every phone already has, and each
one is labelled: five icons with no words is a puzzle, and an unlabelled face
among four labelled icons reads as an accident. The face is given a word — "Du"
— because a name in a fifth of a phone's width is an ellipsis.

**The stylesheet decides which of the two is drawn.** The bar is `display: none`
above 800px and the rail is absent below it, both by media query. A `matchMedia`
call in the components would be a second copy of the breakpoint, and two copies
disagree on the pixel where it matters.

**It gives back the space it takes.** One measurement, `--sone-bar`, and three
rules read it: the reading column's bottom padding, the drawer's bottom inset,
and the account menu that opens upwards from it. Content that ends underneath a
bar is content somebody cannot finish reading; a drawer running under it hides
its last row behind five icons. The home indicator's strip is padding *inside*
the bar rather than a taller bar, so the row of icons keeps its own height and
the surface still runs to the bottom of the screen.

**It gets out of the way of a keyboard**, and the keyboard is *measured* rather
than inferred from focus. `visualViewport` is what the browser shrinks when a
keyboard opens, so the question "is something covering the bottom of the screen"
has a direct answer. Inferring from focus gets the ordinary case right and then
hides the bar for somebody typing on a hardware keyboard, where nothing is
covering anything.

The threshold is a ratio — the viewport keeping less than three quarters of the
window — rather than a number of pixels, because both the screen and the
keyboard scale with the device. An address bar appearing and disappearing takes
about eighty pixels on a phone and must not count, or the bar would flicker away
while somebody scrolls. Hidden rather than unmounted, and `inert` while hidden:
nothing inside is rebuilt when the keyboard closes, and nothing reachable by tab
is invisible. A browser with no `visualViewport` keeps its bar, because a bar
that is always there is a smaller fault than one that vanishes for reasons
nobody can see.

## Consequences

The panel's foot is gone, and with it three props that were being threaded
through the sidebar to feed a component it no longer draws. `Sidebar` is the
panel and nothing else now: a head, a body, and a draggable edge.

`AccountMenu` gained an optional `label`. It is the only concession the bar
asked of anything outside itself, and it is a word rather than a layout.

The inbox's line of keyboard shortcuts is hidden below the breakpoint. Two lines
explaining j/k/e/u is two lines of the list gone, on the screen with the least
room for them and no keyboard to press them on.

Still to come from stage four, and both need endpoints rather than layout:
snoozing a notification to a time, and answering one without leaving the inbox.
