# ADR-0136: An accent has two jobs

## Status

Accepted. Built. The item ADR-0135 left open, and it turned out to have three
live bugs under it rather than one.

## Context

ADR-0135 made contrast arithmetic and held it as a test, and named what it had
not covered:

> **Still open, and it is the next round:** *the accent as text.* Links are
> `color: var(--sone-accent)`, and a workspace accent is a free colour with no
> computed partner in that role — `readableOn` protects text drawn *on* the
> accent, not the accent drawn *as* text.

The design already knew. It gives itself **two** accents — `--accent-500` in the
light theme and `--accent-300` in the dark — with the reason written beside them:

> the accent is a lighter step, because the one that works on white glows on
> black.

A workspace that set an accent got one value, used in both.

## Decisions

### `--accent` fills. `--accent-text` is read.

Two names, because they are two questions. `readableOn` computes what goes **on**
the accent (ADR-0023, corrected in ADR-0135). Nothing computed the accent **as**
a colour to read, and thirty-one rules in the stylesheet drew text in it.

The fill stays exactly the colour somebody chose. A workspace whose brand colour
quietly became a darker one on its own buttons would be a workspace whose brand
colour is not its brand colour — and a border beside an accent fill keeps the
fill's colour too, or the pair shows as a ring.

### Two derivations, because a stored value cannot know its reader

`readableInk(colour, ground)` moves a colour only as far as it must be to reach
4.5:1 on that ground, and a workspace emits it twice — once for a light ground,
once for a dark one. The stylesheet declares which of the two `--accent-text`
means, once per scheme.

**This is ADR-0122's argument about `inverted`, applied to the accent.** One
stored value, two declared meanings, resolved by the scheme the reader is in. A
single derived value would be the stored `#161615` that ADR-0122 refused: right
for one reader and wrong for the other.

**The direction belongs to the ground, not to the colour.** On a light ground
the only way to gain contrast is down; on a dark ground it is up. Down is a
scale of the channels, which keeps the hue exactly. Up is a mix toward white,
which washes the hue a little and is the operation that always terminates —
scaling up cannot move a colour whose channel is already at 255.

**Only as far as it must be.** Not to black, and not by a fixed amount: a fixed
darkening is too little for yellow and far too much for a colour that was nearly
there, and either way it is a number nobody can defend. A colour that already
reads is returned untouched, which is the ordinary case.

### The ground is a bound, held against the stylesheet

`readableInk` needs a ground, and `@sone/core` cannot see the stylesheet. So it
holds `WORST_GROUND` — one colour per scheme, deliberately a shade past the real
worst — and `web`'s contrast test walks the real surfaces over the whole colour
cube and asserts none is worse.

A ground darker than every real light surface makes the derived colour darker
than it needs to be, which is the harmless direction. The same arrangement
ADR-0135 used, for the same reason: **a bound checked against the real thing,
not a copy of it.**

## Three bugs it found

### The design's own accent was under AA as text

`--accent-500` is **4.23:1 on a hovered row** and 4.50:1 on a sunken surface.
Every link on a hovered row of every untinted light instance, since links were
first drawn in it.

`--accent-600` existed already and was used for nothing. 6.33:1 on the hovered
row, and 4.67:1 against the darkest surface any tint can produce. The dark theme
needs no equivalent — `--accent-300` is 7.1:1 as text — which is worth saying:
**the split is needed where it is needed, not symmetrically.**

### Rounding after the search undid the search

The channels are floats and the answer is eight bits, so a binary search on the
floats finds the exact crossing and `toHex` rounds *back across it*. `#2f7d6f`
came out at 4.47:1, under the floor the search had just cleared; three of eight
sample colours landed under.

The search judges the rounded value now. Caught by walking the cube immediately
after writing the function, which is the point of having written the cube walk.

### Every accent stored as a *name* got white text on it

`readableOn` was being handed `var(--sone-palette-yellow)`. Its luminance parses
as `NaN`, `NaN > 0.179` is false, so the answer was white — for every named
accent, including yellow, at **3.0:1**.

Silent, because a wrong answer and no answer looked the same. It surfaced only
because this round made the parser refuse a non-colour instead of defaulting one
(ADR-0135's *"a silent black would turn 'this value is unreadable' into 'this
value has excellent contrast'"*), and the refusal turned a quiet wrong answer
into a loud one.

**A name is resolved to a colour before anything is measured** — the workspace's
own override first, because a workspace that redefined `blue` means its blue.
That needed the eight defaults where the measuring happens, so `PALETTE_DEFAULTS`
moved from the settings form into `@sone/core`. **Two lists became one**, and the
stylesheet's copy — which has to exist, it is what the browser resolves — is
still compared against it by the test that already did that.

## Consequences

**Six web tests and seven core tests**, including the cube walk for every accent
a workspace can pick against every surface every tint can produce — two free
values at once, which is exactly why the answer has to be computed.

**Thirty-one call sites moved from `--accent` to `--accent-text`**, and fifteen
of them moved back: a first pass matched `border-color: var(--accent)` as a
substring of `color: var(--accent)`. Caught by reading the diff for what the
property actually was rather than what the pattern matched.

**Still open:** a *line* in the accent — a border, a rule, a focus ring — is a
non-text graphical element and wants 3:1, which nothing checks. It is a smaller
hole than this one was, and it is a different floor.

## Alternatives considered

**Derive one accent for both schemes.** There is no such colour: a value 4.5:1
against a near-white ground and 4.5:1 against a near-black one exists only in a
narrow mid band, so this would be rejecting most of the colour input.

**`color-mix` the accent toward the text colour in CSS, by a fixed percentage.**
It looks like it works. It is too little for yellow, too much for a colour that
was nearly there, and the percentage is a number chosen by eye — which is the
thing ADR-0135 was written about.

**Reject an accent that does not read.** Then a workspace's brand colour is
refused because of where a link happens to sit, and the fill — which was always
fine, because `readableOn` computes its partner — is refused with it.

**Leave the design's own `--accent-500` and only derive for workspaces.** It
would have left 4.23:1 in place on every default instance, which is the larger
population.
