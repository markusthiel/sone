# ADR-0195: The lock is the colour of a warning

## Status

Accepted. Built. A correction to the presentation ADR-0194 chose, not to what
the lock does.

## Context

ADR-0194 gave the padlock a state: `aria-pressed`, a filled ground and a
hairline outline when the block is locked. That was the right move and it is not
enough.

> Könnte man das Schloss-Icon rot färben wenn es aktiv ist? Wir haben es bereits
> mit dem Kasten umrandet, aber es darf ruhig etwas auffälliger sein.

The box is `--sone-bg-hover` with a `--sone-border` outline — the same ground
every other button in that row takes under the cursor. Sitting in a row of seven
grey glyphs it reads as "the mouse is over this one", which is the one thing it
does not mean. The single member of the row that is a *state* was the least
visible thing in it.

Two ways out were weighed:

- **Grey box, red glyph.** Barely louder than today. The ground reaches the eye
  before the glyph colour does, so at a glance nothing has changed.
- **Tinted ground, red outline, red glyph.** The box is what carries from the
  corner of the eye; the colour is what says *which* box.

The second. The colour has to be in the thing that is already doing the work.

## Decision

**The locked padlock is `--sone-danger`** — ground at 12%, outline at 40%, glyph
at full — the app's existing "careful now", not a new value, so it follows the
dark theme's `--danger-300` without a second rule.

**It stays red under the cursor.** `.block-menu-action:hover:not(:disabled)`
is more specific than `.block-menu-action.current`, so without an explicit hover
rule the padlock fell back to grey exactly when someone reached for it — which
looks like the unlock already happened.

Reusing the danger colour for a state rather than a destructive act is a
deliberate overload, and survivable here because the only other red in this row
is the trash can, which is red *only* on hover. A permanently red glyph beside a
grey one is not the same signal.

## Consequences

- `--sone-danger` now means two things in one row: "this cannot be undone by
  pressing it again" and "this block is held". If a third meaning wants the same
  red, that is the point to give locking a colour of its own instead.
- The mark in the page is still the 2px hairline ADR-0049 chose and ADR-0194
  left alone. This ADR makes the *menu* louder, which is still one click late.
  When the next report touches it, the margin is where to look.
