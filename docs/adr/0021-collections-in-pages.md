# ADR-0021: A collection is a block in a page, and its rows are hidden documents

## Status

Accepted. Replaces the shape shipped in 0.2.0.

## Context

0.2.0 made a collection out of a folder: the folder *was* the table, and every
page inside it was a row. That was wrong, and the report that found it was one
sentence — "a folder should be a folder".

It is wrong for two reasons that are worth separating.

**A folder stopped meaning one thing.** Adding columns to a folder changed what
it was. Somebody looking at the tree could no longer tell whether a folder
organised their notes or held records, and the same act — dropping a page into
it — meant "file this here" in one case and "create a record" in the other.

**Rows were in the tree.** A hundred-row table put a hundred entries in the
sidebar. The sidebar is for things somebody navigates to; rows are things
somebody scrolls past.

Three tools that solve this were read before deciding:

- **Craft** puts a collection *inside* a document, several per document if you
  like, and each entry can have sub-pages of its own.
- **AppFlowy** creates a grid inside a page with `/`. Every row is a page you can
  open, and rows do not appear in the sidebar.
- **AFFiNE** goes furthest: a database is a block, and a group of existing blocks
  can be converted into one.

All three agree on the part SONE got wrong. A collection is *content*, not a
container in the tree.

## Decision

**A collection is a block in a page.** The `collectionView` node has existed in
the schema since the first draft, carrying `collectionId`, `viewId` and
`display`; it was never rendered because the folder shape was built instead. It
is what a collection is now.

A page may hold several, as in Craft. So the page document's `collection` map is
keyed by collection id rather than describing a single one. A document written
under the old shape still reads: an unkeyed map is taken as one collection whose
id is the page's own, which is exactly what 0.2.0 stored.

**A row is a document with `kind: 'row'`.** It is a real page — openable, with
its own body, its own blocks, its own sub-content — because that is the whole
reason rows are documents rather than table cells. Craft and AppFlowy both make
this choice and it is the difference between a note tool with tables and a
spreadsheet with prose.

The tree does not show rows. `kind` already separates `page` from `folder`
(ADR-0019); this adds a third value and the tree filters it out. The rule stays
one sentence: **folders organise, pages hold writing, rows belong to a
collection.**

A row's document names its collection in `page.collectionId`. That field existed
and nothing wrote it — this is what it is for. A row's `parentPageId` is the page
holding the collection, so ancestry, permissions and sharing continue to work
without a second mechanism: a row is inside the page it appears in.

## Consequences

Everything built for collections stays: columns and their types, values on the
row's own document, select options, filters, sorting, the table and the board.
What changes is where a collection lives and whether its rows appear in the
tree.

The folder-as-collection path is removed rather than kept beside this one. Two
ways to do the same thing are worse than one wrong way — the wrong way at least
teaches you something.

Permissions need no new case. A row is inside a page, so whoever may read the
page may read its rows, and a share link covering the page covers them.

Trash needs care and does not get a special case either: archiving a row hides
it from its collection the way archiving a page hides it from the tree, and
restoring puts it back. A row whose page is deleted goes with it, which is right
— a record with no table is not a note somebody wanted.

The cost is a third `kind`, and with it a third answer to "what is this thing".
It is worth it because the alternative was a folder with two meanings, which is
one answer too many for a thing people navigate by.

## Alternatives considered

**Rows as ordinary pages, hidden by a flag.** Rejected: a flag on a page is a
fourth state to reason about everywhere pages are handled, and it would let a row
exist without a collection. A `kind` is checked in one place — the constraint —
and cannot drift.

**Rows as blocks in the containing page, as AFFiNE does.** Rejected for this
project: ADR-0004 already says rows as editor nodes collapse past a few thousand
entries, which is the size a collection is for.

**Keeping the folder shape as well.** Rejected above.
