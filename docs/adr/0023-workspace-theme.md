# ADR-0023: A workspace theme fills the gaps a block leaves, and reading size is separate

## Status

Accepted and implemented.

The controls were briefly unreachable — they were rendered by the settings screen
and missing from its list — and are back under This workspace → Typography
(ADR-0032).

## Context

Two requests arrived together and are easy to confuse:

- **"I want to set defaults in the admin area — how big a heading is, what
  colour, and the same for every relevant element. On the page you can then
  adjust."**
- **"Zooming the content would be sensible, but the application frame should
  stay put."**

They look like one feature — both are "make the text bigger" — and they are
not. One is about what a document looks like to everybody; the other is about
how large one person needs it on their screen today. Building them as one thing
would mean a person's eyesight changing what their colleagues see.

## Decision

### The theme fills the gaps, it does not override

When block presentation was added (`align`, `width`, `color`), `null` was
defined as **"as the design decides"** rather than as a default value, and the
reasoning was written down at the time: a block holding an explicit default
would keep its old look for ever after the design moved on.

That is the hinge this turns on. A theme supplies what the design decides, so
the order is:

    theme → block attribute → rendered

A block with no attribute of its own follows the theme, including when the theme
changes later. A block with one does not, because somebody chose it. Nothing new
is stored in documents and no migration touches them.

Delivered as CSS custom properties on the application root, which is the same
mechanism already in use. The theme is therefore never consulted at render time
by any component — it changes what the existing variables resolve to.

### It is per workspace

Not per instance, although the request said "admin area". Different workspaces
want to look different, and an instance with one workspace cannot tell the
difference. The administration area can show and edit them; the value belongs to
the workspace.

### A closed set of choices, in steps

Per element kind — headings 1 to 3, body text, quote, callout, code, lists:

- **size**, as a step on the existing scale rather than a pixel value;
- **colour**, from the same palette as tags and select options;
- **spacing** above and below, in steps.

Steps rather than free values, deliberately. Free numbers produce headings that
no longer relate to the body text, and the person who did it cannot see that is
what happened — the scale exists precisely so those relationships hold.

Free CSS is refused for the same reason it was refused for blocks: a document
whose appearance is made of hand-written styles can never be restyled, exported
cleanly, or survive a theme change.

### The theme is decorative

Losing it costs appearance and never content, exactly as tag colours do
(ADR-0020). It is not rebuildable from the CRDT log and nothing may read it to
decide what a document *is*. A workspace with no theme row renders the way every
workspace renders today.

### Reading size is a separate, local thing

Pinch zoom cannot be limited to part of a page: the browser scales the visual
viewport, so a fixed toolbar scales with it. Fighting that through the
`visualViewport` API means recomputing the chrome on every zoom frame, and it
breaks with each browser release.

So the answer to "zoom the content, keep the frame" is not zoom at all. It is a
**reading size** inside the application: three or four steps that scale the
content column while the top bar and the sidebars stay where they are.

It is stored per browser, alongside the panel width, and not on the server. A
display preference synchronised to an account would mean somebody's phone
setting changing how their laptop looks, and a person's eyesight is not
workspace data.

Pinch zoom remains available and is not disabled — iOS ignores that instruction
anyway, and taking the capability away from people who need it to work around a
font size is not a trade worth making.

## The palette, and colours outside it

Added after the theme shipped, from a request with two halves: a colour of
one's own beside the eight, and the eight themselves settable per workspace.

They are one decision. Built separately, a custom colour and a redefined default
would answer the same question — "what colour is this" — in two ways, and the
first thing to go wrong is that they disagree.

**The eight names stay the vocabulary.** Everything that carries a colour — a
tag, a select option, a block, an entry's icon and its name — stores a name, and
a workspace decides what each name looks like. That is what makes a workspace
restylable at all: change `blue` once and every blue thing follows, which is the
whole reason names were chosen over values in ADR-0020 and repeated since.

**A custom colour is a ninth value, not a ninth mechanism.** It is stored in the
same field, distinguished by shape: a palette name matches `^[a-z]+$`, a custom
one is `#rrggbb`. Anything that renders a colour already maps a name to a
variable; it now falls through to the literal when the value is not a name. No
new column, no second field to keep in step, and an older client that does not
know about custom colours draws the design's default rather than breaking —
the same fallback an unknown icon name already gets.

**Contrast is not checked, and that is a decision.** A workspace can choose a
yellow nobody can read on white. Refusing would mean deciding for somebody what
their own document may look like, and the ones who would trip over it are also
the ones most likely to have a reason. What is offered instead is that clearing
a colour is always one click away and always returns the design's answer.

**Custom colours are per use, the palette is per workspace.** Somebody colouring
one folder pink is making a decision about that folder; an administrator setting
what `pink` means is making one about everybody. Storing a custom colour in the
workspace palette would turn the first into the second by accident.

## Consequences

The two settings compose without interfering: the theme decides proportions, the
reading size scales them. Somebody who needs larger text sees the workspace's
design at a larger size rather than a different design.

An administrator can make a workspace look wrong for everybody in it, which is
what "defaults" means. The step scales bound how wrong.

## Alternatives considered

**Storing theme values into each block on creation.** Rejected: it is the
"explicit default" mistake ADR-0021's attributes were designed to avoid, and a
theme change would then reach nothing already written.

**One setting for both.** Rejected above: it makes a personal need a shared
change.

**Reading size on the server.** Rejected: a display preference is not account
data, and syncing it makes one device's setting a surprise on another.

---

## Amendment: the interface's own two colours

Added after the element settings had been in use for a while, because the
question that kept coming back was not about headings: it was about the beige in
the sidebar and the green in the buttons.

**A tint, not a colour per surface.** The surfaces are a ramp of one warm grey
(ADR-0028) whose steps express what sits on top of what. A workspace that could
set each of them separately could set them inconsistently — a sidebar that no
longer belongs to the panel beside it. One hue mixed into the whole ramp keeps
those relationships, and keeps the dark theme working without a second set of
choices.

The proportions live in the stylesheet rather than in the theme: the sunken
surface takes the most hue, the page almost none, and the dark theme takes less
than the light one because a hue reads stronger against black. Emitting eight
computed colours from the theme module would move that knowledge somewhere it
cannot be read beside the tokens it belongs to.

**An accent, with its contrast computed.** The colour of links, defined text and
filled buttons is a choice; the colour of the text *on* a filled button is not.
It is derived from the accent's relative luminance, so a pale yellow accent gets
dark text and a deep green gets light. Offering that as a second choice would be
offering somebody a way to make a button unreadable, and the interface says so
under the control rather than leaving it to be discovered.

**Both are nothing when unset.** The fallback is at every use rather than
declared once in a rule, which is the discipline this record already imposed:
`clearTheme` removes theme properties from the root when a theme stops setting
them, and a value living in a rule would survive its own deletion in some places
and not others.
