# ADR-0053: Comparing two versions

## Status

Accepted.

## Context

ADR-0047 built page history and deferred diffs with the note that word-level
comparison of ProseMirror documents "is not a small job and it needs the reading
view to exist first". The reading view exists. Somebody looking at Tuesday's
version can read it and cannot see what changed.

## The thing that makes this cheaper than it looks

Every block carries a stable id (ADR-0016). It survives edits, moves and
indentation changes.

So this is not a text diff. A text diff of two documents has to *guess* at
correspondence — the classic failure being a moved paragraph reported as a
deletion in one place and an insertion in another, which is the single most
common way a diff lies about what somebody did. Here the correspondence is
given: the same id is the same block.

That turns the hard part into bookkeeping:

- an id in the new version and not the old → **added**
- in the old and not the new → **removed**
- in both, text differs → **changed**, and only then is a word-level comparison
  needed, within one block
- in both, same text, different position → **moved**

A moved block is reported as moved rather than as a deletion plus an insertion,
which is the property a text diff cannot have and the reason this is worth
building on the block model rather than on rendered text.

## Decisions

### Computed on the server, from the two projections

Both states are already read there — the history route projects a version to text
(ADR-0047) — and the alternative is sending two whole documents to the client so
it can compare them. For a hundred-page document that is the archive twice.

### Word-level inside a changed block, and nothing finer

Words, not characters. Character-level diffing of prose produces the noise
everybody recognises from a bad diff view: half a word marked, then two letters,
then a space. Words are what people read and edit in.

Whitespace differences alone are not a change worth reporting.

### What is compared is the projection, so a mark is not a change

The projection is plain text (ADR-0002), so making a word bold does not appear in
a diff. That is a limitation and it is stated in the interface rather than left
to be discovered — "formatting is not compared" under the view.

The alternative is comparing the documents themselves, which means a second
comparison over Yjs formatting deltas and a decision about what "this word became
bold and moved" looks like. That is its own record if anybody wants it.

### The comparison is always against a *neighbour or now*

Two choices, not a matrix: **what changed since this version** (against now) and
**what this version changed** (against the one before it). An arbitrary pair
needs two pickers and answers a question nobody asked me for; these two answer
"what did I miss" and "what did this edit do".

### A diff of a page that has been restored reads correctly by accident

Restoring writes the old state forward as a new edit (ADR-0047), which means the
restored blocks keep their ids. So a diff across a restore reports what the
restore actually did — the blocks it brought back as added, the ones it removed
as removed — rather than "everything changed". That falls out of the id model and
is worth noting because it would be a nasty surprise the other way.

## Consequences

Blocks with no id cannot be matched, and the projection can contain them: a
document written by an importer or an older build. They are compared by position
as a fallback, which is the one place this behaves like a text diff — and the
place it can lie. The count of unmatched blocks is available so the interface can
say the comparison is approximate rather than pretending.

## What is deliberately not built

**A side-by-side view.** Two columns on a phone is one column, and the inline
form is what somebody reading a page wants. Worth adding for a wide screen later.

**Diffing a canvas.** Items have ids too, so the same approach applies —
positions, sizes and strokes rather than words. Its own piece of work.

**Blame, or "who changed this word".** Attribution is per character in the
document (ADR-0022) and the projection does not carry it. A different feature
with a different data path.
