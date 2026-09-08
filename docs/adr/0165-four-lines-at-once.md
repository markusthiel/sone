# ADR-0165: Four lines at once

## Status

Accepted. Built.

## Context

Reported with a screenshot of four selected lines and the toolbar over them:

> Wenn ich mehrere Zeilen Text markiere würde ich diese gerne auch im Verbund
> umwandeln können. Ich habe diese 4 Zeilen jetzt markiert und würde sie gerne zu
> einer Aufzählungsliste umwandeln. Das geht bisher nur einzeln.

`toggleBlockType` read `currentBlock(state)` — the one block the selection's
*head* is in — and changed that one. Every door to it inherited the limit: the
shortcuts, the block menu's "Turn into", the `/` menu.

Its sibling `setBlockStyle`, thirty lines away and reached from the same menu,
has always walked `nodesBetween(from, to)`. **The block menu was answering its
two questions about the same four lines at two different scopes**, and only one
of them was written down anywhere.

## Decisions

### The command acts on every block the selection covers

The schema is flat (ADR-0018): a bullet is a block type, not a list wrapping
items. So converting four lines is four `setNodeMarkup` calls and no tree
surgery at all — which is why this is a small change and not a rewrite.

**Top level only, and it does not descend.** A paragraph inside a table cell
belongs to the table; turning the cells somebody dragged across into bullets is
not what "these lines" meant.

**A block that holds no inline content is stepped over.** A divider in the
middle of the selection is not a line of writing, and refusing the whole
conversion because one is in the way is a command that does nothing for a reason
nobody can see.

**A selection inside one block keeps the old path exactly**, `currentBlock` and
all — that one climbs *out* of a table cell to the block it is in, which the
walk deliberately does not do.

### Made the same, rather than each one flipped

Two bullets and two paragraphs, asked to be a bullet list, become four bullets.
Flipping each block on its own would swap the two kinds and leave the selection
exactly as mixed as it was — pressing *bullet list* and getting a **different**
mixture is the one outcome nobody is asking for. It turns back only when every
selected block is already that type.

### The menu had to stop rescuing the caret

The block menu ran the command through this:

```tsx
// Restore the caret into the block first: the type change acts on the
// selection, and a tap may have moved it.
const $pos = view.state.doc.resolve(range.from + 1);
view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
```

Written for touch, and correct for one block. With four selected it threw three
of them away *before* the command could see them — so the command could have
been right all along and the menu would still have converted one line.

It now restores the caret only when the selection is inside a single block. **A
selection that spans blocks is the answer to "which blocks", not something to
recover from.**

### And it asks the right question about "several"

The obvious guard was the menu's own `size`, which is already used for its
label — *„3 Blöcke"*. It is the wrong number: `selectedBlockRange` is a block
**and its indented children** (ADR-0018), which is the right answer for
dragging, indenting and duplicating, and says nothing about what is selected. It
is larger than one for a bullet with sub-bullets and equal to one for four
selected paragraphs — wrong in both directions.

So `blocksInSelection` is exported from the editor and both the command and the
menu ask it. One question, one answer, and the menu cannot disagree with the
command it is about to run.

The same helper decides which type is marked current: every block it will act
on, not the first. Marking it from the first of four would say *these are
bullets* about a selection that is one bullet and three paragraphs.

## Consequences

**Seven tests, headless**, because every question here is about a document: what
four blocks became, what happened to the one in the middle that cannot hold
text, and whether the ids survived. Three more hold the menu's half.

### The test that caught the mistake I actually made

`spanned.every(isThisType)` — where `spanned` holds `{node, pos}` pairs and the
predicate takes a node. It reads `undefined === type`: false for everything,
forever. So *turning back* silently stopped working while turning **on** kept
working perfectly, and four of the six tests stayed green.

The one that failed was "pressing it again turns all four back". A round that
had only tested the forward direction would have shipped a toggle that is a
one-way trip.

### Ids and indents survive, one per block

A type change is not a new block — four new ids would orphan every comment,
every link and every outline entry pointing at them, four times over. Each block
keeps its own indent as well: four lines at three depths are still at three
depths afterwards.

## Alternatives considered

**A "turn into" control in the selection toolbar.** It is where somebody with
four selected lines is looking, and it would be a second copy of the type list —
two menus that have to agree about ten block types and their names. The handle
beside the selection already offers it, and this round makes it work. Worth
revisiting if the handle turns out to be hard to find with a selection across
several lines.

**Flip each block independently.** Turns a mixed selection into a differently
mixed selection.

**Refuse when the selection contains something that cannot be converted.** The
command would do nothing for a reason nobody can see, on a selection that looks
entirely convertible.

**Descend into containers.** Then dragging across a table turns its cells into
bullets, which is the one thing "these lines" cannot have meant.
