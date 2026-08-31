# ADR-0040: Selected rows, and the three things worth doing to them

## Status

Accepted.

## Context

A collection's rows can be edited one cell at a time and emptied all at once, and
nothing in between. Asked for: select individual rows, then delete them, copy
them, or export them.

Selecting is mechanical. What the three actions *mean* is not, and that is what
this records.

## Decisions

### Deleting is archiving, and says so

A row is a page (ADR-0021), so removing one is what removing a page is: it goes to
the trash and can be brought back. The existing "Empty" already works this way —
it archives every row — and a selection is the same operation on fewer rows.

The confirmation says "to the trash" rather than "delete", because that is what
happens and because somebody who reads "delete" and means it will look for the
recovery that the word denies them.

### Copy puts tab-separated text on the clipboard

Not "duplicate the rows in place". ADR-0034 made a table fillable by pasting a
grid, and tab-separated text is exactly what that reads — so copy and paste
round-trip, in this table, into another table, and out to a spreadsheet.

Which also answers duplicating without a second action: copy, then paste. The
paste appends, never overwrites, which is what ADR-0034 already decided.

The title column comes first, then the columns as the view shows them, so what
lands on the clipboard is what is on screen.

### Export is a CSV file of what is on screen

The same values as the copy, as a downloaded file with a header row.

**What the view shows**, not what the collection holds: the rows are the filtered,
sorted, searched ones already in hand. A view exists to narrow a table, and an
export that quietly widened it again would be the one place that ignored the
filter — and nobody would notice until a spreadsheet had the wrong rows in it.

Generated in the browser from those rows rather than by a route. A route would
have to re-run the query to mean the same thing, and it would mean something
slightly different the moment the two implementations drifted.

CSV rather than the clipboard's tabs, because a file with an `.csv` extension is
what a spreadsheet opens. Quoted on demand — a value containing a comma, a quote
or a newline is wrapped and its quotes doubled — because a CSV that breaks on a
comma is worse than no export.

### The selection is a column of checkboxes, always present

Not on hover: hover does not exist on a touch device, and the whole point is to
reach several rows. A narrow leading column, with a checkbox in the header that
takes or releases everything the view is showing.

Present for a reader too. Copy and export are reading, and a table somebody may
not edit is exactly the one they are most likely to want a copy of.

### The selection is local, and does not survive a reload

It lives in the component, like the undo stack (ADR-0034). A selection is about
what somebody is doing this minute; persisting it would mean explaining a
highlighted row to whoever opens the page next.

Cleared when the rows change — after a delete, a paste, or a reload — because a
selection of ids that are no longer there is a count that lies.

## Consequences

One new route: archiving named rows. The existing "Empty" keeps its own, which
takes no ids; a selection of every row would do the same thing, and leaving the
simpler route in place means the destructive-but-obvious path stays destructive
and obvious.

The copy format is the paste format, so the two are tested against each other
rather than each against a fixture.

An export ignores nothing and includes nothing extra: it is the rows in hand. On
a collection large enough to paginate — which this does not do yet — that would
become a decision again, and it is written here so the next person knows it was
one.

## Alternatives considered

**Duplicate as its own action.** Rejected: copy-then-paste is the same thing with
one more keystroke, and it does not need a second definition of what a copied row
is.

**A server-side export route.** Rejected above: it would have to re-run the view's
query to mean "what is on screen", and two implementations of that will drift.

**Selecting by dragging across rows**, as a spreadsheet does. Rejected for now:
this table already reads a pointer drag as reordering, and one gesture that means
two things is how a table becomes unpredictable. Checkboxes are unambiguous and
work with a finger.

**Hard deletion for a selection.** Rejected: nothing else in this application
deletes without the trash, and a bulk action is the last place to introduce it.
