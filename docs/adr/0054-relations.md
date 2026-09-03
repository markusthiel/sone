# ADR-0054: Relations, and what may be derived from them

## Status

Accepted. Nothing built yet — this decides the shape, and one of the decisions
below is the reason the obvious implementation would have been a mistake.

## Context

`FieldType` has named `relation`, `rollup`, `lookup` and `formula` since the
collection model was written, and `DERIVED_FIELD_TYPES` marks four of them as
"never stored". The vocabulary is there; nothing behaves. A column of type
relation today is an empty cell.

This is the largest thing left undone and the one that turns a collection from a
table into something worth calling a database: an invoice that points at a
client, a task that points at a project, and a project that can say how many
tasks it has.

## The constraint everything else follows from

**A row is a page, and a page is a document.** Two rows in different collections
are two Yjs documents, synced in two rooms, with no transaction between them.

So a *symmetric* relation — the kind every comparable tool ships, where adding
"Client: Acme" to an invoice makes "Invoices: this one" appear on Acme — means
writing into a document the person may not have open, may not be allowed to
edit, and which no transaction covers. Two writes, either of which can land
alone. That is not a feature with an edge case; it is a data model that is
sometimes wrong and cannot be repaired, because a CRDT has no notion of "these
two updates belong together".

Every decision below exists to avoid that write.

## Decisions

### A relation is stored on one side only

The cell holds page ids. The side that was edited is the side that stores.

### The other side is derived, not stored

Acme's "Invoices" column is a **backlink**: a derived field whose value is
"every row whose relation cell points at me". It is computed from the
projection, delivered with the row, and never written into Acme's document.

This is the whole of the answer. There is no second write, so there is no
inconsistency to repair; the reverse side cannot drift from the forward side
because it *is* the forward side, read the other way.

It also costs less: adding a client to a thousand invoices writes a thousand
cells and nothing on the client, where a symmetric model writes a thousand-item
list into one document that everybody looking at Acme has to sync.

### Derived values are computed on the server, from the projection

A client has one document open. It cannot see the other rows, so it cannot
compute a rollup, and asking it to open a thousand documents to count them is
not a plan.

Cells are already projected with typed shadow columns, so the aggregate is one
query over rows that are already indexed. Derived values are sent with the row
list and are read-only in the interface — an editable cell whose value the
server computes would be a lie the moment somebody typed in it.

### A rollup may aggregate a stored field, never another derived one

The decision that removes cycles by construction rather than detecting them.

"Number of tasks", "sum of amounts", "latest date" — each reads a *stored* cell
on the other side. A rollup of a rollup is refused, so there is no dependency
graph to walk, no cycle to detect, and no recomputation cascade when a cell
changes. A depth of one covers what people actually ask for; the alternative
is a scheduler.

`lookup` is the same mechanism with no aggregation: show the other row's stored
field.

**"For free" was nearly true.** Built as a sixth aggregate: the edges, the
visibility check and the config are shared, and what it actually needed was a
*shape* for the answer — a list of somebody else's values is neither a list of
rows nor a number, so `DerivedValue` gained a third form. One field, not free.

Building it also turned up that every aggregate but `rows` and `count` needs a
field to aggregate, and nothing was requiring one: a rollup with none was
storable and could never produce a value, which reads as a fault in the rollup
rather than a config nobody finished. Refused now, and the interface offers the
field beside the aggregate so the two halves of the decision are made together.

### A relation is scoped to one collection, chosen when the column is made

Not "any page". A column that can point at anything gives a picker over the
whole workspace and a rollup with nothing to aggregate — the other side has no
fields in common. The column's config names the collection; the picker searches
inside it.

### A deleted target leaves the id in place

The cell keeps pointing at a page that is in the trash, and the interface draws
it as a missing row rather than removing it. Removing it would mean a document
edited by somebody else's deletion — the same write this record exists to
avoid — and a restored page should find its relations intact.

## Consequences

**Corrected the day after writing this.** I wrote that the projection "gains a
table for relation edges". It has had one since `0001_init`: `page_relations`
with `(from_page_id, field_id, to_page_id, idx)`, an inverse index on
`(to_page_id, field_id)`, and the materialiser has been filling it all along —
the shadow-column mapper even keeps a count so a view can sort by "how many
linked items" without a join.

So the backlink lookup this record depends on is already one indexed query, and
the reasoning above stands on ground that was there before I described building
it. What is actually missing is narrower than the record implied: a way to
*create* a relation column and say which collection it points at, a picker, a
cell that draws the linked rows, and the derived side. The storage is done.

I checked this only when the implementation began, having asserted it in a
record the day before. The plumbing being better than I remembered does not
excuse describing it from memory.

Derived fields mean a row's cells arrive from two places — the document for
stored ones, the API for derived ones. The interface has to hold both without
letting somebody type into the second.

A relation crosses pages, so it crosses permissions. A backlink must not reveal
a row somebody cannot read: the aggregate runs with the reader's visibility, so
two people can see different counts on the same page. That is correct and it
will look like a bug the first time somebody notices, so the number carries a
note when anything was excluded.

## What is deliberately not decided here

**Formula.** Now [ADR-0056](0056-formula.md) — where two of the three worries
above turned out to be avoidable by choosing the language: a formula may not
reference another formula, so there is no dependency graph, no evaluation order
and no cycle to detect. The same trick as the rollup rule, applied one layer up.

**A row's own page showing its cells.** *Built.* Found while checking whether
relations reached everywhere: the properties panel showed a page's kind and
dates and no collection values at all, for any field type — so a row opened as
a page that said nothing about the row it is.

Its own route (`GET /api/pages/:pageId/properties`) rather than reading the
whole collection, because fetching two hundred rows to draw one is the sort of
thing that works in testing and not in a workspace. An ordinary page answers
with an empty list rather than a 404: the panel asks this of every page it
opens, and "no fields" is the truthful answer for most of them.

The fields go *above* the kind and the dates, because on a row page these are
the page. And they are drawn by the table's own cell renderer, which is why it
moved into a module of its own first — two renderers would drift, and the one
that drifted would be the one nobody looks at.

### Sorting a view by a derived column: measured, and bounded

Deferred here originally with the note that it "should be made against a real
corpus, like ADR-0051's was". Measured, on the two tables a rollup reads with
the indexes the real ones carry, generated without randomness so the numbers can
be reproduced.

**The first version of this measurement was of a route that does not exist**, and
the correction is the interesting part.

I measured "a page of fifty rows, then its rollups" against "every row, then a
sort", and concluded that sorting removed a bound and cost thirty times more.
Then I opened the read route to implement it: **there is no page.** It has no
`LIMIT` and no offset, the client does not paginate, and the rollups already run
for every row of the collection. The bound I was protecting was never there.

Measured again, against the shape that exists — 20 000 rows, 400 000 edges:

| | |
| --- | --- |
| Every row's rollup, unordered *(today)* | 145 ms |
| The same, ordered by the count | 211 ms |

So sorting costs **45%, not 3 000%**. The scan is already paid; the sort is the
only new work, and it is the cheap half.

**Decision: allowed, with no threshold.** A bound justified by numbers that
described a different program would be a rule nobody could defend later.

**And the real finding is the 145 ms**, which is what a collection of twenty
thousand rows costs *today*, before any of this — along with sending every one
of those rows in one response. That is a larger problem than the sorting
question and it is not this record's: it is paging a collection, which belongs
in its own decision and wants the same treatment this got — measure the shape
that exists, not the one I assume.

Three alternatives considered while the numbers were still wrong, kept because
two of them stay true:

**Refusing it entirely.** "How many invoices does this client have, most first"
is one of the questions a relation exists to answer, and a database that can
compute a number it cannot order by is a strange thing to ship.

**A threshold.** What the wrong numbers argued for, and what the right ones
remove: 45% of an already-paid cost does not need a rule.

**Caching the aggregate in a column.** The obvious escape and the wrong one
here: it means a write to every dependent row whenever any source row changes,
which is the cascade the "no rollup of a rollup" rule was chosen to avoid.
Materialising the aggregate reintroduces exactly what that rule was protecting.

**Paging a collection** is now [ADR-0055](0055-paging-a-collection.md), where
the measurement continued: 7.1 MB of cell payload for a collection of twenty
thousand rows, against 18 kB for a page of fifty. The milliseconds were
survivable; the megabytes are not.
