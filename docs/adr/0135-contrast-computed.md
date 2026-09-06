# ADR-0135: Contrast, computed

## Status

Accepted. Built. Closes the item ADR-0023 opened and never held.

## Context

ADR-0023 wrote the rule:

> **Contrast.** Computed, not believed, and kept as a test.

Believed is what it was. The evidence is a comment in the stylesheet, beside the
step it justifies:

> Secondary text in the light theme used `--ink-400`, which is 3.6:1 on white
> and 3.3:1 on the sunken surface — under AA, on every quiet label in the
> interface. The same value is fine in dark (5.1:1 on `--ink-900`) […]

Somebody worked those out by hand, once, wrote them down, chose a value from
them and moved on. Nothing recomputed them. And the last sentence is the whole
problem in one line: **it measured one pairing and generalised to a theme.**

A theme is not a value, it is a *space*. A workspace picks a tint out of a
colour input and every surface in the interface becomes that tint mixed into the
ramp, so "does quiet text clear AA" has as many answers as there are colours.
Checking the eight palette colours would have been checking the eight cases
somebody thought of.

So: walk the cube. Both themes, every text token against every surface token,
every seventeenth value of every channel, plus the corners by name because the
worst case in a colour cube is always a corner. Read the stylesheet's own values
out of it and resolve them — `var()`, the ramp, and `color-mix(in srgb, …)`
exactly as a browser resolves them.

**It found four things, and three of them were live.**

## Decisions

### The arithmetic is one module, and it knows two colour spaces apart

`@sone/core`'s `contrast.ts`: `luminance`, `contrastRatio`, `mixSrgb`, `AA`.

The reason it is not four lines inlined in a test is the distinction it exists
to keep: **luminance is not linear in sRGB and `color-mix(in srgb, …)` is.**
Luminance linearises each channel before weighting it; the mix does not
linearise at all. Half way between black and white is `#808080`, whose luminance
is 0.216 of white's — computing the mix in the linear-light space would give
`#bcbcbc` and measure every surface against a colour no browser draws.

`readableOn` moved onto the same formula rather than keeping its own copy. Two
implementations of one formula is two chances to be wrong and only one of them
would have had a test — the argument that moved the message formatter in
ADR-0133, one file over.

### Quiet text was under AA in the dark theme, with no workspace involved

`--text-muted` was `--ink-400`: **4.44:1 on an overlay and 4.27:1 on a hovered
row.** Not an edge case, not a tinted workspace — the design's own answer, on
every menu and every hovered row of every dark instance.

It is the `--ink-500` story again, one theme over, and its own comment is where
it came from: *"the same value is fine in dark (5.1:1 on `--ink-900`)"* — true of
the page, and generalised to the six surfaces stacked above it.

`--ink-350`, `#9b998f`. 6.76:1 on the page, 4.57:1 against the worst tint any
workspace can choose. Secondary is 8.02:1, so the two are still a step apart.

### And every tinted workspace was under AA in the light theme

Seven of the eight palette colours put muted text between **3.98:1 and 4.49:1**
on the sidebar, the hovered row and the sunken field. Black, which the colour
input will happily give you, reached 3.55:1.

Two levers, and the arithmetic says which:

- **Darkening muted alone** needs `#56544e` to survive the current proportions —
  7.57:1 on the page against secondary's 9.76:1. The distinction between
  secondary and muted stops existing.
- **Cutting the tint alone** needs the chrome at 7% and the hover at 3%, from 16
  and 14. That is the feature — the per-workspace colour — mostly gone.

So: both, a little. `--ink-550` (`#5c5a54`) for muted, chrome 16 → 15%, light
hover 14 → 12%, dark hover 8 → 5%. **The worst pairing anywhere in the cube is
now 4.52:1.**

**The guarantee is in the proportions, not in a validator.** The colour input
stays a colour input; there is no clamp to write, no value to reject, and no
rule for a workspace to obey — the proportions are simply the largest ones at
which every colour is readable.

### A luminance band would have been the wrong shape, and this is why

The first idea was to bound the tint: compute the band of luminances that stay
readable and clamp into it. The band came out as 0.012–0.334, and the eight
palette colours sit comfortably inside it.

**415 colours in the sample sit inside it and still fail.** Saturated blues,
because the mix is per channel and luminance weights green at 0.7152 — two
colours of equal luminance do not produce surfaces of equal luminance. It is the
same mistake as the `color-mix` with `transparent` that ADR-0023 records:
reasoning in the wrong space, with an answer that looks right.

Checked before it was built, which is the only reason it was not built.

### `readableOn` never held the guarantee its own comment claimed

> 0.179 is where white and black are equally readable by the WCAG ratio.

True — for **black**. It returned `#141210`, a warm near-black, which is the
right instinct everywhere else in this design and is wrong here: its own
luminance moves the crossover to 0.193, so at the 0.179 threshold the dark
answer is only **4.08:1**. `#aa44dd`, an ordinary purple somebody would pick out
of a colour input, lands exactly there.

The threshold was computed for one value and shipped beside another. It has been
that way since it was written, and the comment saying it was a guarantee is what
stopped anyone looking.

`#000000` now. The two ends have to be the extremes or there is nothing to
guarantee: a dark end above a luminance of 0.0019 cannot reach 4.5:1 at its own
crossover, and `--ink-950` is already past that. The worst case is 4.58:1, with
about 0.08 to spare — named in the test, so a threshold moved to make some
colour look nicer cannot spend it quietly.

### The two dark themes were compared by name and not by value

`tokens.test.ts` checks that the chosen dark theme and the
`prefers-color-scheme` one fill the same *set of names*. That was enough to
catch a token added to one and forgotten in the other, and says nothing about
the two filling one name differently — which is what happened the moment
`--text-muted` was corrected: somebody who chose dark got the readable value and
somebody whose system chose it for them did not.

Values are compared now, for every name both declare.

## Consequences

**Ten contrast tests in `web`, eight in `core`**, and the web ones fail on the
old values — checked by putting them back.

**Two tests that were copies of the code are gone.** One asserted
`--text-muted: var(--ink-500)` under the title *"quiet text clears AA in the
light theme too"*: it checked a name, not a ratio, and passed while the dark
theme sat at 4.27:1. What is left of it is the relationship it was actually
about — muted is a different step in each theme, because a shared one is a value
chosen against one background and applied to the other. The other asserted the
chrome's tint was `16%` and would have failed when the number was deliberately
computed down to 15; it asserts the ordering now.

**Still open, and it is the next round:** *the accent as text.* Links are
`color: var(--sone-accent)`, and a workspace accent is a free colour with no
computed partner in that role — `readableOn` protects text drawn *on* the
accent, not the accent drawn *as* text. Two facts make it a design change rather
than a value change:

- The design gives itself two accents, `--accent-500` in light and `--accent-300`
  in dark, because the one that works on white glows on black. **A workspace
  accent gets one**, used in both.
- The design's own light accent is 4.90:1 on the page and 4.62:1 on the chrome —
  passing, and thin enough that it is not an accident nobody noticed.

The honest fix is a second accent step derived per scheme, which is ADR-0122's
argument about `inverted` applied to the accent, and it deserves its own record.

## Alternatives considered

**Clamp the tint into a readable band.** Built as far as the arithmetic and
abandoned there: the band leaks, for a reason that is a fact about colour rather
than about the implementation.

**Take the colour input away and offer the eight names.** It would work, it is
ADR-0023's own "steps, not values", and it costs the feature this project was
just told is one of its best. The proportions were the cheaper lever and they
give a stronger guarantee — every colour, not eight.

**Assert the numbers in a table.** A table of expected ratios is a second copy
of the design that has to be edited every time a value moves, and it would say
nothing about the colours nobody put in the table. The failure mode is exactly
the one this round found twice: a test that passes while the thing it is named
after is wrong.

**Accept AA for large text (3:1) on the quiet surfaces.** Muted text is a
timestamp or a count at body size. That is not large text; it is small text with
a lower target, which is the definition of the thing AA exists to stop.
