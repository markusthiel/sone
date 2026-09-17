# ADR-0188: A callout says what kind it is

## Status

Accepted. Built. Document format 7.

## Context

A callout was one box in one grey. The `/` menu offered "Callout", the block
menu offered its width and a text colour, and that was the whole vocabulary.
Anybody who wanted a warning to look like a warning coloured the words red —
which is the wrong lever twice over: colour on the words says nothing about
the box, and a page with five callouts in five text colours is five decisions
the reader has to decode before reading a single one of them.

Two vestiges in the server showed the intended shape had been thought of and
never built: the Markdown exporter read a `tone` from the callout's props and
wrote `Note` when it found none, and the search projection indexed an `emoji`
nobody ever wrote.

A quote had a related gap: a quotation with nobody's name under it. People
wrote the attribution as a second paragraph and aligned it right by hand.

The third thing this record covers arrived with the SOTE integration
(`docs/sote-integration.md`): the two SOTE task blocks stood in every `/` menu
on every instance, including the ones with no SOTE server registered. Inserted
there, the block showed a box asking for a connection nobody could make. A
menu entry for a thing that cannot work teaches people the menu promises
things it cannot do.

## Decision

**A callout carries a tone.** `CALLOUT_TONES` in `@sone/core` is a closed set
of twelve words — `note`, `info`, `tip`, `warning`, `error`, `alarm`,
`exclaim`, `question`, `success`, `memo`, `example`, `quote` — stored as a
first-class attribute `tone` on the callout node. `note` is the neutral one and
is stored as the attribute's *absence*, like a cleared colour: a callout that
says "note" out loud could not follow a design that later decides what a plain
callout looks like, and every existing callout keeps looking the way it did.

**The tone decides the box, not the words.** The stylesheet reads `data-tone`
and sets one custom property, `--callout-tone`, from a per-tone token
(`--sone-tone-*`, one value for the light theme and a lighter one for dark).
The background is a tenth of the tone mixed over the page, the symbol at the
end of the box is the tone itself, and the text keeps `--sone-text` — or the
block colour somebody chose, which continues to work independently. Error and
alarm are both red on purpose, because an alarm is an error that cannot wait;
alarm is told apart by depth (a sixth of the tone) and a bar.

**The symbol is in the block's DOM, not in the stylesheet.** `toDOM` renders
the callout as `<aside data-tone>` containing a `.callout-body` wrapper around
the words and a `.callout-mark` holding an inline SVG, `contenteditable=false`
and `aria-hidden`. The path data lives once, in `calloutTones.ts` in
`@sone/editor`, and the web package builds its menu icons from the same paths.
The alternative — twelve SVG data URIs in CSS `mask-image` rules — would be a
second copy of every drawing, and the menu a third.

**Names, not colours or icons.** Like block colours, a tone is a word. A word
survives a theme change where a stored hex cannot, and an icon renamed is a
migration.

**Two ways to choose one.** Each tone but `note` has its own `/` entry, in a
group of its own ("Callouts") so that somebody typing `/` for a table does not
scroll past a wall of coloured boxes; every entry carries the keyword `callout`
so typing that word lists the family. The block menu's appearance section
shows the twelve symbols in their colours, for changing the tone of a callout
that already exists. `setBlockStyle` gained `tone` and writes it only to blocks
whose type declares the attribute, so toning a mixed selection tones the
callouts in it and leaves the paragraphs alone.

**A quote carries a source.** A first-class attribute `source`, free text,
rendered by the stylesheet as one quiet line under the quote with a dash
before it. An attribute rather than a second text region because a quote is a
flat inline block (ADR-0018) — a block cannot hold both inline text and a
child block — and because the source is not part of the quotation: it is not
searched as the speaker's words and not continued by Enter. Set from a text
field in the block menu; an empty field removes it.

**Document format 7.** Both attributes are optional, and the rule in
`types/ids.ts` says an optional field does not warrant a bump. That rule is
about fields nothing erases. y-prosemirror writes a node back by comparing its
ProseMirror attributes with the shared element's and *removes* every shared
attribute the node does not have — so an editor whose schema predates `tone`
builds the callout without it, and its first keystroke in that callout deletes
the tone for everybody. The version fence is what keeps that editor out; the
migration step itself changes nothing, like the six before it.

**Markdown round trip.** The exporter writes a callout as a blockquote whose
first line is the tone's English label in bold (`> **Warning**`), from
`CALLOUT_TONE_LABELS`, and a sourced quote with the source as a last line after
a dash (`> — Somebody`). The importer reads both shapes back; a bold first line
that is not one of the labels stays part of the quote, because somebody
quoting a heading in bold did not mean a callout. The importer writes `tone`
and `source` as element attributes, where the editor reads them, rather than
into the props JSON.

**SOTE blocks only where a SOTE server exists.** `slashMenu` takes a second
argument, `offers(item)`, asked every time the list is built. The web package
answers it from `GET /api/integrations/sote`, asked once per page load and
cached; the answer starts as "no", so the entries are absent for the moment
before it arrives rather than present and then vanishing. Registering or
removing the server in the administration area forgets the cached answer. The
instance is the unit: once a server is registered, everybody sees the blocks,
including people who have not yet connected their own account — the block
then asks them to, which is a thing they can do.

## Consequences

Every callout on every existing page is unchanged: no tone means `note`, and
`note` is the old look. Opening a page after this release requires a reload
of every tab, as every format bump does.

A page's tones survive export and import, and a Markdown reader who has never
seen SONE reads `**Warning**` and understands.

The `[data-color]` text colours still apply inside a toned callout, so a
reader can end up with red words in a green box. That is a choice the design
permits rather than one it recommends; the tone is the lever people should
reach for, and the block menu puts it before the colour swatches for that
reason.

`--sone-tone-*` is a new token family — twelve tokens, two themes. A workspace
theme (ADR-0023) cannot yet override them; that is the natural next step if
somebody asks, and the property indirection is already in place for it.

The tone icons are drawn by hand in `calloutTones.ts`, on the same 24-unit
grid and stroke as `icons.tsx`. Adding a tone is: a word in `CALLOUT_TONES`,
a label in `CALLOUT_TONE_LABELS`, path data, two tokens, one `data-tone` rule,
three translations, and a `/` entry in `TONED_CALLOUTS`. Nothing else has a
case per tone.

## Alternatives considered

**A `tone` key inside `props`, no format bump.** This is where the exporter
was already looking. It would spare the reload — but `props` is an opaque JSON
blob the schema does not unpack, so the value could not reach the DOM without
a NodeView or a second parse in `toDOM`, and `BLOCK_ATTRS` says in so many
words that presentation the stylesheet acts on is a first-class attribute.
The exporter was reading from the wrong place; it now reads the right one,
which happens to arrive under the same key because the block tree merges
attributes into props.

**Emoji instead of a symbol.** Notion's answer, and the `emoji` vestige in the
projection suggests it was once the plan here. An emoji is a colour the theme
cannot touch, a glyph that differs per operating system, and a picker with
three thousand entries for a choice with twelve answers.

**An icon library.** Rejected long ago in `icons.tsx`, and nothing here changes
the arithmetic: twelve drawings do not justify shipping hundreds.

**The symbol via CSS `mask-image`.** Keeps `toDOM` a one-liner, at the price
of every drawing existing twice — once as a data URI in the stylesheet and
once as paths for the menus — with nothing to keep them the same.

**Free colour on the callout.** A colour picker for the box is "configurable"
in the sense `BLOCK_ATTRS` warns against: a document whose boxes carry
hand-picked colours cannot be restyled and looks wrong the moment somebody
switches theme. Twelve named tones are choices within a design.

**Hide the SOTE blocks per workspace or per person.** Per workspace — only
where projects are mapped — would hide the block from the workspace
administrator who is about to map one. Per person — only once their own
account is connected — would make the block undiscoverable to exactly the
people it should invite to connect. The instance is the one level where
"absent" means "cannot work" and nothing else.

**A feature flag in `/api/instance`.** That route answers before sign-in and
describes the instance to strangers; whether a SOTE server exists is a fact
for people who can edit. The status route already exists, requires a session,
and answers the question; asking it once and remembering costs one request.
