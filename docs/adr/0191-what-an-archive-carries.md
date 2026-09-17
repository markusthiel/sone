# ADR-0191: What an archive carries

## Status

Accepted. Built. Extends ADR-0044 and closes the limit it declared.

## Context

After ADR-0190 fixed the pages that vanished, the same import was checked
block by block against what had been exported. The list of what did not
survive the trip through our own archive was longer than the list of what
did:

- **Every picture.** An image block stores its file as an address,
  `/api/files/<id>`, in `url`; it has no `fileId`. The exporter read a `fileId`
  and wrote `![alt]()` — a frame around nothing — and the file was never put
  in `attachments/`, because the archive builder collected files from the same
  missing key.
- **Every heading's size, every ticked task, every code block's language,
  every toggle, every file block.** The importer wrote everything it read into
  the `props` JSON. y-prosemirror builds a node from the element's
  *attributes* and never opens `props`, so `level`, `checked`, `language`,
  `url`, `fileId` and the rest were written where nothing reads them. A
  heading arrived at the default size, a done task arrived open, a picture
  arrived as an empty frame even when its file had been uploaded.
- **Every mark.** Bold, italic, strikethrough, inline code and links were not
  in the export at all — the exporter wrote the flattened plain text — and the
  importer, by its own honest declaration, did not read them.
- **Block colour, alignment and width.** The three shared presentation
  attributes had no spelling in either direction. A paragraph somebody had set
  in red arrived black.
- **Cover, width, template flag, lock.** Page-level, and not carried.

ADR-0044 had drawn the line at inline marks deliberately: a Markdown inline
parser is a second parser, with decisions about overlapping ranges, and a
first pass that lost no words was better than one that lost words into marks
read wrongly. That was the right first pass. It is not where the line should
stay once people export a workspace to move it.

## Decision

**Node attributes are written as attributes.** `BLOCK_NODE_ATTRS` in
`@sone/core` lists, per block type, which keys are ProseMirror node attributes
(`heading: ['level']`, `image: ['url','alt']`, `file: ['fileId', …]`, and so
on); `SHARED_NODE_ATTRS` lists the three every block has. The importer places
those on the Yjs element, with the type they have — a level is a number,
`checked` a boolean, which is what the editor writes and compares against —
and puts only the rest into `props`. An editor test holds the table to the
schema, so an attribute added to a node without listing it is a failing test
rather than an import that loses it.

**A picture's file is read from its address.** `fileIdFromUrl` recognises
`/api/files/<id>`; the exporter writes `![alt](attachments/<id>)` and the
archive builder collects the file. A picture that lives elsewhere on the web
keeps its address. On import the mapped file becomes `url:
/api/files/<new id>` on an image block and `fileId` plus the type and size the
upload detected on a file block.

**Marks are spelled and read.** `inlineMarkdown.ts` in `@sone/core` speaks the
shape y-prosemirror stores — delta ops whose attributes are keyed by mark name
— in both directions: `**strong**`, `*em*`, `~~strikethrough~~`,
`` `inlineCode` ``, `[link](href "title")`, and a mention as `@Name`. Literal
`*`, `_`, `` ` ``, `~`, `[` and `\` in prose are escaped on the way out and
unescaped on the way in, so a sentence about `*pointers` is not a sentence in
italics after a round trip. The reader is small and deliberate, not
CommonMark: `*` and `_` open only before a non-space and close only after
one, `_` inside a word is a letter, an opener with no closer is a character,
and inside inline code nothing is Markdown. The block tree carries the result
as `markdown` beside `text`; the exporter writes it for prose blocks and the
importer reads it back into a Y.XmlText delta.

**What Markdown cannot say goes in a comment under the block.** The same
mechanism ADR-0189 and ADR-0190 chose, for the same reason: renderers drop it,
our importer attaches it to the block above. `<!-- sone-block {…} -->` carries
the shared presentation attributes for any block, and for a toggle and a file
block the truth about what they are — a toggle is a bold line in Markdown,
which a bold paragraph is too; a file is a link, which a link is too. Nothing
to say, no comment.

**The entry comment carries more.** `<!-- sone-entry {…} -->` now holds the
cover (a picture cover names its file the way an image block does, and is
uploaded with the page's other files), the width, the template flag and the
lock, beside the icon ADR-0190 put there.

## Consequences

A page exported and imported through our own archive comes back with its
headings at their sizes, its tasks ticked, its pictures and files present, its
emphasis and links intact, its coloured paragraphs coloured, its toggles as
toggles, and its cover on. The list of what does not travel is now short:
comments, history, attribution, permissions — the things ADR-0044 named as
facts about SONE rather than about the text — and a canvas's drawing, which
has no Markdown spelling and would be a fence of its own.

Other tools' Markdown reads better too: `**bold**` from Obsidian is bold
here, and a link is a link.

Archives written before this release import as they did, minus nothing: the
comments are new lines the old importer never saw, and the old exporter never
wrote them.

The one thing the inline spelling cannot carry is a backtick inside inline
code. It is left as it is.

## Alternatives considered

**Keep marks out, as ADR-0044 decided.** Defensible for a first pass and not
after: the archive is how a workspace moves between instances, and a move
that drops every link is not a move.

**A CommonMark library.** Correct on every edge case and a dependency that
would also have to be taught the delta shape on the way in and the escaping
rules on the way out. The reader here is under two hundred lines, speaks
exactly the spellings the writer writes, and is tested against them.

**HTML for what Markdown lacks** — `<span style="color:red">` for a coloured
paragraph, `<details>` for a toggle. Renders in some places, appears as tags in
others, and would need an HTML reader on the way back. A comment renders
nowhere, which is the point.

**Write every prop as an attribute.** The importer could skip the table and
put everything on the element; ProseMirror ignores attributes the schema does
not declare. But y-prosemirror *removes* undeclared attributes on the next
write-back, so the document would be noisy for one edit and then quietly
different, and the table was already what the schema knows.
