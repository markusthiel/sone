# ADR-0028: Three layers of token, and a theme is a list of values

## Status

Accepted, not yet implemented.

## Context

Light and dark already exist: six variables, declared once under
`prefers-color-scheme` and again under `html[data-theme]` because a media query
cannot be overridden from CSS. That works and does not extend.

A third theme means a third block of six. Every variable added afterwards has to
be added in three places, and the one that is forgotten is wrong in exactly one
theme — which is the hardest kind of mistake to see, because everything looks
right until somebody switches.

Six is also too few. Dark needs layers — a page, a raised surface, an overlay —
and expressing height with shadow does not work on a dark background, where a
*lighter* surface is what reads as nearer.

## Decisions

### Three layers, and only the middle one is used

**Primitives** name what a value is: `--sone-grey-900`, `--sone-blue-500`.
Nothing in a component refers to one.

**Semantic tokens** name what a value is *for*: `--sone-surface`,
`--sone-surface-raised`, `--sone-text-primary`, `--sone-border-subtle`. These are
the only names the interface uses.

**A theme** is a mapping from the second to the first. Not a set of overriding
rules — a list of values.

The gain is that adding a theme becomes filling in a list, and a component never
has to know which theme is active. The cost is a layer of indirection, and it is
worth it the moment there are three themes; it is already worth it at two,
because the second is currently written twice.

### Every theme fills every token, and a test says so

The failure this prevents is precise: a token added to one theme and forgotten
in another shows nothing wrong until somebody switches, and then shows an
inherited value that is almost right. A test comparing the key sets catches it
at the moment it is introduced, which is the only moment it is cheap.

### Dark is designed, not inverted

Three things that do not survive inversion, written down because each one is
usually discovered the slow way:

- Pure white on pure black shimmers. The extremes are avoided at both ends.
- Shadow does not express height on a dark background. A raised surface is
  *lighter*, and the token is named `surface-raised` rather than `shadow-1` so
  the two themes can answer differently.
- Saturated colours that look right on white glow unpleasantly on black. Every
  palette colour therefore has a value per theme — including the workspace
  palette (ADR-0023), or somebody's chosen blue is wrong in one of the two modes
  and they cannot tell which.

### Two axes that must not merge

The **workspace theme** styles *content* — headings, body colour, the palette —
and belongs to the workspace, because a document should look the same to
everybody reading it.

The **application theme** styles the *interface* and belongs to the person. My
dark mode is no business of yours, even while we are editing the same page.

Conflating them would mean one person's preference changing what another sees,
which is the kind of thing that is obvious once stated and not at all obvious
while implementing.

### Automatic, light, dark

Following the system is the default and the right one. It is not sufficient:
somebody sitting outside wants to force light regardless of what their laptop
thinks, and somebody working at night wants dark on a machine that has never
heard of the setting.

Stored per person and applied before first paint, or the interface flashes the
wrong theme on every load — which is worse than not offering the choice.

## Consequences

Every existing rule that names a raw colour has to be moved onto a token. That is
mechanical and large, and it is the work that makes everything after it small.

The workspace palette gains a value per theme. Existing palettes have one value;
they become the light one, and the dark one is derived until somebody sets it.

A custom theme becomes possible without new CSS, so it can later be a file, a
row in a table, or something an administrator pastes in — none of which needs
deciding now, and none of which is possible today.

## Alternatives considered

**A CSS framework with theming built in.** Rejected: this application has an
opinion about how it looks, and adopting somebody else's tokens means adopting
their opinion and then arguing with it.

**Keeping the two-block approach and being careful.** Rejected: the mistake it
invites is invisible in review, and "be careful" is not a mechanism.

**Deriving dark from light programmatically.** Tempting, and rejected above — the
three things that do not survive inversion are exactly the things a derivation
would get wrong, and it would get them wrong consistently, which reads as a style
rather than as a fault.
