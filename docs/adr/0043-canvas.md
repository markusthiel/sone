# ADR-0043: A canvas is a second kind of document

## Status

Accepted, and built. The shape below was decided before anybody wrote it, which is why the schema versioning survived four revisions of the feature.

## Context

Asked for: a whiteboard. A page you draw on freely, and place text, images and
other things anywhere on.

Everything in this application so far is a *sequence*: a document is a list of
blocks, a collection is a list of rows, a page is a list of pages. A canvas is
not. Two things on a canvas have no order at all — they have positions — and that
difference goes all the way down: to the schema, to how two people editing at once
merge, to what a search index can say about it, and to what "the same page on a
phone" even means.

So the question is not "can we build it" — yes — but what it *is*, because the
wrong answer here is expensive in a way a wrong button is not.

## Decisions

### A canvas is a page kind, not a block

`kind = 'canvas'`, beside `page`, `folder` and `row` (ADR-0019). Not a block
inside a document.

A canvas inside a document would inherit the column's width, the document's
scrolling, and a height somebody has to choose in advance — and a whiteboard whose
size is decided before anything is on it is a drawing surface with the one
property whiteboards do not have. It also puts an infinite plane inside a list,
which is the containment the rest of this record is trying to avoid.

The tree, the trash, permissions, sharing, moving between workspaces and search
all work on pages, so a canvas gets every one of them for free by being one.

### It is a Y.Map of items keyed by id, not a Y.Array

The document holds `canvas: Y.Map<Y.Map>`, each entry one item with its own
position, size and content.

A `Y.Array` is what a document uses, because a document has an order and two
inserts at the same point must both survive in some sequence. A canvas has no
order, and using an array for it would mean every move rewrites an element's
position in a list that means nothing — and two people dragging two different
things would produce a merge conflict about a sequence neither of them can see.

A map keyed by id makes the natural operations natural: moving is setting `x` and
`y` on one entry, and two people moving two items touch two keys and never meet.
Two people moving *the same* item is last-writer-wins on that key, which is the
honest outcome — there is no merge of "here" and "there" that is not simply one
of them.

### Z-order is a fractional index, like everything else here

Not an integer, and not array position. A fractional index (ADR-0006 already uses
them for siblings) lets "bring to front" be one key written on one item, with no
renumbering and no conflict with somebody else reordering elsewhere.

### A stroke is a finished thing, not a live one

Drawing produces a `path` item holding its points, written **once, when the stroke
ends**. Not point-by-point as the pen moves.

Sixty updates a second per stroke, multiplied by everyone drawing, is a CRDT log
that grows without bound and a sync channel that never quiets — and the document
would then carry the *history of the wrist*, which nobody wants and which cannot
be pruned without breaking the log. The stroke in progress is drawn locally and
sent through awareness (ADR-0022), which is ephemeral by design: other people see
it being drawn, and nothing is written until it is done.

### Text on a canvas is a text item, not a nested document

A canvas item holding text holds a `Y.Text` — the same collaborative text as a
paragraph, so two people typing in one box merge properly. But it is one text
field, not a document: no blocks, no nesting, no slash menu.

A whiteboard note is a label. Making it a document inside a document doubles the
schema, the migration story and the editor, to serve the case that is better
answered by linking to a real page — which a canvas item can do.

### Images are the same files as everywhere else

An image item carries a `fileId` (ADR-0029, ADR-0035). Not a data URL, not a
second upload path. The file is the workspace's, the byte-range serving already
works, and a picture on a whiteboard is the same picture as one in a page.

### Search sees a canvas as its text, in reading order that does not exist

The materialiser projects a canvas's text items into the search index, ordered
top-to-bottom then left-to-right. That order is a fiction — a canvas has none —
but a search result needs *some* order to show a snippet in, and reading order is
the fiction everybody already has.

Strokes are not indexed. A drawing is not text and pretending otherwise produces a
search result that cannot be explained.

### The schema version moves, and old clients are told

Adding a node type to a document is already known to be a format change that
older clients silently destroy — the video block proved it (ADR-0037), and the
lesson was recorded rather than acted on. A whole second document shape is the
point at which that debt has to be paid: `SCHEMA_VERSION` goes to 2, and
`isClientSchemaCompatible` is finally called during sync, so a client that does
not know what a canvas is refuses to open it instead of emptying it.

That check is a prerequisite of this feature, not a follow-up.

**Written before the code and corrected after it:** the check was already
enforced — a previous release bumped the version to 2 and calls
`isClientSchemaCompatible` in the handshake. What that did *not* cover is the
case this feature creates: the release before this one also called itself
version 2, so a browser holding yesterday's bundle passes the handshake and then
finds a page shape it has never met. "Same version, different format" is the one
mismatch a handshake cannot catch, so the version moves to 3 — not because the
persisted shape changed under an old client, but because the set of shapes did.

## What is deliberately not decided

**~~Infinite scroll versus a fixed sheet.~~** Decided once there was something to
look at, which is what this was waiting for: endless, with no scrollbars.

A scroller needs the plane to have ends. Four thousand pixels of ends is both a
wall somebody eventually hits and two bars reporting their position along a
nothing — and the bars were the tell, because they were measuring a size chosen
arbitrarily rather than anything in the drawing. So the plane is translated by an
offset instead, the wheel moves it, the wheel with a modifier zooms about the
pointer, and the percentage resets both the zoom and the position because without
scrollbars nothing else says how far somebody has wandered.

**Connectors between items.** The obvious next want, and the one that needs its
own thinking: a line between two items is a relation, and relations are the thing
this application has been careful not to invent casually.

**Handwriting recognition, shape straightening, templates.** All plausible, none
architectural.

**Rich text in a note, and the page's own blocks placed freely.** Asked for, and
the reason it is not built rather than not wanted:

A note holds a `Y.Text` — one text field, no blocks. Making it hold a document
would mean a second ProseMirror instance per note, its own schema version, its own
migrations and its own undo, all inside an item that a person is dragging around.
The honest middle is *item-level* style: a note's own size and colour, set from
the toolbar, which is a property of the note rather than of a run of characters
inside it. That is what `size` and `colour` on an item are for, and it covers
what a whiteboard note is actually for — a label, at the size it needs to be.

Placing the page's own blocks — a table, a video, a collection — on a board is a
different request wearing the same clothes. Those are node views inside a
ProseMirror document, and a canvas is not one. Making them work in both places
means either a second implementation of each or a document that is a canvas *and*
a body. The way this application already answers "I want that thing here" is a
link, and a canvas item that links to a page is one item and no new format.

Neither is closed. Both are large, and neither should be started because it
sounded small.

## Consequences

The first slice is: the page kind, the map, drag-to-move, a text item, an image
item, and a pen that writes a stroke on release. That is a working whiteboard and
it is several sessions of work, not one.

Every list in the application has to learn that a page might be a canvas — the
tree icon, the search result, the trash entry. That is cheap but broad, and it is
where a half-finished version shows.

A canvas page cannot be opened by an older client at all, by design. That is the
price of not letting one delete a drawing it cannot read.

## Alternatives considered

**A canvas block inside an ordinary page.** Rejected above: it needs a height
decided in advance, and it puts a plane inside a list.

**Excalidraw, tldraw or another embedded editor.** Genuinely tempting: both are
good, and tldraw has a collaboration story. Rejected for this application on the
same grounds as ADR-0004's dependency rule — they bring their own document format
and their own persistence, and the whole point of this codebase is that one
document format is synced one way and can be reasoned about. A second engine
would mean a page whose contents SONE cannot search, cannot materialise, cannot
move between workspaces and cannot restore from its own log.

**SVG as the storage format.** Rejected: SVG is a rendering, not a data model.
Two people editing the same SVG string merge as text, which for a drawing means
neither of them gets what they drew.
