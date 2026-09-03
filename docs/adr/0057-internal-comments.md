# ADR-0057: Comments that a guest cannot read

## Status

Accepted and built: the derived document, the room that refuses a share session,
the panel, the choice when a thread is started, the projection and the
notifications. The export needed nothing, for a reason worth reading.

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

**Corrected on inspection: the export carries no comments at all.** Not the
page's own either. So there was nothing to exclude and nothing to build — the
rule above is what applies *when* comments are exported, and until then it
describes a decision nobody has had to make.

That is worth more than a shrug, because a share-link visitor **can** export:
the route requires `canRead`, which a share token grants for the page it was
made for. So the day somebody adds comments to an export — a reasonable thing to
want — an anonymous visitor would receive the internal discussion in a file. A
test now fails when the export path starts reading a comment table, so whoever
makes it fail decides about the two audiences deliberately instead of finding
out afterwards.

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

## Built, in order, and what each step found

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

**And the panel reads both**, one list with the internal threads marked by a
word. The group carries the document a thread came from, which is the part that
matters: a reply to an internal thread has to be written into the internal
document, and handing the wrong set to the reply box would write it where
everybody can read it.

**Starting one is a tick under the draft**, offered only when there is an
internal document to write into — a choice with one option teaches somebody the
wrong thing about what they have. One function decides which document a new
thread goes into, and it is the line that decides who can read what follows.
Forgotten when the page changes rather than carried to the next one.

The client needed **no change at all** to open a second document — the store
keys entries by the string it is given and passes it through to the channel
name, the open message and the persistence. Checked rather than assumed.

**Its own projection table exists**, `page_comments_internal`, the same shape as
`page_comments` — a row is a thread, not a message — so the two can be compared
and the projection is one idea written twice rather than two.

**And building it found something my previous two commits had shipped broken.**
The room projects with its own key as the page id, and `materializeDocument`
*inserts* a page row — so an internal document appeared in the workspace as a
page nobody created, titled nothing. A room now knows which page's comments it
holds and projects only those.

**Notifications from internal threads are written**, and the fear that deferred
them was already answered by code I had written weeks earlier: `writeNotifications`
joins `workspace_members`, so only a member can ever be a recipient, and a
share-link visitor has no row there. The page's visibility condition applies on
top. So it is one call from the internal projection rather than a second
notification path — and the thread ids come from a different document, so they
cannot collide with the page's own, which is what lets both share the table and
the once-per-message rule.

## What is deliberately not decided

**Internal comments on a canvas item.** *Built, and the deferral was resting on
something that did not exist.* Starting one already worked — an item anchor goes
through the same pending-thread handover as a text selection, so the tick under
the draft was already routing it into the internal document.

The marks were the deferred half, and the canvas **had none at all**: it was
never given the threads, so a commented item looked exactly like an uncommented
one and the only way to find a discussion was the panel. That is a gap in
ADR-0046 rather than in this record, and it is what "a second place to get the
distinction visible" was really pointing at.

There is a count over each commented item's corner now — outside the item,
because an item can be a drawn shape with nothing to put a badge inside — and
the internal ones are named in its label rather than shown in another colour.
The visual difference is a ring, not a hue, so it is not a convention somebody
has to have learnt. Resolved threads carry no mark: a settled discussion is not
a task.

Both documents are counted in one place, in the page view, because the canvas
knows nothing about threads and handing it two lists to reconcile would put this
distinction in a third place.

**Per-person or per-group visibility.** "Internal" is one line, between members
and everybody else. Anything finer is a permission system inside a comment
thread, and the page's own permissions are where that belongs.
