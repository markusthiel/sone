# ADR-0015: One ProseMirror fragment per page

- **Status:** Accepted
- **Date:** 2026-08-27
- **Corrects:** ADR-0002 (the block storage layout, not its principles)

## Context

The original document layout stored blocks as a flat `Y.Map` keyed by block id,
each block carrying a fractional index, plus a parallel `Y.Map` of block id to
`Y.XmlFragment` holding that block's inline text.

That was designed before looking closely at how a block editor actually binds
to Yjs, and it does not survive the encounter.

`y-prosemirror` binds one ProseMirror instance to one `Y.XmlFragment`. With a
fragment per block, that means an editor instance per block. Two consequences
follow, and the second is fatal:

1. Hundreds of editor instances on a long page, each with its own plugin state
   and DOM observer.
2. **Selection cannot cross blocks.** Select three paragraphs and press
   Delete — that is a selection spanning three editor instances, and every part
   of it has to be built from scratch: the selection model, the shared
   clipboard, undo across the boundary, drag between blocks.

Craft and Notion handle multi-block selection natively because they have one
instance per page. It is not a refinement to add later; it is the difference
between an editor that feels solid and one that feels broken from the first
week.

This was found before any data existed. `SCHEMA_VERSION` is still 1 and nothing
is released, so the correction costs a rewrite of one read path rather than a
migration with everything that entails.

## Decision

One `Y.XmlFragment` per page, at `DOC_KEYS.content`. The whole block tree lives
inside it as nested `Y.XmlElement`s, and ProseMirror owns it directly.

- Element node name is the block type.
- `id` attribute carries the block uuid, so a block is locatable without
  parsing.
- `props` attribute carries JSON-encoded block settings, because Yjs XML
  attributes are strings.
- Nesting is real nesting: a list item's children are child elements.
- Inline text is `Y.XmlText` children, as ProseMirror expects.

**Order within a page is element position.** Yjs resolves concurrent insertion
itself, so blocks carry no fractional index and there is no tie to break. The
materialiser derives a zero-padded depth-first ordinal for the `blocks.idx`
column, which is projection data rather than authored data.

Fractional indices remain where the ordered collection is *not* a single CRDT
sequence: the page tree, collection rows, fields and views. The `(idx, id)`
tie-breaking rule from ADR-0002 still applies there, and the fractional index
implementation is unchanged.

Traversal and construction live in `@sone/core`'s `blockTree.ts`, and it is the
only sanctioned way in. The editor, the materialiser and the tests must not be
able to disagree about where a block boundary is or how props are encoded —
which they could when each had its own loop.

Database blocks are still not editor nodes. A `collectionView` element is an
atom to ProseMirror; its node view mounts a separate renderer that queries the
materialised tables. ADR-0004's reasoning is untouched.

## Consequences

The editor gets multi-block selection, one undo stack per page, and drag
between blocks from the framework instead of from us. That was the point.

A container's plain text must stop at nested block boundaries, or the search
index scores a nested list once per descendant. The tree walker enforces it and
a test covers it.

Block ids are globally unique: `blocks.id` is the primary key, not
`(page_id, id)`. A client copying a block to another page must regenerate the
id. The server refuses a collision rather than silently reassigning, which is
the right failure — a silently reassigned id breaks every reference to it.
Found by a test that reused an id across two pages.

Depth is bounded at 32 levels. A malformed document cannot cause unbounded
recursion on the write path, and 32 is far past any usable nesting.

An element without an `id` attribute is skipped with a warning rather than
being treated as a block. This covers inline content that reached the top level
and node types the editor schema permits but SONE does not model.

What this costs: the block read path was rewritten, and `xmlFragmentToText`
moved from the server into core where the tree walk lives. Roughly a day of
earlier work discarded. Cheap compared with discovering it after the first real
document.

## Alternatives considered

**Keep the flat map, write a custom bidirectional binding.** Retains the
original layout and gives full control. Rejected: it means reimplementing
selection, clipboard and undo across block boundaries, which is a large
subproject with no upside over what ProseMirror already does.

**One editor instance per block, accept the limitation.** What several simpler
block editors do. Rejected: multi-block selection is table stakes for a Craft
alternative, and the limitation is structural rather than something to improve
later.

**Blocks as flat ProseMirror nodes with an explicit `parentId` attribute,
rather than real nesting.** Simplifies the tree walk. Rejected: ProseMirror's
schema, `liftListItem` and friends all assume real nesting, so flattening means
fighting the framework at every indent operation.
