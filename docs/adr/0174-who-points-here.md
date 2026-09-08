# ADR-0174: Who points here

## Status

Accepted. Built. Round three of three on cross-references (ADR-0170).

## Context

The last of the three rounds, and the only one that needed a table:

> Rückverweise: *„wer zeigt hierher"*

*What does this page link to* the links panel has answered since ADR-0158, by
reading the open document. The other direction cannot be answered that way at
all: **the pages that point here are documents nobody has open**, and asking
would mean opening every document in the workspace on every render.

So it is a projection, and the model was already in the building — mentions are
read from the document and written to a row by the materialiser, for the reason
`mentionsIn` states out loud: *"read from the document rather than trusted from
a client … a notification a client creates is a notification a client can
forge."* A link a client reports is a link a client can forge.

## Decisions

### The existence check is the origin check

A stored internal link comes in three shapes: `/p/<uuid>` from the `[[` picker
(ADR-0173), `<origin>/p/<uuid>` pasted from the handle menu's clipboard
(ADR-0170), and `/s/<token>/p/<uuid>` from a document written before that was
stopped. `linksIn` reads the uuid out of the path and ignores the rest of the
address.

That matches an external `https://example.org/p/<uuid>` too — and it is
harmless, because a row is written only for a uuid that names a page **in this
workspace**. A foreign address would have to collide with one of this instance's
own uuids to produce anything.

The alternative was a configured hostname threaded into the materialiser, which
is a setting that is wrong the day somebody moves the instance, and wrong for
every link written before they did.

### Deleted by source page, which is the trap next door

`page_links` is deleted by `from_page_id` and rewritten on every projection —
the discipline `page_tags` and `page_relations` use, and the materialiser
records why the other one is not enough:

> A notification whose thread is gone goes with it (ADR-0092). … So: a text
> mention whose block was deleted keeps its notification row for ever.

A backlink that outlived its link would be a panel pointing at a sentence that
says nothing about this page. Deleting by source makes that impossible rather
than unlikely.

### No foreign key, and dangling targets are dropped

Updates arrive in whatever order the sync rooms flush them, so a page can link
to one that has not been materialised yet — during an import, or because the
other room flushed second. A foreign key would refuse the row and take the whole
projection of the source page down with it.

Unresolvable targets are filtered instead, and the next projection of the source
picks them up. A row left behind by a *deleted* target is a join that finds
nothing, which is invisible rather than wrong.

### The visibility condition is on the source page

The reader is already looking at the target — `mayReadPage` has just said so.
What must not leak is the existence, the title or the count of the pages linking
in, and `visiblePagesCondition` is the one condition the tree, search,
favourites and the templates list all use. Its own comment says why there is
only one: *"there are several … and the one that drifts is a disclosure."*

A backlink from a page somebody may not read is a disclosure exactly as a search
result from it is.

A null user matches nothing (ADR-0101), which is what makes the anonymous case
safe without a second branch — and the route asks for a session anyway, so a
share-link visitor gets no backlinks at all. That is the right answer, not a
gap: a visitor is not told what else the workspace contains (ADR-0026).

### A section in the links panel, not an eighth tab

The panel is already *the links of this page*. A second question about links
belongs beside the first, and a tab costs `RIGHT_TABS`, `PAGE_TABS`, an icon,
three translations and a share-view decision.

**The section is drawn only when it has rows.** A member with no backlinks sees
the panel exactly as before, and a share visitor — whose request is refused for
want of a session — is not shown a heading claiming nothing points here. An
empty list is a statement, and this one would sometimes be false.

### Two block ids, one of them unread

`from_block_id` is what makes a row stable (one link per target per block, so
editing the words around a link does not make it a different link) and it is
what lets a backlink offer *show me where*.

`to_block_id` is the fragment, and **nothing reads it yet**. It is in the table
because the extractor already parses it and a nullable column costs a line now
against a migration later.

### Same workspace only

The panel is about a workspace's own structure, and a reader who is not in the
other workspace could not be shown a cross-workspace source anyway — the
visibility condition would refuse it. Saying so where the row is written rather
than only where it is read means the table cannot grow rows that are always
filtered out.

## Consequences

**Thirteen tests in core** over the extractor, **eleven against a real database**
for the projection and the filter. The two that matter most are *and stops being
one when the link goes* — the lifecycle the notification pass gets wrong — and
*a page somebody may not read is not among their backlinks*, which runs the
route's own condition rather than a paraphrase of it.

### A fixture bug that reads like a code bug

Two source pages in one test shared a block id, and `blocks.id` is a **global**
primary key. The projection of the second page failed on a constraint —
`duplicate key value violates unique constraint "blocks_pkey"` — which looks
exactly like the new insert being wrong, and was the fixture handing two
different pages the same block.

### The guard asked for the interface, and then for this record

`check-routes-reachable` refused the route while the panel was still unwritten:
*"a feature reachable only with curl is not a feature."* Then
`check-adr-references` refused the citation in the migration and the message
catalogue until this file existed. Both are the checks doing exactly what they
were written for, in the order they were written for.

## Alternatives considered

**Compute it from the search index.** `plain_text` deliberately contains no
hrefs — `inlineText` reads the delta's `insert` and never its `attributes` — so
this would mean putting addresses into the text people search, where searching
for a uuid fragment would match pages nobody meant.

**A column on `blocks` holding the links of that block.** The delete-by-page of
`blocks` would give the same lifecycle for free. It also makes every read of the
backlinks a scan of a jsonb column across the workspace, where a table gives an
index on `to_page_id`.

**Show backlinks on the page itself, under the text.** Notion does this and it
reads well. It also means a page's own content and what other people have
written about it share one column, and the panel is where *what does this page
link to* already lives.

**Count them and show a number beside the tab.** A count is a disclosure of its
own: it is derived from pages the reader may not see unless it is filtered
exactly as the list is, and a number nobody can click to explain is a number
nobody can check.
