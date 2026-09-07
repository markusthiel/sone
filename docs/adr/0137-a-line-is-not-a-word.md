# ADR-0137: A line is not a word

## Status

Accepted. Built. The item ADR-0136 left open, and the smaller-sounding of the
two halves turned out to be the one with a consequence that is not cosmetic.

## Context

ADR-0136 split the accent in two — `--accent` fills, `--accent-text` is read —
and closed by naming what it had not covered:

> A *line* in the accent — a border, a rule, a focus ring — is a non-text
> graphical element and wants 3:1, which nothing checks. A smaller hole, and a
> different floor.

Smaller in the sense that fewer pixels are involved. Not smaller in effect:

**A focus ring in a pale accent is 1.07:1 on the page.** The ring is drawn, and
nobody can see it. That is not a colour looking slightly off — it is a keyboard
user who cannot tell where they are, on an instance whose workspace happened to
pick yellow out of the colour input.

And the stylesheet had already made the claim, twenty lines above the ring:

> Fields are the exception above, and only because they **replace it with
> something at least as visible.**

At least as visible as what, measured how. Nothing checked it. Two files later
the same sentence appears again, in a test named *"everything else keeps a
visible focus ring"* that asserts the ring is two pixels wide.

## Decisions

### The floor is a parameter, because a line has a different one

4.5:1 is what the standard asks of text. **3:1 is what it asks of a control's
boundary** — a focus ring, the border of a focused field, the rule beside a
selected item. `readableInk` takes the floor now, and a workspace emits the
accent derived twice more, at 3:1, once per scheme.

Two reasons this is not simply the text derivation reused.

**It would be darker than it needs to be**, so a border drawn beside a fill of
the same accent would no longer match it — a ring around every primary button.
That is not hypothetical: it is exactly the mistake ADR-0136 made and reverted,
arriving from the other direction.

**And the lower floor moves the colour less**, so a line stays nearer the one
the workspace chose. Which is the whole point of letting them choose.

### A border that outlines an accent fill is not a line

Three places draw a border in the accent *around something already filled with
it*: the primary button in both its spellings, and a checked task marker. Those
keep `--accent`, because what they have to match is the fill, not the surface.

Nineteen others stand on a surface — the focus ring, a focused field's border,
the canvas selection, a comment thread waiting for its first message, the rule
beside a changed block — and those became `--accent-line`.

**Classified by hand, one at a time.** ADR-0136's own consequences record why: a
pattern that matched `color: var(--accent)` also matched
`border-color: var(--accent)`, and fifteen sites had to be moved back. A rule
that separates "a line on a surface" from "a border around a fill" cannot be
written as a regular expression, because the difference is what is *underneath*
the line.

### The design's own line needed nothing

`--accent-500` is 3.12:1 against the darkest surface any tint can produce, and
`--accent-300` is 5.35:1 against the lightest dark one. Both clear the floor, so
`--accent-line` falls back to the accent itself rather than to a fourth step.

Worth stating rather than assuming: **the design's line was always visible and
the workspace's was not**, which is a different shape from ADR-0136, where the
design's own value was under the floor too. The fix belongs where the failure
is.

## Consequences

**The accent is now one chosen colour and four derivations** — two floors, two
schemes — and the stylesheet declares which is which per scheme. That is the
most a value can be asked to be before it should be several values, and it is
worth watching: a fifth derivation would be the sign that "the accent" has
stopped being one idea.

**Eleven web tests and four core tests**, including the cube walk for a line at
3:1 against every surface every tint can produce, and one asserting the line
derivation moves *less* than the text one — because if it did not, there would
be no reason for two of them.

**Two comments became arithmetic.** *"Something at least as visible"* and
*"everything else keeps a visible focus ring"* were both claims a file made
about itself. They are computed now, over every colour a workspace can choose,
and what is left in those files is the part they can actually check: that the
ring exists at all.

## Alternatives considered

**Use `--accent-text` for lines too.** One fewer derivation, and every border in
the accent becomes visibly darker than the fill beside it. The ring around the
primary button, again.

**Take the accent out of the focus ring and give focus a fixed colour.** It
would work, and it is what several design systems do — a focus indicator's job
is to be seen, and tying it to a brand colour makes its visibility depend on
taste. Rejected because the derivation gets both: the ring keeps the workspace's
identity *and* is guaranteed visible, and a fixed colour would be one more thing
the per-workspace colour deliberately does not reach.

**Refuse an accent that cannot be a visible line.** Then a workspace's brand
colour is rejected because of a two-pixel ring, and the fill it was chosen for —
which was always fine — is rejected with it.

**Check it in the browser instead.** A focus ring's contrast is arithmetic on
two colours, and the colours are computed from a value a workspace picks. There
is nothing to look at that the arithmetic does not already say, and a screenshot
covers the colours somebody thought to screenshot.
