# ADR-0042: What moves

## Status

Accepted.

## Context

The interface has almost no motion: ten transitions in the whole stylesheet, all of
them a border or a background on hover. Asked for: light animation when a section
changes, when the tree opens, when a button is pressed — without costing
performance.

"Without costing performance" is the whole design question, and it has a precise
answer rather than a careful one.

## Decisions

### Only `transform` and `opacity`, and one duration scale

Those two are the only properties a browser animates without laying the page out
again: the compositor moves an already-painted layer. Anything else — `height`,
`width`, `margin`, `top` — makes the browser recompute layout on every frame, and
on a page holding a document and a synced editor that is where a stutter comes
from.

So no animated `height`, which rules out the obvious way to open a tree branch
and is dealt with below.

Three durations, named: 90ms for a press, 140ms for a state change, 200ms for
something arriving or leaving. Beyond about 200ms an interface feels like it is
deciding rather than responding.

### A press is felt, not watched

`scale(0.97)` while a button is held, and nothing else. It is the one piece of
motion that is genuinely useful rather than decorative: it confirms the press
before the result arrives, which matters most exactly when the result is slow.

### A tree branch fades its children in; it does not grow

The children appear in layout at once and fade up over 140ms with a two-pixel
rise. Animating the height would mean measuring it every frame, which is the
layout cost this record exists to avoid.

The dishonest alternative — a fixed `max-height` guess — is worse than no
animation: it clips a long branch, and a tree is exactly where somebody has a
long branch.

### Switching a panel cross-fades its body, and never its tabs

The body fades in; the strip of tabs does not move at all. A row of controls that
animates when you use it feels unreliable, and the tab is the thing somebody just
hit — it has to stay exactly where their finger was.

### Nothing animates on first paint

Every one of these is a *transition*, not an animation: it happens when something
changes, not when the page loads. A page that assembles itself while somebody
waits for their notes is a page that took longer.

### Somebody who asked for less motion gets none of it

`prefers-reduced-motion: reduce` turns all of it off — not shortened, off. The
outcome is identical in every case, because none of this motion carries
information. That is the test of whether motion is decoration: if turning it off
loses nothing, it was decoration, and decoration is exactly what that setting is
about.

## The chrome at the top

Asked separately: should the header be a tinted band, or floating buttons over the
page?

**Neither, quite.** The band is dropped: it sits on the same surface as the page
and the writing, with no fill of its own — the same argument ADR-0028 already made
for the page body, which reads as a lighter panel floating in a darker window if
it has a surface. A line under it appears only once the page is scrolled, because
that is the only moment it has a job: saying that something is above.

Floating buttons over the content were rejected for a reason already visible in
this application: the gutter controls float over the text, and they were found
sitting on top of the placeholder. A control with nothing behind it is a control
that will one day sit on top of a word.

(The cause of that particular collision was a stale position, not the floating
itself — the editor's width changes when the page panel opens, with no window
event to notice. It is fixed by watching the editor's own box. The argument
against floating chrome stands on its own.)

### The two toggles are the same kind of thing, and now look it

The left one is a sidebar icon, the right one was a chevron — two shapes for one
idea, "show or hide a panel". The right one is the same icon mirrored. A chevron
means "go", and it was the only chevron in the interface that did not.

### No home button up there

The workspace's name at the top of the sidebar is already home, and a second way
to the same place is a second thing to learn. What is genuinely missing when the
sidebar is hidden is not a home button but the page's *trail* — which folder this
page is in — and that is a feature rather than a button. Written down here so the
next person knows the button was considered and declined.

## An animation library

Asked: would one make this feel more polished?

**No, and the reason is not the bundle.** The constraint that makes motion cheap
is *what* is animated, not what animates it — `transform` and `opacity`, and
never a height. A library does not lift that constraint; the popular ones
actively encourage crossing it, because animating layout is what their layout
animations are for.

What a library buys is spring physics, gesture-driven motion and orchestrated
sequences. This application has none of those problems: every piece of motion
here is one property changing once when a state changes, which is a CSS
transition — three lines, no dependency, and it runs on the compositor whether or
not JavaScript is busy. On a page holding a synced editor, "whether or not
JavaScript is busy" is the whole argument.

Two things would change this. A drag that follows a finger with momentum, or a
shared element that has to travel between two layouts. If either arrives, the
platform's own View Transitions API is the first thing to try, and a library the
second.

## Consequences

Six transitions and one scroll listener. The listener is passive and toggles one
attribute, and is the only JavaScript any of this needs.

A tree branch opening is honest about being instant, which somebody used to a
sliding accordion may read as abrupt. That is the trade, and the alternative was
measuring layout sixty times a second.
