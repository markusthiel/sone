# ADR-0192: The trash is in the document

## Status

Accepted. Built. The archive half of what ADR-0185 stated.

## Context

A page put in the trash sometimes came back into the tree — and deleting it
again did not always keep it there.

ADR-0185 made the page's structural keys the server's to write and listed
`archivedAt` among them: "changed only by a server operation — the HTTP move,
reorder, create, archive and restore routes". The move route does write the
document, and says why in a comment: "the parent lives in the CRDT, so
writing the projection would be undone by the next materialisation and the
move would silently revert." The archive route did not. It wrote
`archived_at = now()` to the rows of the page and its descendants, and nothing
to any document.

The projection is rebuilt from the document. `materializeDocument` writes
`archived_at = <the document's archivedAt>`, which for those pages was
nothing. So the next materialisation of any of them — from a tab still open
on the page (a keystroke, a cursor, a comment), from a sync update by
somebody else, from the maintenance pass — set the row back to `NULL` and
the page reappeared. Deleting it again wrote the row again; the document
still said nothing; it came back again. Which page came back depended on
which one happened to be materialised, which is why it looked random.

The restore route had the mirror image: it wrote the document's parent when
restoring into a folder, but cleared `archived_at` on the rows only, so a
page whose document had somehow acquired `archivedAt` would have been
re-trashed by its next materialisation. That case could not arise while
nothing wrote the key — it can now, and it is handled.

## Decision

**Archive and restore write the document first, then the row.**
`setArchivedInDocuments` sets `archivedAt` (or deletes it) in the page's
document and in every descendant's, found through `ancestor_ids` — the same
set the row update uses, so the two agree about what "the subtree" is. The
row update follows, for the tree to change at once rather than after a
projection. A later materialisation of any of these documents now writes the
same answer the route wrote.

A database test trashes a folder, edits a page inside it so that page is
projected again, and asserts it is still in the trash; then restores and
asserts the same the other way round. It fails on the row-only route.

## Consequences

Trashing sticks. Restoring sticks.

Trashing a folder of sixty pages is sixty document updates where it was one
row update. Each is small — one key in one map — and a projection that
agrees with its documents is worth that; the row update still makes the tree
change immediately.

Pages trashed before this release have rows that say "archived" and
documents that say nothing, and will come back on their next
materialisation exactly as before. Trashing them again, on this release,
writes the document and settles it.

## Alternatives considered

**Make the materialiser keep `archived_at` when the document has no
opinion.** It would hide this fault and make the projection something other
than a projection: a row that carries state its document does not is a row
the rebuild cannot reproduce, which is the property ADR-0002 exists for.

**Leave `archivedAt` out of the document and out of the materialiser
entirely, a row-only fact.** Then the page's history would not know it was
trashed, a restore from an older version would have to guess, and the
export's "what is archived" would come from a different place than
everything else about a page. ADR-0185 had already decided it is a document
key; this record only makes the route agree.
