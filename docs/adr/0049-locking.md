# ADR-0049: Locking a page, and locking a block

## Status

Accepted. The page lock is built. The block lock is decided here and not yet
built — the next slice.

## Context

A page that is finished gets edited by accident. A cursor lands in a table that
somebody was reading, a phone in a pocket types into a shared document, a
colleague scrolls with a finger on a paragraph. Everything in SONE is always
saved, which is the point — and the cost is that there is no moment at which a
document stops being editable.

The wanted behaviour is narrow and worth stating precisely: **read it, select it,
copy it, download its files, filter and sort its tables — but do not change its
text.**

## The first decision, because everything else follows from it

**A lock is a guard against accident, not a permission.** Anybody who may edit
the page may lift it, and the interface says so where the lock is set.

This is not a compromise, it is the only honest option. SONE's documents are
CRDTs: a client holds the document and streams changes into a room, and the
server merges them (ADR-0002). A server cannot refuse "an edit to a locked page"
without inspecting and rejecting parts of a CRDT update, which would mean the
clients and the server disagree about the document's state — the one thing the
whole architecture exists to prevent.

So a lock stops the interface from offering editing. It does not stop a
determined person with the developer tools open, and it never claims to.

**What actually restricts access is a permission** (ADR-0026): a viewer or a
commenter cannot edit whatever the lock says. A lock is for the person who *may*
edit and does not want to right now. Conflating the two would be the dangerous
outcome — somebody locking a page and believing it is protected from a colleague.

The interface therefore says "locked to prevent accidental changes" rather than
"protected", and the padlock is grey rather than a warning colour.

## Decisions

### The lock lives in the document

A `locked` flag on the page map, beside the title and the icon — not a column in
Postgres.

Because it has to arrive everywhere at once. A lock in the projection would reach
another person's open editor on their next reload, which is exactly when it
matters least: the accident happens while both are looking at the page. In the
document it arrives with the same mechanism their typing does.

It is projected to Postgres as well, for the tree to draw a padlock without
opening every document.

### What a locked page still does

Everything that is not changing its text:

- **Reading, selecting, copying.** A locked page is not a screenshot.
- **Downloading its files**, opening its PDFs, playing its videos.
- **Filtering, sorting and paging tables.** These are view state per person
  (ADR-0021), not content, so they were never edits.
- **Comments.** A locked page under review is exactly the case comments exist
  for, and a comment is *about* the page rather than part of it (ADR-0046).
- **Exporting**, favouriting, moving, renaming from the tree — the lock is about
  the page's contents, not about its place in the workspace.

And what it stops: typing, the slash menu, the block gutter, drag-and-drop of
blocks, pasting, and dropping a file onto the page.

### Renaming is not blocked, and that is deliberate

The title is a property rather than content, and a page whose name is wrong stays
wrong. Somebody who locks a page to stop a table being disturbed has not asked to
freeze its name.

### A single block can be locked too

`locked: true` in a block's props, set from the gutter menu where every other
per-block setting lives.

The case is narrower and real: a page that is mostly working notes with one table
of figures that must not move. Locking the page would stop the notes.

A locked block refuses typing, its gutter offers only unlock, and it cannot be
dragged. It can still be selected and copied, and a table inside it can still be
filtered.

### Where the controls are

- **A page**: in the entry's ⋮ menu, in its own group above the trash. Locking is
  consequential and reversible — which is the group the trash is in, and above it
  because it is the lesser of the two.
- **A block**: the gutter menu, with the other block settings. Not a floating
  padlock in a toolbar: a control that appears over the content is a control that
  covers the thing it acts on.
- **The tree** shows a small padlock on a locked entry, so a lock is visible
  before somebody starts typing rather than after.

## Consequences

No schema version bump was needed after all: the flag is a new key on the page
map, and an absent key already reads as unlocked. Adding a key that nothing older
reads is not a change to how a document is interpreted — which is the test
ADR-0002's migration chain applies. A Postgres column was added (0036) so the
tree can draw a padlock without opening every document.

Every write path in the editor has to consult one predicate rather than each
guessing. That is one function in the editor package, and the temptation to
sprinkle `if (locked)` through fifteen commands is the thing to avoid: a command
that forgot would be a hole nobody finds until a locked page changes.

A locked page still receives another client's edits, because a CRDT merges what
it is given. If somebody's laptop was offline with unsaved changes, those arrive
after the lock. That is the correct behaviour — losing them would be worse — and
it means a lock is a statement about intent from now on, not a fence around the
past.

## Alternatives considered

**Enforce it on the server.** Reject updates to a locked page's room. Rejected:
the server would have to decide which parts of a CRDT update are content, the
client would believe it had written what it had not, and the two would diverge —
which ADR-0002 exists to prevent. A rejected update is not a recoverable state in
this architecture.

**A permission instead.** "Nobody may edit this page" as a page permission. That
is a real feature and a different one: it is about *other people*, needs a screen,
and cannot be lifted by the person who set it without going back to that screen.
The lock is for the author's own hands.

**Read-only mode for the whole workspace.** Occasionally wanted, usually as part
of archiving, and it belongs with archiving rather than here.
