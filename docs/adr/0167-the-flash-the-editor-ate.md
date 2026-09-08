# ADR-0167: The flash the editor ate

## Status

Accepted. Built. Fixes half of what ADR-0166 shipped.

## Context

Reported the day 0.12.5 was released, as an aside:

> Übrigens leuchtet der Eintrag nicht auf wenn ich ihn in der Seitenleiste
> anklicke, aber er springt jetzt an die richtige stelle und scrollt korrekt.

Exactly the half the tests could not see.

## Decisions

### ProseMirror owns that element

`showAsFound` wrote `data-found` onto the block's own DOM element. Measured
against a real mounted editor:

```
right after set  : ""
after a tick     : null
```

The editor's DOM observer sees an attribute it did not put there, treats it as a
change to reconcile, and puts the element back the way the document says. One
tick — far too short for anybody to see, which is precisely the report.

The caveat was in the file: *"a node re-render while the flash is on takes the
attribute with it. That needs a keystroke inside that block during the second
and a half after pressing something in a panel."* It needs no keystroke at all.
**A hazard I wrote down as unlikely was the ordinary case.**

### A decoration, because that is the one thing the editor keeps

`foundBlock()` holds an id in plugin state and draws
`Decoration.node(…, { 'data-found': '' })` on the block that carries it.
ProseMirror draws it, so ProseMirror keeps it — and maps it through every
transaction, so it survives somebody typing elsewhere while it is lit.

**An id, not a position.** The panel that asks knows a block id and nothing
else; a position would have to be resolved at the moment of asking and mapped
afterwards, while an id survives an edit that moves the block. The cost is a
scan of the top level per redraw *while something is lit* — a second and a half
at a time, and nothing the rest of the time.

**A transaction, not a call into the DOM.** It goes through the one path
everything else here goes through, so a concurrent redraw cannot find an element
with an attribute nobody can account for.

### The web side announces, and keeps the timer

`showAsFound(blockId)` dispatches `sone:found-block`, and dispatches it again
with `null` after `FOUND_MS`. `EditorSurface` listens and hands the id to the
plugin — the same arrangement as `sone:reveal-comment` and `sone:pdf-comment`,
for the same reason: only the editor can turn an id into something drawn.

The timer stays on the web side so *how long* sits beside the other duration
that file owns. The plugin draws what it is told and holds no policy about time.

Nothing in the stylesheet changed: the decoration sets the attribute the rules
from ADR-0166 already draw, ring and all.

## Consequences

### The test that agreed with itself

ADR-0166's test set `data-found` on a plain jsdom `<p>` and read it back. There
was no editor in that fixture, so there was nothing to reconcile it away — the
assertion was about a world the application does not have.

This is the same shape as PR #103's lesson, written down in this repository
three days ago: **a fixture that does not reproduce the caller's world agrees
only with itself.** There it was the order of a subscription; here it is the
presence of the thing that owns the DOM.

The new tests mount a real editor, and the assertion that matters is the second
one in each:

```
showFoundBlock(view, ID);
assert.deepEqual(page.foundIds(), [ID], 'lit');
await tick();
assert.deepEqual(page.foundIds(), [ID], 'and it survived the reconciliation');
```

Writing the attribute directly passes the first line and fails the second.

**Five mounted tests** in the editor package — lit and still lit, surviving a
keystroke in another block, put out by `null`, one at a time, and an id no block
carries lighting nothing. **Two rewritten** on the web side, which now assert the
announcement rather than an attribute, and one more holding that this side no
longer touches `dataset` at all.

### And a second class with one name

The rewritten web test dispatched Node's own `CustomEvent` at a jsdom window,
which refuses it: *"parameter 1 is not of type 'Event'"*. The fixture's globals
list had `window` and `document` but not `CustomEvent`, so the two halves of one
test were using two different `Event` hierarchies.

## Alternatives considered

**An overlay drawn over the block's rectangle**, the way the PDF marks work.
It needs a position, a resize observer and a scroll listener to stay put — all
of which the editor already does for its own decorations.

**A window event the editor package listens for directly.** The plugin would
then have to be told when to stop, and this repository's arrangement is that the
web side owns the listener and the editor owns the drawing (`sone:reveal-comment`
does exactly this).

**Give up and keep the scroll only.** The flash is the half that works where the
scroll cannot reach the top, which is the end of every document.
