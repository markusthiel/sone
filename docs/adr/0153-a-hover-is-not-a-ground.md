# ADR-0153: A hover is not a ground

## Status

Accepted. Built. A correction to ADR-0149.

## Context

Reported, with a green rail and both marks uploaded:

> *„Wenn ich auf das Logo drauf klicke wird es dunkel. Auf allen anderen Buttons
> scheint es zu klappen dass es das helle bleibt."*

ADR-0149 chooses between an instance's two marks by **measuring** the surface the
mark is drawn on, because no theme flag can answer it: a workspace may paint the
rail with its accent (ADR-0122), so a light instance can have the darkest surface
on the screen there.

The mark sits inside the rail's brand link. That link paints `--surface-hover`
while the pointer is on it, and on an accent-treated rail that surface is
`color-mix(in srgb, var(--accent-contrast) 14%, var(--accent))` — the rail's own
green with a seventh of white in it.

Measured in Chromium against the running application:

| | colour | luminance |
|---|---|---|
| the rail | `rgb(47, 125, 111)` | 0.164 |
| the rail's hover surface | `rgb(76, 143, 131)` | 0.229 |
| mid-grey, `groundTone`'s threshold | `#808080` | 0.216 |

**Thirteen thousandths over the line.** Pointing at the mark made the ground
"light", which chose the mark inked for white paper — nearly invisible on that
green. And it stayed: nothing re-measures when a pointer leaves, because a
`:hover` change is neither a React render nor a DOM mutation.

"Auf allen anderen Buttons" is the same paint on the same rail; only the brand
carries a picture that asks about it.

## Decisions

### A control the pointer is on is stepped over

The rule is not about the arithmetic above. **A control's hover is a state of the
control, not the surface the mark is drawn on.** Which picture belongs on a rail
is a fact about the rail; a picture that changes as the pointer arrives is wrong
even in the cases where both pictures would be legible.

So the walk up from the mark skips an ancestor that is a control *and* is
currently `:hover` or `:active`, and measures what that control sits on.

Asked of the element rather than tracked with listeners: the browser already
knows where the pointer is, and a second copy of that kept in React is a copy
that can disagree.

### Both halves — and the second is the one I got wrong first

The first version skipped anything matching `:hover`. That is not a narrower
rule, it is a much wider one: **`:hover` matches every ancestor of the element
under the pointer.** So it walked past the link, past the rail, past the shell
and answered with the page's own white — the same bug, arrived at from the other
side. It went green in Chromium and the jsdom test passed, because the test only
stubbed the link.

The test now stubs the rail and the image as well, which is what the browser
actually presents, and it fails against the wider rule.

The controls are a written-out selector list rather than a guess at what looks
interactive: `a, button, summary, [role="button"], [role="link"]`. An element is
a control because it is one of those, not because it happens to have a handler.

### Not `:focus-visible`

Focus draws an outline in this design and never a background, so it cannot move
the measurement. Including it would add a second surprise — a mark changing as
somebody tabs past — while removing the first.

## Consequences

Verified in Chromium against the built application with a green
(`accent`-treated) rail and two marks: at rest, hovering, clicking, and after the
pointer has left, the mark stays the one drawn for dark grounds. On an untreated
light rail nothing changed — the mark for light grounds throughout.

One new test, and it is a *mounted* one for ADR-0149's reason: a source test here
would assert that a function is called, and a function that is called is not a
picture on a screen.

### The threshold is a knife edge, and that is left alone

`groundTone` calls a surface light above mid-grey's luminance, and an accent
rail's hover surface sits 0.013 above it while the rail itself sits 0.052 below.
A person looking at `rgb(76, 143, 131)` would call it a dark green and expect
white ink on it — which is what the rail does, since its ink is
`--accent-contrast`.

So there is a real tension between what `groundTone` answers and what the accent
treatment assumes, and the mark was the only thing asking the question often
enough to expose it. **Moving the threshold is not this round's business**:
`readableInk` derives every treated surface's ink from the same call, so a
different threshold is a different colour on several surfaces at once. Named
here so the next person meets it as a known thing rather than a surprise.

## Alternatives considered

**Composite the hover surface with what is under it.** It is not translucent —
`color-mix` computes an opaque colour — so there is nothing to composite.

**Stop painting a hover surface under the mark.** That removes the affordance
from the one control in the rail that most looks like a button.

**Re-measure when the pointer leaves.** Treats the symptom: the mark would still
flip while being pointed at, and would flip back afterwards — a picture that
blinks under the cursor.

**Move `groundTone`'s threshold.** Fixes this case and changes derived ink on
every treated surface. See above.

**Let the caller name its ground.** Then the rail says "I am dark" and the
measurement is gone, which is exactly what ADR-0149 refused: a workspace's accent
is a colour only the browser can resolve.
