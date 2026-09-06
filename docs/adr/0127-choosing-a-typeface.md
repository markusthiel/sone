# ADR-0127: Choosing a typeface

## Status

Accepted. Built. Asked for. The last numbered step of the appearance concept.
Extends ADR-0068 (self-hosted faces) with three more and ADR-0023 with one more
named step.

## Context

> Schriftpaare.

The concept's own estimate, written before any of this was built:

> Drei bis vier kuratierte Paare (SIL OFL, variabel, je ~100 kB), gewählt als
> *Paar-Name*, plus „System".

That is what this is, and the reason it was last is that it is the only step in
the concept that costs **bytes** rather than reasoning. ADR-0068 serves Archivo
and JetBrains Mono from this instance and fetches nothing from outside; a second
face is a second file in the repository, permanently.

## Decisions

### A named pair, never a family

`designed` / `reading` / `plain` / `system`. The same rule every other value in
a theme follows, and this is the one where breaking it is most tempting: a font
family typed into a box is a font somebody's machine may not have, and **the
person who typed it sees their own machine and cannot tell**. Everyone else gets
a different design and nobody finds out.

`designed` is what the design does today and is stored as nothing — the rule
`follow` and `soft` already follow.

### A pair is two faces, and both are emitted

Body text and code are two questions, and answering only the first is how a
workspace ends up with a serif page and the design's own grotesque in every code
block: a mismatch nobody chose.

Three of the four pairs use JetBrains Mono, because it is the right mono for all
of them and a second mono file is a second download for a difference few would
notice. `system` genuinely differs — `ui-monospace` — which is what makes the
pair a pair rather than a text-font setting with a decorative second half.

### Every stack ends somewhere the machine already has

A downloaded face can fail: a slow network, a blocked request, a reader who
turned webfonts off. The fallback is what they read in the meantime, and a stack
ending in the family name alone ends in whatever the browser decides, which is
usually Times.

### `system` downloads nothing at all

It names no face this instance ships. That is the point of offering it: a reader
on a metered connection, or an operator who would rather serve no webfont at
all, gets an interface with none in it.

### Declared always, downloaded never — unless asked for

All four families are in the stylesheet at all times. An unused `@font-face`
costs a browser nothing, so a closed list of extra faces is cheap at runtime:
the bytes are in the repository rather than on every reader's connection.

Weight axis only, no italic file. That is the trade the design's own pair
already makes — an italic file is a second download for something the interface
synthesises acceptably.

### The three lists are compared by a test

The failure this whole record risks is **a pair that names a font nobody
ships**. It costs nothing at build time and nothing in a test that reads only
the core; the first sign of it is a workspace whose text quietly falls back to
Georgia, on somebody else's machine.

So the test compares what a pair may resolve to, what the stylesheet declares,
and what is actually in the directory. It reads the *first* entry of each stack
and not every quoted one — `'Times New Roman'` is quoted because it has spaces
in it, not because anybody is fetching it — which is a distinction the first
version of the test got wrong and the run found.

### `--sone-font` joins the properties a theme can set

Which means the remover has to learn a fifth prefix. The contract test written
in ADR-0122 exists for exactly this — "a new prefix added here without changing
the remover is the same bug again" — and it failed until both were changed.

## Consequences

**Six core tests and two web ones**, plus one prefix added to two lists.

**Two faces added, 228 kB in the repository**, downloaded only by the workspaces
that choose them. Literata (Google, SIL OFL) for reading; Inter (rsms, SIL OFL)
for a neutral page. Licence text beside the files, as ADR-0068 does.

**It travels for free.** A pair is one more thing a theme says, so it is in an
exported file (ADR-0125), in the instance's base design (ADR-0123) and in the
merge — none of which needed a line.

**The appearance concept is finished.** What remains of the whole concept is the
mail side's two small pieces — the export link and the logo inlined as `cid:` —
and two named gaps: the contrast check as a computed test, and "show more" for
tags in search.

## Alternatives considered

**Let a workspace type a font stack.** What most tools do, and the reason most
self-hosted instances have one page that renders in Times for half the people
who open it.

**Upload your own font.** The step after this one and a much larger one: a
storage key, a face served to anonymous readers, a licence question this project
cannot answer for somebody else's file, and a `@font-face` built from user
input.

**More pairs.** Every one is bytes in the repository forever. Four is enough to
make the setting mean something; a fifth needs a reason of its own.

**A different mono per pair.** Doubles the bytes for a difference few would
notice, and a monospace face is read as code rather than as design. The model
allows it without a migration if a pair one day needs one.

**Fetch from Google Fonts.** One line, no bytes, and every reader of every
self-hosted instance reported to Google. ADR-0068 refused it and nothing here
changes that argument.
