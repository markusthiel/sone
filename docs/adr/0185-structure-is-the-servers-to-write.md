# ADR-0185: A page's structure is the server's to write

## Status

Accepted. Built. Closes the half of the external review's F09 that ADR-0182 left
open: there, the materialiser stopped *breaking* on a bad parent (the cycle that
hung the projection); here, the sync room stops *accepting* a structural change
a client is not allowed to make.

## Context

ADR-0002 makes the document the truth and the relational tables a projection of
it. A page's placement lives in the document too: `parentPageId`, `idx`, `kind`,
`collectionId`, `archivedAt` are keys on the `page` map. The materialiser copies
them into the `pages` table, and permission inheritance (ADR-0006, ADR-0110)
reads the ancestor path built from `parentPageId`.

Every legitimate change to those keys goes through an HTTP route — the move,
reorder, create, archive and restore routes — each of which authorises the
operation: the move checks write access to the target folder and the folder rule
(ADR-0019), and none of them lets an editor move a page somewhere they could not
otherwise write. The editor never writes these keys directly; the client's Yjs
writes to the page map are the title and the cover, and nothing else.

But the sync path did not know that. `handleSyncMessage` applied any update from
a writer to the whole document, structural keys included. So an editor could set
`page.parentPageId` over Yjs and move a page past the checks the HTTP route
makes — into a folder they cannot write, out of a restricted section, or (before
ADR-0182 bounded it) into a cycle. ADR-0182 stopped the cycle from hanging the
projection, but the move itself still landed.

The confidentiality gain from this is small — the page moved is the editor's own,
already-writable page, and caps and restrictions on the *target* still apply, so
it cannot lift content out of a section it could not already read. What it defeats
is the authorisation on the move: sharing by placement without the right to
share, and reordering or re-parenting where the HTTP route would say no. It is
worth closing because "the document is the truth" cannot also mean "any writer
may write any part of it": some of the document is the server's.

## Decision

**Treat the structural keys of the `page` map as server-owned, and undo a client
update that changes one.** `handleSyncMessage` snapshots those keys before
applying a client's update and compares them after; if one changed, it is written
back in a `'server'`-origin transaction. That correction is persisted like any
other write and fans out to every subscriber — including the client that sent the
change, whose optimistic move snaps back — because the fan-out skips only the
transaction's origin, and `'server'` is no subscriber.

The guarded keys are exactly the five that carry placement and identity:
`parentPageId`, `idx`, `kind`, `collectionId`, `archivedAt`. The title and the
cover — the two keys the client legitimately writes — are untouched, so an
ordinary edit is unaffected. Internal-comment documents have no page map and are
skipped.

The server's own writes do not come through this path: the HTTP routes write via
`applyToDocument` against their own document and their own authorisation, so the
guard sees only client updates, for which the answer is always "these keys are
not yours".

This is the second line, not the only one. ADR-0182 already makes the
materialiser refuse a cyclic or cross-workspace parent, so even an update that
somehow reached the projection could not hang it. This stops the change at the
room, before it is ever stored, which is where an unauthorised move should be
stopped.

## Consequences

An editor can no longer move, reorder, re-parent, retype, re-collection or
archive a page by writing its document over sync; those operations go through the
HTTP routes that authorise them, as they always did in the client. A buggy client
that writes a structural key is corrected rather than believed, and sees the
correction immediately.

`sync.db.test.ts` gains a test that syncs a local document from the server (so its
write causally follows and would otherwise win), sets `parentPageId` to another
page and the title in the same update, and asserts the parent is back to null
after the flush while the title stands — the guard undoing the one and not the
other.

## Alternatives considered

**Reject the whole update.** Dropping a client message because it touched a
structural key would also drop the legitimate title or cover change riding in the
same Yjs update — client updates batch a transaction's worth of changes. Reverting
just the structural keys keeps the honest part of the edit and undoes only the
part that was not the client's to make.

**Rely on the materialiser alone (ADR-0182).** That bounds the damage — no hang,
no cross-workspace corruption — but the move within a workspace still lands in the
stored tree until something else notices. The authorisation on a move belongs at
the point the move is attempted, not at the projection that reads the result.

**A separate structural document the client never opens.** The clean long-term
shape: placement would not be in the editable document at all. It is a much larger
change to the sync model, the client, and the materialiser, and the guard closes
the hole without it. Left as the direction, not this change.
