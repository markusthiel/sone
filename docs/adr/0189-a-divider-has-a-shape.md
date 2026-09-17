# ADR-0189: A divider has a shape

## Status

Accepted. Built. Shares document format 7 with ADR-0188.

## Context

A divider was one thin grey line. It could be wide or full and it could take a
block colour — which did nothing, because the browser gives an `hr` a grey
`color` of its own and the line was drawn in the border colour regardless.

A line between two sections is the oldest piece of page furniture there is,
and printers have never been content with one kind: a section break in a
novel is a short centred rule or three stars; a chapter ends on an ornament;
a form is cut along a row of upright strokes. People asked for the same range
here — dashed, dotted, a symbol at the start or in the middle.

## Decision

**Three attributes on the divider**, each a closed set in `@sone/core`, each
with its default stored as the attribute's absence, the way ADR-0188 stores
`note`:

- `rule` — how the line is drawn. `DIVIDER_RULES`: `solid` (default),
  `dashed`, `dotted`, `double`, `thick`, `fade` (present in the middle, gone at
  the edges), `short` (a third of the column, centred), `wave`, `bars`
  (upright strokes, one every four pixels).
- `ornament` — a symbol on the line, or none. `DIVIDER_ORNAMENTS`: six
  geometric marks (`dot`, `diamond`, `ellipsis`, `asterism`, `circle`,
  `square`), six from nature and the sky (`leaf`, `star`, `sun`, `moon`,
  `wave`, `flower`), six playful (`heart`, `coffee`, `anchor`, `quill`,
  `scissors`, `arrow`), and the twelve callout tones — so a page can end a
  section with the same triangle its warnings wear. Thirty in all.
- `ornamentAt` — where the symbol sits. `DIVIDER_ORNAMENT_PLACES`: `start`,
  `center` (default), `end`. Cleared when the ornament is cleared: no symbol,
  no place for it.

**The symbol is in the DOM, drawn once.** As with the callout tones, `toDOM`
renders the symbol as an inline SVG beside the `hr`, from path data in
`dividerOrnaments.ts`; the twelve tones reuse `CALLOUT_TONE_PATHS` rather than
being drawn twice. The web package builds its menu icons from the same paths.

**One set of rules, two places.** Every stylesheet rule matches
`:is([data-block='divider'], .divider-preview)`. The block menu draws each
line choice as a `.divider-preview` carrying the same `data-rule`, so the
button *is* the line it stands for — not a word, and not a second drawing that
could drift. The preview does not carry `data-block`, which the editor's own
code treats as "a block of the document".

**Two colours.** The line is `--divider-color`: the border colour, or
`currentColor` when the block has a colour — and `hr { color: inherit }`,
because the browser's own grey would otherwise be what `currentColor` means.
The symbol is `--divider-mark-color`: muted text by default, since a symbol in
border grey is a symbol nobody sees, and the block's colour when there is one.

**The wave is a mask, the bars a gradient.** Both take their colour from
`--divider-color`, so they follow the theme and the block colour exactly as a
border does. The wave's drawing is one 24×8 tile in the stylesheet; it exists
nowhere else, so nothing can disagree with it.

**`***` typed is an asterism.** The input rule already turned `***` into a
divider; it now turns it into the divider that `***` has meant in print for
three hundred years. `---` stays plain. The Markdown importer does the same.

**Markdown round trip.** A divider is `---` for every reader. One with a shape
gets an HTML comment on the next line — `<!-- sone-divider {"rule":"dashed"}
-->` — which Markdown renderers drop and our importer reads back. A fence
would have been the existing mechanism, and would have turned every decorated
rule into a code block in anyone else's reader.

**Format 7, not 8.** The attributes would be stripped by an older editor for
the reason ADR-0188 gives, and they arrived in the same unreleased version, so
they share its step.

## Consequences

Every existing divider is unchanged. A block colour set on a divider now does
what it always looked like it should.

The block menu's appearance section for a divider has grown: nine line
previews in three rows, thirty-one symbol buttons in six columns, and three
places that appear only once a symbol is chosen. That is a lot of menu, and it
is the reason the choices are pictures — thirty words would not fit and would
say less.

Consecutive dividers with symbols get four pixels of padding each so their
margins do not collapse into one another; a page that stacks dividers is
unusual, and this keeps it from being ugly.

Adding an ornament is a word in `DIVIDER_ORNAMENTS`, path data, and two
translations. Adding a rule is a word in `DIVIDER_RULES`, one CSS rule, and
two translations. Nothing else has a case per value.

## Alternatives considered

**Rule and ornament as one attribute.** A single `style` with values like
`dashed-star-start` is a combinatorial list nobody can name in a menu. Three
orthogonal choices are three small menus, and every combination is reachable.

**Symbols as text.** `⁂`, `❦` and `✂` exist as characters, and a
`content: '⁂'` rule is one line. But glyph coverage differs per operating
system — the fleuron is missing on more machines than it is present — and a
glyph cannot be drawn in the set's stroke. The same arithmetic as the tones.

**Line styles as separate blocks.** A "dashed divider" block and a "wave
divider" block would each need a `/` entry, an icon, a Turn-into row and an
export spelling, and a divider could not change its mind. One block with a
shape can.

**Nothing.** A single grey line is defensible, and it was the decision until
somebody asked. The request was specific and came with examples; the
alternative was to say no to a thing that costs an attribute.
