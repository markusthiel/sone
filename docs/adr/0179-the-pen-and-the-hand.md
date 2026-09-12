# ADR-0179: The pen and the hand

## Status

Accepted. Built. **Not measured on a tablet** — see Consequences.

## Context

> Könnte man bei den whiteboards am iPad mit Stift auch eine Handballenerkennung
> einbauen, damit man mit dem Stift besser arbeiten kann oder geht das im web
> nicht?

It goes in the web, and it turns out not to be recognition at all. Pointer
Events already say **what** touched: an Apple Pencil arrives as
`pointerType: 'pen'`, a finger and a palm both as `'touch'` and
indistinguishable from one another.

So there is nothing to recognise and one rule to state. And the browser gives
nothing more: the rejection at the digitizer that PencilKit gets is not on offer,
so asking about contact size would be a guess where `pointerType` is an answer.

`CanvasSurface.tsx` consulted `pointerType` **nowhere**. A resting hand was a
stroke, an eraser and a selection like any other contact.

## Decisions

### Once a pen has been seen here, only the pen works the tools

A palm is a touch, so a palm moves the view by nothing and draws nothing.

**The rule waits for a pen.** Making touch pan-only everywhere takes drawing away
from every tablet without a pencil and every phone; it earns its way in by a pen
actually appearing, and then stays. Remembered in the browser across reloads,
because the first stroke after one is the one that goes wrong.

That memory is a fact about *this device*, not about a person or a board — which
is why signing out does not clear it (ADR-0178). The next person at the same iPad
has the same pencil.

### Two contacts are never a tool

Pinch and two-finger pan are what a tablet expects of any canvas, pen or no pen,
and a board that cannot be zoomed with two fingers is one somebody stops using on
a tablet. The pinch is anchored on the midpoint, so the board grows around what
is between the fingers rather than around a corner — the difference between a
zoom somebody can aim and one they have to chase with a pan afterwards.

### A cancelled pointer throws its stroke away

`onPointerCancel` ran the same handler as `onPointerUp`, and that handler
**commits** the stroke. So a contact the system reclaimed mid-gesture wrote a
line.

That is the palm arriving by a second door, and it predates everything else here.
A cancel is the strongest rejection signal a browser gives, and it was being read
as a signature.

### Every point the browser had, not only the one it woke us for

A pen reports faster than a frame and `getCoalescedEvents()` is where the points
in between are kept; without them a quick stroke is a polygon with a corner per
frame, which is precisely what makes handwriting feel wrong.

Guarded with `typeof … === 'function'`, because **iOS Safari has only had it
since 18.2** — an older iPad degrades to one point per frame, which is what it
does today.

## Consequences

**Nine tests**, all against two exported functions taking a contact as an
argument, so every rule is statable without a browser or a tablet.

### What I got wrong before writing any of it

I told Markus the board had no `touch-action`. It has had `touch-action: none`
all along; my grep piped `-A` context into a second `grep` and matched nothing,
and I read that as an absence. **A search that finds nothing is not a
measurement.** What was actually missing beside it was `user-select` and
`-webkit-touch-callout` — a long press on a board is somebody thinking, and
iPadOS was raising a callout menu over the drawing.

### Not measured where it matters

Everything here is measured in Chromium or reasoned from the specification. The
project has carried *touch never measured on a real device* as an open item for
weeks, and this round does not close it — it adds to what wants measuring.

Specifically unverified on an iPad: that a resting palm arrives as `touch` rather
than being swallowed before the page sees it; that a pen contact keeps its
`pointerId` through a stroke; that the pinch feels like the system's; and whether
Safari cancels contacts often enough that discarding on cancel loses strokes
somebody meant.

### Left out on purpose

**Pressure and tilt on the line width.** It is the part that makes a pen feel
like a pen, and it needs a width *per point* — the canvas item carries one
`width` and a flat array of coordinates, so it is a schema change and a renderer
change rather than a reading of an event. A round of its own.

## Alternatives considered

**Guess a palm from the contact's size.** `width`/`height` on a touch pointer are
coarse and lie on several platforms, and it would answer a question
`pointerType` answers exactly.

**Pen-only always.** One rule instead of two, and no drawing at all on a tablet
without a pencil.

**A switch in the toolbar rather than a rule.** Somebody who has just drawn a
line with their hand does not want to find a setting; they want the line gone.
The switch is still worth having as an override, and is not here because nobody
has yet hit the case that needs it.

**Ask the pen's own palm rejection by using PencilKit.** Not available to a web
page, which is the whole question this started from.
