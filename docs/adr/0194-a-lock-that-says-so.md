# ADR-0194: A lock that says which way it is standing

## Status

Accepted. Built. A correction to how ADR-0049's block lock is presented, not to
what it does.

## Context

> Ich habe hier einen Info-Block eingesetzt den ich jetzt nicht mehr bearbeiten
> kann. Weder Farben noch Typ ändern klappt. Es bleibt blau.

The block was locked. Nothing about the callout, the tones or the colours was
broken: `blockLock`'s `filterTransaction` refuses any transaction whose steps
touch a locked block, and `setBlockStyle` writes with `setNodeMarkup`, which
produces a `ReplaceAroundStep` like every other structural change.

**The refusal is right.** A lock that let a colour through would be a lock over
some of the block, and the filter cannot tell an attribute change from a content
change by looking — that is exactly why the unlock has to announce itself with a
meta (ADR-0049 learnt this the hard way, by locking away the only way out).

What was wrong is everything around it:

- **The menu offered every setting.** Its own comment says it disables what
  cannot happen — *"Disabled when the command refuses, so the menu never offers
  something that silently does nothing"* — and it does ask, with a dry run. But
  it asks the **command**, and the command would act. The refusal happens a
  layer further on, in the filter, where a menu cannot ask. So the row of
  actions, the tones, the colours and "Umwandeln in" all looked live and all did
  nothing.
- **The padlock did not say which way it was standing.** ADR-0049 flipped its
  *label* — "lock" or "unlock" — and reasoned that one control then says both
  what it does and what the state is. The label is a tooltip. Nobody reads a
  tooltip before clicking, and the glyph beside six other grey glyphs is
  identical either way.
- **The mark in the page is a 2px hairline in the margin**, deliberately quiet,
  which beside a callout reads as a quote bar.

## Decision

**The padlock carries its state**: `aria-pressed`, and a filled, outlined button
when the block is locked. It is the one member of that row that is a *state*
rather than a verb — everything else happens and is over.

**What the filter would refuse is disabled**: move, indent, duplicate and delete
on a locked block. Unlocking stays live, or a locked block could never be
unlocked from here.

**The settings are left out and replaced by one sentence** — "Dieser Block ist
gesperrt. Zum Ändern oben das Schloss öffnen." Not greyed: forty disabled
controls are noise, and this menu already holds that a section of controls with
no effect teaches people the panel is decoration. Copying the block's address
stays, because it changes nothing about the document.

## Consequences

- The menu now knows something about `blockLock` beyond calling `isBlockLocked`:
  it knows *that the filter refuses structural steps*. That is a second place
  holding one rule. The alternative — asking the plugin to dry-run a transaction
  — is a bigger interface than the problem, but if a third caller needs the same
  answer, that is the shape to build.
- A locked block's menu is short. Somebody who locked a block and forgot will
  now be told why, which is the whole point.

## What was not done

**The hairline in the page.** ADR-0049 chose quiet deliberately — a lock anybody
who may edit can lift must not look like a warning — and that reasoning still
holds. It is, however, the thing that would have answered this report *before*
the menu was opened, and a small padlock in the margin instead of a stripe is
worth weighing when the next report touches it.
