# ADR-0055: Paging a collection

## Status

Accepted, and built for the table: the row query, the cell query, the cursor and
the client's paging. What is not built is named at the end.

## Context

Found while implementing something else. ADR-0054 deferred sorting by a derived
column pending a measurement; I measured a route that chose a page of fifty rows
and then computed its rollups, and only when I opened the code to build it did I
find that **there is no page**. The read route has no `LIMIT`, no offset, the
client does not paginate, and every row of a collection is fetched, projected
and sent on every load.

So the sorting question was small and this one was underneath it.

## The measurement

A collection of 20 000 rows with eight filled cells each — wide rather than
merely long, because width is what makes a response large. Generated without
randomness, as ADR-0051's lesson requires.

| | all rows *(today)* | a page of 50 |
| --- | --- | --- |
| The row query | 5.5 ms | — |
| Every row's cells | 33 ms | **1.1 ms** |
| A rollup over every row (ADR-0054) | 145 ms | 3.3 ms |
| The cell payload crossing the wire | **7.1 MB** | ~18 kB |

The seven megabytes are the finding. The milliseconds are survivable; a browser
parsing seven megabytes of JSON to draw thirty visible rows is not, and neither
is a phone doing it on a mobile connection.

## Decisions

### A page is fifty rows, chosen by the server

`?limit` and a cursor, with fifty as the default and two hundred as the ceiling.
Fifty is roughly two screens: enough that scrolling feels continuous, small
enough that the first paint is immediate.

### A cursor, not an offset

`OFFSET 5000` makes the database walk five thousand rows to discard them, and —
worse — a row inserted while somebody reads shifts every subsequent page, so
scrolling shows a row twice or skips one. The cursor is the sort key and the id
of the last row on the page, which is stable under insertion.

That the cursor must carry the *sort key* is what makes this a decision rather
than a parameter: a view sorted by three columns has a three-part cursor, and the
comparison has to be lexicographic over exactly the columns the sort names.

### Sorting by a derived column is the exception, and it says so

ADR-0054 allows sorting by a rollup because the aggregate is computed for every
row anyway. Paging removes that: with a page of fifty, the aggregate would be
computed for fifty — unless the sort is *by* the aggregate, in which case every
row's value is needed before the first page can be chosen.

So a derived sort keeps today's cost: the full 145 ms, and the whole collection
aggregated. That is the honest arrangement rather than a hidden one — the view
says the sort is being computed across the collection, and the option carries
the same note above a size where it stops being instant.

The alternative is refusing derived sorts once paging exists, which would take
back a feature for a cost most collections never pay.

### The total count is separate, and approximate above a bound

"1–50 of 12 431" needs a count of the filtered set, which is a second scan. Below
ten thousand rows it is exact; above it the interface says "of many" rather than
running a count nobody reads carefully. A number that costs a scan to be precise
about is a number worth being vague about.

### Not yet done, and known

The **total count** is built, bounded in the query: `count(*)` over a subquery
with `LIMIT 10 001`, so the cost is the same whatever the collection's size and
the answer is either exact or "more than ten thousand". It is shown only when
there are more rows than are on screen — "7 of 7 rows" is noise.

It is its own query with the filters and *no sorts*. Reusing the row query's
parameters failed outright: a sort binds the field id it orders by, that
parameter appears in `ORDER BY` and not in `WHERE`, so the count supplied
parameters it never referenced and Postgres refused it. A count wants the
filters and nothing else.

**Select-all, paste, export and trash-all — checked**, one at a time, and the
prediction was right about one of them.

*Trash-all was a lie.* The confirmation said "move all N entries to the trash"
with N counting the *loaded* rows, while the button clears the whole collection
server-side. Before paging those were the same number; after it, the dialog
promised fifty and did twelve thousand. It names the scope now and no number,
because the number is not known here without a second scan — and the notice
afterwards carries the true count, which the server already returns.

*Select-all was already right*, which is worth saying rather than only reporting
faults: its label reads "select every entry **shown**", written before paging
existed and true after it.

*Export and copy* act on the selection, and a selection can only hold rows
somebody has loaded. Their notices state the count they acted on, which stays
true. What changed silently is that "select all, then export" now means the
loaded pages rather than the collection — acceptable, because both the label and
the count say so, and an export of a collection is what ADR-0044 is for.

*Paste* appends rows and does not read the loaded set at all.

### Everything else keeps working, including paste and export

Selecting all, pasting a hundred rows, exporting, "move all to trash" — these
operate on the *collection*, not the page, and they already do. They must not
quietly become "the fifty rows you can see", which is the way paging usually
breaks a table. Each one either takes a filter and runs server-side, or says how
many rows it will touch.

## Consequences

The client gains a scroll boundary and a loading row, and the table's "select
all" must mean the collection rather than the loaded rows — with the count
beside it, so nobody trashes twelve thousand rows believing they trashed fifty.

Views that sort by a derived column are slower than views that do not, visibly.
That is a real difference in behaviour and better said than smoothed over.

## What is deliberately not decided

**Virtual scrolling.** Drawing only the visible rows of a loaded page is a
separate optimisation, and the wrong one to reach for first: fifty rows of DOM
is not a problem, seven megabytes of JSON was.

**Paging the board and the gallery.** Both draw the same rows and inherit the
page — checked: the table is `hidden` rather than unmounted for those views, and
the "show more" control sits outside it, so all three get it. Whether a board column loads its own page is a question about columns
rather than about rows, and it can wait until somebody has a board that large.
