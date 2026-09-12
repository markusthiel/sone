# ADR-0181: The switch that was only written down

## Status

Accepted. Built. Still not measured on a tablet — see ADR-0179.

## Context

> Du meintest du setzt einen button auf die whiteboards damit man vom pen auf
> finger wechseln kann. Den finde ich nicht.

It is not there. ADR-0179 built the rule — *once a pen has been seen on this
device, only the pen works the tools* — and listed the override under
**Alternatives considered**:

> The switch is still worth having as an override, and is not here because
> nobody has yet hit the case that needs it.

Somebody has now hit it, by going to look for it. And the sentence was doing two
jobs at once: recording a deliberate omission, and reading as a promise. Those
are different things, and the reader of a whiteboard toolbar cannot tell them
apart.

There was a second trace of the same confusion in the code. `CanvasSurface.tsx`
kept `penSeen` in React state rather than in the ref beside the other contacts,
with the comment *„`penSeen` is state as well, because the toolbar says so"* —
and the toolbar said nothing. The state was being paid for by a render per first
pen stroke, for a control that did not exist. **A comment can describe behaviour
that nothing in the file produces**, again.

## Decisions

### The override is a second fact, not the first one cleared

`penSeen` is a measurement: a pen *was* put down here. Somebody switching the
rule off does not make that untrue, and clearing it would mean the next pen
stroke silently switched the rule back on.

So `handDraws` is its own remembered fact, defaulting to off. Keeping them apart
is also what lets the toolbar know a pen exists — which is the only reason the
switch can be offered at the right moment.

### It appears only once a pen has been seen

Before that, the rule is not in force and the control would change nothing. A
control that changes nothing is one somebody presses twice looking for what it
did.

This is the reason `penSeen` is state: the first pen stroke has to cause a
render, because it is what puts the switch on the screen. The comment is now
true.

### Per device, like the rule it turns off

Same reasoning as ADR-0179 and ADR-0178: it is a fact about the glass, not about
a person or a board, so it lives in the browser, survives a reload, and is not
cleared by signing out. The iPad where a hand rests on the screen is the iPad
where it rests for whoever is holding it.

### A word, not a mark

The whiteboard bar is marks-only, on the stated condition that each mark *is the
thing it makes* — a rectangle is a rectangle (ADR-0042). Nothing draws *only the
pen works the tools*: a pencil already sits two buttons away meaning the pen
tool, and a hand means the pan tool. Two pencils in one bar is a bar somebody has
to learn.

So it is a checkbox labelled **„Nur Stift"**, ticked for the rule and unticked to
give the finger the tools back, with the full sentence as its tooltip. The bar
already carries two other worded controls (the ruling, the thickness), so this
is the existing exception rather than a new one.

### Two fingers stay a gesture

The override is about the palm rule, not about the pinch. A board that stopped
zooming because somebody let their finger draw would be a worse trade than the
one they made.

## Consequences

Five tests added to the eight from ADR-0179: the finger drawing again, the pinch
surviving it, the pen unaffected, the control guarded by `penSeen`, and — the one
that matters most — **that what the switch remembers reaches the rule**. That
last one is ADR-0178's mistake in this shape: a remembered fact nothing reads is
a switch that does nothing, and it is invisible to every test of the rule itself.

`Contact` gained a required field rather than an optional one, so every place
that asks about a contact has to say what it believes about the hand. Making it
optional would have let `CanvasSurface` forget to pass it and still compile —
which is exactly how a switch ends up doing nothing.

### What this round is really about

ADR-0179 recorded an omission in the place where alternatives go, and an
alternative that is "worth having" is not an alternative — it is a to-do in a
file that nobody treats as a to-do list. The project has one honest place for
those, **Left open** in Consequences, and that is where a deferred *part of the
feature* belongs. Alternatives are for the paths not taken.

## Alternatives considered

**Clear `penSeen` instead.** One fact instead of two, and the next pen stroke
turns the rule back on without anybody asking for it.

**A setting in the profile.** It is a property of the device and the moment, and
somebody whose hand has just drawn a line does not want to go and find a
settings screen — which is ADR-0179's own argument for why the rule has to work
without one.

**Per board rather than per device.** The pencil is with the person, not with the
drawing. A board opened on a laptop would carry a rule that means nothing there.

**Three states in one control** — pen only / finger only / both. Finger-only has
no use that anybody has named, and a control with three positions is one whose
middle position somebody has to remember.
