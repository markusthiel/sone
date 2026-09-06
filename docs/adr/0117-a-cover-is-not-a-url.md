# ADR-0117: A cover is not a URL

## Status

Accepted. Built. Asked for.

## Context

> Ich hätte gerne ein Titelbild für Seiten und Ordner, auf der Inhaltsseite.
> Nur eigene Uploads, kein Unsplash. Verkleinert, damit es schnell lädt. Und als
> Alternative eine Farbe oder ein Farbverlauf. Wenn nichts gesetzt ist, soll
> alles so aussehen wie bisher.

**Half of it already existed, and none of it worked.**

`pages.cover_url text` has been in the schema since migration 0001, beside
`icon jsonb`. `PAGE_KEYS.coverUrl` has been a document key for as long. The
projection reads it, the page route hands it to the browser as `coverUrl`, and
the type in `@sone/core` has carried it the whole time.

Nothing has ever written one. Not the editor, not a route, not the importer,
not the archive reader — the whole of it is a column, a key, a field and a type,
with no producer anywhere.

That is exactly the history the icon column had, and ADR-0030 ended it the same
way: the shape that goes in a place is decided when there is finally something
to put there.

**And `text` is not that shape.** Two of the three things a cover can now be —
a colour, a gradient — are not URLs. A column that can hold one third of the
answer is worse than one that holds none: the folder view reads this column to
draw its cover, so a folder whose cover was a colour would have drawn nothing
while the page beside it drew its picture, and that reads as a bug in folders.

## Decisions

### `cover jsonb`, and the old column goes

Migration 0072. `readEntryCover` in core is the one reader, beside
`readEntryIcon`, with the same rule for a malformed value: an entry with a
broken cover loses its cover, never its place in the tree.

**The migration does not take my word for it.** Dropping a column on the
strength of "nothing writes it" is the claim migration 0069 found to be false
the day it was written:

> 'Nothing reads it' was false the day it was written. `/api/auth/session` and
> `/api/workspaces` both selected `m.role`

So every instance checks its own data first: `cover_url IS NOT NULL` on any row
raises, with the count, and the transaction rolls back with the values still
there to look at. I searched the source and found no writer; that check is what
makes the finding true of somebody else's database as well as of mine.

**No `SCHEMA_VERSION` bump.** The rule says renaming a key requires one, and it
is the right rule — but there is no document anywhere carrying `coverUrl`,
because nothing ever wrote it. A bump would rewrite every document on open to
record a migration that moves nothing, and would refuse every one of them to a
SONE one version older. That is a real cost for a guarantee about data that does
not exist.

### Only a file uploaded here

`readEntryCover` accepts a picture only at `/api/files/<uuid>`, anchored at both
ends.

Asked for as *„nur eigene Bilder, kein Unsplash"*, and enforced on the value
rather than in the picker, because **a cover is drawn on every page load**: a
foreign URL in one is a page that reports every reader to somebody else's
server, which is a tracking pixel wearing a cover. A document is written by
clients, and a picker is only one of them.

A malformed cover on the route is refused with 422 rather than silently cleared.
Null is how a cover is taken off; answering something malformed by deleting the
page's cover is the worst available reading of it.

### The picture is an `<img>`; only a colour is a background

`background-image: url(…)` means assembling a CSS string out of a value from the
document, and the escaping rules for that are their own subject. An `<img src>`
is escaped by the framework, carries alternative text and can be told how to
load.

`coverBackground` therefore returns nothing for a picture, and it lives in core
rather than in the component because a page and a folder both draw one — two
drawing sites are two chances to answer differently, which is how one colour
ends up looking like two.

A colour may be a palette name or a literal, the two spellings every colour in
this project accepts (ADR-0030). A name keeps following the workspace, so a
cover chosen as "blue" changes when the workspace's blue does.

### One rule, two transports, and the reason there are two

A **page** writes its cover straight into the document it already has open. A
**folder** writes it through `PATCH /api/pages/:id`, the route that already
carries the title, the icon, the width and the lock.

That is not a preference. The folder view has no document open at all — it
renders the tree node it was handed and renames through that route. And the page
cannot use the route, because **a sync room reads its document once and never
re-reads `doc_updates`**: a cover set over HTTP on a page somebody is looking at
would not appear until the page was opened again.

Both go through `readEntryCover`, so neither transport decides for itself what a
cover may be. The split is the same one the title already has, for the same
reason, and it stops at `onChange` — everything above it is one component.

The cover therefore rides on the tree row, withheld with the title for a
path-only page: a picture is a fact about a page somebody was told nothing about.

### Over the heading, revealed on hover

The layout offered was three; the one asked for was the cover above the heading
with the control appearing on hover.

The cover and the heading are **one hover region**, because the control to add a
cover has to be reachable on a page that has none — which is every page before
the first one is chosen. A control that only appeared over the cover would be
unreachable exactly when it is needed.

**And the controls are in the document at all times**, revealed by opacity
rather than mounted on `mouseenter`, so Tab reaches them and `:focus-within`
shows them. Removing a cover is only possible through them; a control that
exists only under a pointer is one a keyboard cannot use.

### The picture is shrunk by the machinery that already shrinks pictures

The original is uploaded first — it is the one the cover names and the one that
must exist even if everything after it fails — and a web-sized copy follows in
the background. `/api/files/:id` serves the smaller one once it is there.

That is ADR-0029 exactly as the image block already uses it, so *„verkleinert,
damit es schnell lädt"* needed no machinery of its own. It also means the file
is authorised through the entry it covers: a cover on a page nobody may see is a
picture nobody may fetch.

## Consequences

**Eight document tests, five route tests, eight mounted tests.** The route tests
fail before the change; so does every mounted one, since the component did not
exist. The mounted ones carry the parts a source read cannot see: that a reader
is offered nothing, that the controls are focusable, and that a picture is an
`<img>` rather than a background.

**`PageDetail.coverUrl` is gone from the API.** It has been `null` in every
response ever sent, so nothing can be relying on it. `cover` replaces it.

**`api.setEntryCover` exists and a page never calls it.** That is deliberate and
named here, because this project keeps finding the opposite shape — a function
written and never called (ADR-0099, ADR-0108, ADR-0113, ADR-0115). This one has
a caller: the folder view. The page's own path is the document.

## Alternatives considered

**Keep `cover_url text` and store only pictures in the projection.** Smaller,
and it makes the projection a half-truth: the folder view would draw a picture
cover and not a colour one, with no reason visible in either the column or the
code.

**Let the picker enforce "own uploads only" and keep the reader permissive.**
The picker is one writer of the document among several, and the rule protects
every reader of the page rather than the person choosing. A rule that lives in
the interface is a rule that holds until somebody writes a second interface.

**A curated set of stock pictures, shipped with SONE.** Asked against
explicitly. It would also mean shipping images with their own licences, and a
self-hosted instance would be serving somebody else's photographs from its own
disk.

**Give the cover its own route and its own column type per kind.** Three
columns, or a `cover_kind` beside `cover_value`, and every reader then has to
reassemble them. The whole reason `icon` is one jsonb field is that a fourth
kind becomes possible without a migration, and a reader that does not know it
draws nothing rather than breaking.

**Have the page use the route too, for one writer.** It is one *rule* either
way — `readEntryCover` — and the route cannot reach an open sync room, so this
would trade a real defect (the cover does not appear until reload) for a
tidiness that the shared reader already provides.
