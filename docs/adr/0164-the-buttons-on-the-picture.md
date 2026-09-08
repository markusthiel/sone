# ADR-0164: The buttons on the picture

## Status

Accepted. Built. Fixes two faults ADR-0163 shipped.

## Context

Reported while testing the day it merged:

> Beim Vollbild des Titelbildes fällt mir auf dass, wenn die linke seitenleiste
> ausgeblendet wird, das bild nicht mehr bis ganz zum oberen rand geht. Es
> entsteht ein Abstand. Außerdem lässt sich der Titelbild ändern Button und der
> daneben zum entfernen nicht mehr korrekt anklicken. Es scheint vor allem
> verschoben zu sein.

Two faults, and reproducing them said that one of the two is worse than
reported.

## Decisions

### The gap: the pull-up is only true at the top of the body

A bleeding cover is pulled up by the bar's height plus the page body's top
padding. That arithmetic assumes the picture is **the first thing in the body**,
and hiding the sidebar makes it not be: a page draws its breadcrumb only *while
the sidebar is away* (ADR-0019's tree is the trail when it is there), and the
breadcrumb was the body's first child. Measured: the band's top went from 0 to
**27** — exactly the height of the trail.

So the trail moved **inside the heading region**, under the cover and above the
title. Which is also where it reads better: the folders, then the name of the
thing they contain.

And the rule now says what it assumes — `.topbar + .page-body > .entry-head:first-child`
— so whatever somebody puts above the cover next turns the bleed off instead of
sliding the picture down. It is the same shape as the banner guard ADR-0163
already had, one level in.

### One breadcrumb, because there were two

The copy in `PageView` carried this comment: *"the same markup a folder's own
trail uses, so the two do not drift apart"*. They drifted the moment the trail
had to move — moving it meant moving it twice, and **a rule that has to be
applied twice is a rule that gets applied once.** It is one `Breadcrumb`
component now, used by the page and the folder.

### The buttons were under the bar, and always had been

The reported half was that they are displaced. Measured, with the sidebar
showing:

```
actions box   985 … 1196 × 10 … 38
elementFromPoint(centre) → .topbar
```

They sat inside the top bar's box, and the bar is a full-width sticky element at
`z-index: 5` — so **every click on them landed on the bar**, whether or not the
sidebar was showing. Toggling it only moved them far enough to notice. The
picture in the report is a control that can be seen and not pressed.

Two separate mistakes, one on each axis:

**Horizontally**, the actions are positioned against `.entry-head`, which *is*
the reading column, so on a band that runs to the page's edges they sat ten
pixels inside the *column's* right edge — floating in the middle of the picture.
They now take the same breakout the band itself uses.

**Vertically**, they moved below the bar rather than above it in the stacking
order. Raising them would put them over the bar's own controls in the same
corner, and the answer to who owns the top fifty-two pixels is the bar.

## Consequences

### Measured in Chromium, before and after, both sidebar states

| | band top | actions | click reaches |
|---|---|---|---|
| before, sidebar shown | 0 | 985 × 10 | **`.topbar`** |
| before, sidebar hidden | **27** | 855 × 37 | **`.topbar`** |
| after, sidebar shown | 0 | 1179 × 62 | the button |
| after, sidebar hidden | **0** | 1179 × 62 | the button |

The two "after" rows are identical, which is the point: whether the sidebar is
showing is not supposed to be a fact about the picture.

### Five tests

Two hold the CSS that moves the buttons, one holds the `:first-child` guard, and
two hold where the trail is written — the one thing a source test is right for.
What the rules *do* is in the table above, because jsdom has no layout and a
test that cannot see a bar overlapping a button cannot see this bug.

### What this says about the round before it

ADR-0163 measured a great deal — the band's edges, the first line of text, the
ink under each control — and every measurement was of the *picture*. The two
buttons on it were never in a table, and they were broken in the plainest state
of all: a page with the sidebar open.

**A measurement covers what it names.** The rest is untested however many
numbers are in the record.

## Alternatives considered

**Give the actions a `z-index` above the bar.** Then two sets of controls
overlap in the same corner, and the bar's are the ones a page always has.

**Pull the band up by the breadcrumb's height as well.** The picture would then
be drawn over the trail, and the trail is a link somebody clicks.

**Leave the trail above the cover and let the bleed fall back to full width.**
It works, and it makes hiding the sidebar silently change what the page looks
like — a setting somebody chose, undone by an unrelated one.
