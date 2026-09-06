# ADR-0122: Treating the furniture separately

## Status

Accepted. Built. Asked for. Extends ADR-0023 (a workspace theme) and ADR-0028
(the token layer); changes nothing either of them decided.

## Context

> Ich fände es gut, wenn wir das Design deutlich anpassbarer machen. Also nicht
> nur Farben, sondern auch Schriftarten und einzelne Elemente behandeln, z.B.
> die neue schmale Leiste dunkel und Rest hell.

And the complaint underneath it, which is the part that matters:

> dass dann halt alle Farben anders sind, aber sonst verändert sich nichts.

That is a fair description of what a theme was. A workspace could set a tint, an
accent, a palette and per-element type — and the result was the same interface in
another colour, because the *arrangement* was never in the theme's hands. Every
tool with a theme picker has that. It is not what makes an instance look like
somebody's own.

### The rule this must not break

ADR-0023, on itself:

> Steps, not values. […] Free numbers produce a heading that no longer relates
> to the body text underneath it, and the person who set it cannot see that is
> what happened.

A colour picker per surface is exactly the free value that rule refuses, and it
fails worse here than it does for type. `#101010` on the rail is `#101010` in
both schemes, so a workspace that chose a dark rail against its light page would
be handing everybody who reads in the dark a black bar against a black page. The
setting would look right to the person who set it and be broken for half the
people who see it — the hardest kind of mistake to catch, because nothing is
wrong until somebody else opens it.

## Decisions

### A surface is given a treatment, not a colour

`rail`, `sidebar`, `panel`, each set to one of `follow`, `raised`, `sunken`,
`inverted` or `accent`. A **named relationship**, which the stylesheet resolves
in the scheme the reader is actually in.

`inverted` is the whole argument in one word: light-on-dark for somebody in the
light theme and dark-on-light for somebody in the dark one, **from one stored
value**. The workspace says what it wants; each theme says what that means.

`follow` is stored as nothing at all. Absent and "as the design decides" are the
same state (ADR-0021), and a stored default stops being right the moment the
design changes underneath it.

### The page is not on the list, and neither is the top bar

Inverting the reading surface is "dark mode for this workspace", and that is the
reader's decision rather than the workspace's — somebody outside in the sun
wants light whatever their workspace prefers, which is the argument the
stylesheet already makes for `prefers-color-scheme`. A workspace that could
invert the page could override that for everybody in it.

The top bar sits on `--surface-page` on purpose (ADR-0042): it is a strip *above*
the writing on the same paper, not furniture beside it. Treating it would undo a
decision rather than extend one.

### The mechanism: the container redefines the names its contents read

A treated surface sets `--text-primary`, `--text-muted`, `--border-subtle` and
`--surface-hover` for its own subtree. Nothing inside is told it was treated —
every row, label and line follows.

The alternative was a fallback added to each of the several dozen rules that name
a colour inside those three areas, and the one that was forgotten is a row nobody
can read.

Two details this needs, and neither can be written with the names themselves:

- **`--sone-base-*`** is what those names mean on the page.
  `--text-primary: var(--text-primary)` is a cycle — both sides become invalid
  and the interface loses its text colour — so the fallback is the same value
  under a name that is not being redefined at that moment.
- **A popup goes back to it.** `.sidebar-account-menu`, `.switcher-menu` and
  `.entry-menu` float above the page on the overlay surface, which is not
  treated. Without the reset, a menu opening out of an inverted rail would be
  drawn light and handed the rail's light text.

Every property a treatment emits is a `var(...)`, never a colour — asserted in
`surfaces.test.ts`, because that is the property the whole design rests on.

The accent treatment takes `--accent-contrast` for its ink, computed rather than
chosen, for the reason the accent itself does: a pale accent needs dark text and
a workspace that could choose would be a workspace that can make a rail nobody
can read. Its muted and hover values mix into `--accent` itself and never into
`transparent` — a mix with transparent pulls towards black, so a faded white on a
pale accent comes out grey (the trap `brand.test.ts` records).

### Corners are three steps, and they move together

`sharp` / `soft` / `round`, setting `--sone-radius-sm`, `--sone-radius` and
`--sone-radius-lg` at once. The relationship between the three is the design: a
small control with a large radius reads as a pill by accident. `soft` is what the
design does today and is therefore stored as nothing, the rule `follow` follows.

### A bug this found

`clearTheme` removed properties beginning with `--sone-theme-`, and
`themeProperties` has always also emitted `--accent`, `--accent-contrast` and
`--sone-palette-*` — which were therefore set and never removed. Leaving a
workspace that had chosen an accent for one that had not left the first one's
accent on the page until a reload.

Found by asking what the *setter* can produce rather than by looking at the
remover, and the test is written the same way round: every property name
`themeProperties` emits has to match one of the prefixes the remover knows.

## Consequences

**Eleven core tests and three web ones.** The core ones are about what a theme
may say and what it becomes; the web ones are about the mechanism, which is the
part a later tidy-up would break without noticing.

**A theme can now make two instances look genuinely different**, which was the
request. A dark rail beside a light sidebar and a white page is one stored word.

**Hover inside a treated surface follows it**, which needed a fifth property per
treatment. Without it an inverted rail kept the light theme's hover colour and
handed it the light theme's text: white on near-white, on hover only.

**Still stored per workspace and still not per person.** Somebody who dislikes an
inverted rail cannot turn it off, the same way they cannot turn off a workspace's
accent. That is the next step in the concept — the instance/workspace/person
resolution — and it will apply to these as it applies to the rest.

**Still to come from the concept:** instance branding, export and import of a
whole theme, the curated font pairs. This is the piece the last two hang off:
exporting a theme is exporting these values, and an instance's base design is
these values with nothing above them.

## Alternatives considered

**A colour per surface.** What was asked for, almost word for word, and it is the
thing that breaks in the dark. What the request actually wanted — a dark rail and
a light rest — is `inverted`, and it survives the reader's scheme, which a hex
value does not.

**A treatment on the page too.** One more entry in a list, and a workspace that
can decide whether its members read on white. `prefers-color-scheme` exists
because that is not a decision an author gets to make.

**A `data-` attribute per surface instead of custom properties.** The rail would
carry `data-treatment="inverted"` and the stylesheet would hold the five
combinations. It reads more clearly, and it puts the theme back in the DOM: the
attribute has to be set by a component, so a piece of furniture rendered
somewhere new is a piece of furniture that forgets. Properties on the root are
already how a theme reaches the page, and this keeps one mechanism.

**Separate radii.** Three controls instead of one, and a workspace that can break
the relationship they express on purpose. Nobody asked for it, and the step scale
exists precisely so the proportions hold.
