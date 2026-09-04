# ADR-0068: The mark, the faces, and the rail

## Status

Accepted and implemented.

## Context

SONE had no visual identity at all. Not a thin one — none: no logo, no favicon,
no installed icon, no manifest, and no `public/` directory to hold any of them.
The whole brand surface was the word SONE in a `<title>` and in an error screen.
A tab in a row of tabs was a blank sheet of paper, and ADR-0009's "its first
mobile form is a PWA" had nothing to install.

The token layer from ADR-0028 was already the right shape for fixing that, so
most of this is values rather than architecture. Three things were not.

## Decision

### A mark that is the product, not a letter

The mark is an indented stack of four bars: the page tree, drawn as a glyph. The
third bar carries the accent — the level you are on.

An S in a rounded gradient was the obvious alternative and is the one logo every
tool built since 2020 already has; the gradient also breaks the moment the mark
has to be one colour, which is a stamp, an engraving, a favicon and a printed
invoice.

The accent bar is `var(--accent)`, not a fixed value. The workspace theme
(ADR-0023) therefore reaches into the mark, and a workspace set to blue has a
blue mark. That is the useful half of an accident: a fixed brand colour would
have had to be a red, and `--danger` is already a warm red, so a primary control
and a destructive one would have come out looking alike. Binding to the accent
avoids the collision and buys a property a fixed mark could not have.

Four bars and not three at every size the interface draws. A three-bar build was
tried and is a hamburger — three stacked lines is the one thing a small mark in
the top-left corner must not be. The fourth bar steps back out, and that step is
what makes it a tree. The favicon and the installed icons are three-bar builds
because at 16px the four close up; they are files, so they carry the default
accent rather than the workspace's.

### Faces served from here

Archivo for text, Jetbrains Mono for anything technical — a label, a count, a
path, a duration. Both SIL OFL, both variable-weight, both under `public/fonts/`
with their licences beside them. Three files, about 108 kB, two of them
preloaded.

The stylesheet's existing note said fonts are deliberately not fetched from a
font service, because a stylesheet that reaches out to Google tells Google who
opened somebody's notes and when. That reasoning is not weakened by having a
brand face; self-hosting is what makes the two compatible at all. The system
stack stays in the same declaration as the fallback, so a failed download is a
different font and never no text.

Mono is not decoration. A section label names a place — it is something you
find, not something you read — and the monospaced face plus wide tracking is
what separates it from the page titles beneath it without spending a colour or a
rule. A count is a number you compare, and mono keeps 8 and 88 the same shape in
the same column.

It runs through everything technical, not through three classes: the breadcrumb,
a column header, a file's size and date, a version, every count. The first pass
gave it to three and the result was a texture nobody could see.

A table header is a rule now rather than a fill. The subtle background made it a
second surface inside something that is already a grid of lines, which is two
devices for one job — and it is not uppercased, because a column's name is
something somebody typed and shouting it back at them is a liberty a static
label can take and this cannot.

Document headings keep `--sone-heading-weight: 300`. The brand direction wanted
them bold and tight; the argument already written into `typography.test.ts` is
better than that one — size carries the weight, and a bold heading over a note
shouts at the thing it introduces.

*Amended:* the page title was taking that token too, so an argument about prose
was being applied to something that is not prose. A heading inside a document
introduces the paragraph under it. A page title is the label on the thing you
have open, in a row with the breadcrumb and the sidebar's labels — furniture,
and furniture may be firm. Two jobs, two tokens: `--sone-title-weight: 700` at
`-0.035em` for the title, 300 unchanged for the document. The shared token was
the accident, and it was mine: I read the test, agreed with it, and did not
notice it was guarding a different element than the one I was declining to
change.

That split is what made the difference visible at all. With it, and with the
monospaced face given to the breadcrumb, the table headers, the metadata lines
and the counts, the interface reads as the design rather than as the old one
with a new logo — which is what it still looked like after the first pass.

### A rail for the instance

A third grid track, 56px, holding the mark and three places: the inbox, the
workspace list, the trash. The sidebar answers "which page" and changes when you
switch workspace; these answer "which part of SONE" and do not.

They are on the rail *instead of* in the account menu, not as well as. The first
build had them in both, on the theory that duplication is what lets the rail be
`display: none` below 800px without taking anything with it. ADR-0067 had been
amended two commits earlier over exactly that: three ways into one subject was
not an improvement, and the operator's verdict was that the menu had got worse.
A rail that repeated the menu is the same finding with a column around it.

So the list lives once, in `places.tsx`, and is drawn twice at widths that are
never both on screen — the rail above 800px, the foot of the sidebar's drawer
below it. Hidden by the stylesheet rather than by a media query in JavaScript,
so the breakpoint has one owner and it is the thing that draws it.

Search is in neither. It already has one way in, the labelled row above the
tree, and that row is in the sidebar at both widths; an icon on the rail would
have been a second one, and the less findable of the two. Your settings, the
administration and signing out stay in the account menu, which is what that menu
is for and what stops it becoming one item behind an avatar.

Destinations only. The moment something on it creates or changes anything, it
stops being a map.

## Consequences

Two bugs fell out of reading the shell closely enough to add a column to it, and
are fixed here rather than filed:

- The 1100px template wrote `260px` where `var(--sidebar-width, 260px)` belonged,
  and out-specifies the 800px rule that has it right. A sidebar somebody had
  dragged wider snapped back to 260 the moment they opened the right panel and
  returned when they closed it, which reads as the panel resizing the sidebar.
- `--sone-shadow-floating` was used twice and declared nowhere, without a
  fallback, so two floating elements rendered flat. `--sone-warning` was used
  three times with two different fallbacks and declared nowhere. Depth is now
  four tokens with their own dark values, and `brand.test.ts` fails on a raw
  `box-shadow` and on a `var()` fallback that would hide the next one.

One accessibility fix rides along: `--text-muted` was `--ink-400`, which is
3.6:1 on white and 3.3:1 on the sunken surface — under AA, on every quiet label
in the light theme. The same value is 5.1:1 in dark and was right there, so the
ramp gained the `--ink-500` it was missing and light uses it. Dark is unchanged.

Not done here, deliberately: there is still no service worker, so the manifest
makes SONE installable but not offline — ADR-0009's PWA is closer, not
delivered. And there is still no shared UI primitive layer; the rules live in
one stylesheet but the class names are applied at about 1,170 sites across some
69 components, so anything that moves markup rather than values is a separate
piece of work.
