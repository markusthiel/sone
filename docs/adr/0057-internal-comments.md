# ADR-0057: Comments that a guest cannot read

## Status

Accepted. The derived id and the room's authorisation are built; the panel, the
projection and the export are not. What is done and not done is at the end.

## Context

ADR-0046 named a hazard and did not fix it: **the moment a share link is given
out, every existing comment on that page becomes visible to whoever holds it.**
A team discussing a draft in comments and then sending the link to a client has
published that discussion. The share dialog says so now, with the count, which is
honest and is not a fix.

That record also deferred "internal threads, invisible to guests" and then
corrected itself about the cost: a flag on a thread cannot do it, because **a
sync room sends a client the whole document**. A share-link visitor receives
every comment as data, on their machine, before anything decides what to draw. A
thread marked internal would be hidden by their interface and present in their
browser — which is not a privacy feature but a worse one than none, because it
would be believed.

## The constraint, and what it leaves

Nothing that lives in the page's document can be kept from somebody who may open
the page. So an internal thread has to live somewhere else.

Two things make that cheaper than it sounded when ADR-0046 estimated it:

- **`doc_updates.doc_id` is a bare uuid with no foreign key.** A second document
  per page is storable with no migration and no new table.
- **A sync room authorises by page id**, through `authorizeDocumentOpen`, which
  loads the page and applies the reader's role. A second room for the same page
  can reuse that with a stricter requirement.

## Decisions

### An internal thread lives in a second document, derived from the page's id

`internalDocId(pageId)` — a UUIDv5 of the page id under a fixed namespace. Not a
column, not a random id stored somewhere: derived, so there is nothing to keep in
step and no row that can go missing while its updates remain.

Deterministic derivation also means the id is the same in every process without
coordination, which is what makes it safe for a sync room to open one on demand.

### Its room requires membership, not read access to the page

The page's own room accepts anybody with `viewer`, which includes a share-link
visitor. The internal room requires a *workspace member*: the check is
`claims.principal.kind === 'user'` and a `workspaceRole` that is not null, on top
of the page's own role.

So an anonymous share session cannot open it. Not "is served an empty document" —
**cannot open it**, and is told so, because a room that opens and stays empty is
a room somebody will spend an afternoon debugging.

### The panel reads two sources and says which is which

One list, with the internal threads marked — not two tabs. Somebody discussing a
paragraph wants the discussion, and splitting it by audience makes them look in
two places for one conversation.

The mark is a word, not a colour: "internal" beside the thread. A colour is a
convention nobody has learnt yet, and this is the one distinction in the panel
where being wrong is a disclosure.

### A new thread is internal or not, chosen when it is started, and never moved

No "make this internal" afterwards. Moving a thread means copying it into the
other document and deleting it here, and the copy cannot take back what the
guests who already synced the page have. A control that appears to make a
discussion private after the fact is the most dangerous thing this record could
build.

The choice is offered where the thread is started, next to the comment button,
and it remembers the last choice per page — because a team that has decided to
talk internally about a draft is going to do it more than once.

### Export, import and history follow the page

The internal document is exported with the page for a member, and not at all for
anything with a share token. Page history versions it alongside the page's own
document (ADR-0047), since a version of a page that silently loses its internal
discussion would be a restore that deletes something nobody mentioned.

### The projection keeps them apart

`page_comments` gains nothing. Internal threads project into their own table,
because the comment search and the inbox read the projected rows — and a mention
inside an internal thread must not surface for somebody who cannot read it.
Sharing one table and filtering everywhere is how that leaks the first time
somebody writes a new query.

## Consequences

Two documents per page means two rooms, two persistence paths and two
compactions. The doc store is already keyed by an opaque id, so most of that is
configuration rather than code — but "most" is doing work in that sentence, and
the version and export paths each have to be told.

A page's internal document is created when the first internal thread is written,
not with the page. So most pages have one row fewer than they would otherwise,
and the absence is normal rather than an error.

## Built so far

The derived id, the request form, and the room that refuses a share session.

**The request form is a suffix on the page id**, `<pageId>#internal`, rather than
a field in the open message. That message is `[Open, requestId, pageId]` on the
wire, and a new field would change its shape and cost a protocol version — which
0.4.0 shipped unchanged, and which every client and server would then have to
agree about for the sake of one bit. An older server sees an id it cannot find
and refuses, which is the right answer from a server without this feature.

The decoder was the thing that had to be told: it checked `isUuid` on the whole
string, so it refused the suffixed form before any authorisation ran — and the
request came back as a protocol error while I looked for the refusal in the room.
It now splits first and requires the part before the suffix to be a uuid, which
accepts exactly one more shape than before rather than any string.

## Still to build

The panel reading two sources, the separate projection table, and export. A
thread cannot be written internally from the interface yet: the room exists and
is guarded, and nothing puts a comment in it.

## What is deliberately not decided

**Internal comments on a canvas item.** The anchor works the same way
(ADR-0046), but the canvas draws its own marks and that is a second place to get
the distinction visible.

**Per-person or per-group visibility.** "Internal" is one line, between members
and everybody else. Anything finer is a permission system inside a comment
thread, and the page's own permissions are where that belongs.
