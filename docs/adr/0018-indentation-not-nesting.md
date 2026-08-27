# ADR-0018: Indentation instead of nested text blocks

- **Status:** Accepted
- **Date:** 2026-08-27
- **Amends:** ADR-0015 (how nesting is represented, not the single-fragment decision)

## Context

ADR-0015 put the whole block tree in one `Y.XmlFragment` per page and said
"nesting is real nesting: a list item's children are child elements". The
single-fragment part was right and is unchanged. The nesting part is not
implementable.

ProseMirror rejects a node whose content mixes inline and block:

```
SyntaxError: Mixing inline and block content
  (in content expression 'inline* block*')
```

That is a schema-construction error, not a runtime edge case — the editor cannot
start. And it rules out exactly the shape ADR-0015 described: a list item that
has *text of its own* and *block children*.

ADR-0015 also rejected the flat alternative, on the grounds that "ProseMirror's
schema, `liftListItem` and friends all assume real nesting, so flattening means
fighting the framework at every indent operation". That reasoning was wrong on
its own terms: because list items here are not `ul`/`li`, `liftListItem` was
never applicable, and indent/outdent had already been hand-written before this
came up.

## Decision

Two mechanisms, separated by one rule: **a block type either has text, or holds
block children, never both.**

**Textual blocks are flat siblings carrying an `indent` attribute.** Paragraph,
heading, list item, todo, toggle, quote, callout, code. A block whose indent is
greater than its predecessor's is that predecessor's child. This is what Notion,
Craft and every outliner do.

**Structural blocks hold children as XML children.** Currently `columns` and
`column`. They qualify because they have no text of their own, which is exactly
the condition ProseMirror's rule cares about.

The two compose: indentation restarts inside a column.

`indent` is a first-class XML attribute rather than a key inside `props`,
because the tree reader needs it on every block and parsing JSON per block to
find it would be waste.

### Normalisation

A block may be at most one level deeper than the one before it. `readBlockTree`
clamps anything greater and records a warning; the editor's indent command
refuses to exceed it. Both halves are needed: without the clamp a buggy client
produces a parent that does not exist, and without the editor check the editor
would display an indent the server silently corrects.

### What this buys

Indent and outdent become attribute changes. The tree-based versions had to
delete a node and reinsert it at a computed position, and getting those
positions right across a nested structure is where list implementations
habitually break. The replacement is four lines and cannot be off by one.

It also allows things real editors allow and a strict tree does not: indenting a
heading under a paragraph, or a code block under a list item.

## Consequences

The parent-child relationship is now implied rather than structural, so it has
to be derived on read. `readBlockTree` does that with an indent stack, and its
output shape — `parentId`, `depth`, `position`, `childIds` — is unchanged. That
is deliberate: the materialiser, the renderer and every existing test kept
working, and the change stayed inside one function.

A collapsed toggle hides the following blocks with greater indent, rather than
hiding its children. Equivalent in effect, and it is how outliners behave.

Moving a block with its subtree means moving a run of following blocks with
greater indent. More work than moving one node, and it must not be done
naively — a drag implementation that moves a single block will silently reparent
its children to the block above.

`SCHEMA_VERSION` stays at 1: nothing is released and no documents exist.

## The honest part

This is the second correction to the document format in two days, both from the
same cause: designing the persisted shape before writing anything against it.
ADR-0015 fixed a mistake found by reading how `y-prosemirror` binds; this one
fixes a mistake found by ProseMirror refusing to build the schema at all.

Both corrections were free because no data exists. The lesson is not "write
fewer ADRs" — the reasoning in both is what made the mistakes visible and
cheap — but that a format decision should be validated against the library that
has to implement it before it is written down as settled.

## Alternatives considered

**A wrapper node per block**, holding a text-only child plus a children
container — the shape BlockNote uses (`blockContainer` = `blockContent`
`blockGroup?`). Legitimate and battle-tested. Rejected because it puts two or
three XML elements behind every visual block, which the projection, the plain
text extraction and every renderer then have to see through; and because the
flat form gives simpler indent operations for the same result.

**An inner `line` node inside each container**, so a container holds
`line block*`. Would have required no change to `readBlockTree` at all, since
its text extraction already descends into elements without a block id.
Rejected: it adds a node type whose only purpose is to satisfy a schema
constraint, and container conversion could no longer use
`textblockTypeInputRule`, so every markdown shortcut would have needed a custom
command.

**Keeping the tree and giving containers no text**, so a list item's text lives
in a child paragraph. Same objection as the wrapper, and it makes "the text of
this list item" a two-step lookup everywhere.
