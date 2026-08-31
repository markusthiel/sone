# ADR-0034: A collection table is edited in place, and a paste fills it

## Status

Proposed.

## Context

A collection is a folder with columns, and a row is a page (ADR-0021). The table
was built on that sentence, and the first column is therefore a link: clicking a
row's name opens the page.

In use that turns out to be the wrong default. Filling a table means working down
the first column, and every attempt to do so leaves the table. Craft has the same
model underneath and the opposite gesture: the cell is edited in place, and a
small control at the end of the cell opens the page. The work stays where the
work is.

The second half is bigger. There is no way to get data *into* a collection except
one cell at a time. Somebody with a three-column list in a spreadsheet — the case
that prompted this, a list of people with a first name and a PIN — has to type it
again. Craft accepts a paste of the whole selection into an empty row and turns it
into rows and columns.

And two smaller reports: nothing empties a table, and nothing undoes a mistake.
Both matter much more once a single gesture can create fifty rows.

## Decisions

### The first cell is edited in place; a control beside it opens the page

The title cell becomes the same kind of editable cell every other column has. At
its trailing edge, when the row is hovered or focused, a small control opens the
page — drawn always on touch, where hover does not exist (ADR-0016).

The page is not demoted: it is still what a row *is*, and everything about a row
that is not a column lives there. What changes is which of the two is the default
gesture, and the answer follows from what people do with a table.

### A paste into a cell fills rows and columns from it

Pasting into a cell reads `text/plain` from the clipboard, splits on newlines and
tabs, and writes the result starting at that cell: across into the columns to its
right, and down into rows, creating rows as needed.

`text/plain` and tab-separated, because that is what every spreadsheet and every
HTML table on a page puts on the clipboard as its plain-text flavour. Not
`text/html`: parsing that is parsing arbitrary HTML from the clipboard, and the
plain-text flavour of the same copy already carries the grid.

**Columns are not created.** A paste wider than the table fills what exists and
reports what it dropped. Creating columns would mean guessing their types and
their names from data, and a table that grows a "Column 4" of the wrong type from
a stray tab is worse than one that says it ignored something. Somebody who wants
three columns adds three columns first, which is one deliberate step and is how
Craft behaves.

**Rows are created**, because that is the whole point.

### The cap is 50 rows in one paste, and it is a stated limit

Craft's number, and a good one: it is generous enough for the case that prompted
this and small enough that a mis-click on a copied ten-thousand-line file does not
build a workspace nobody can clean up. A paste over the cap fills the first 50 and
says so, rather than refusing outright — half of what somebody wanted, with the
rest still on the clipboard, beats nothing at all.

Deliberately not "at least 100": the number is a safety limit on an operation
whose result is pages, and it can be raised once anybody has actually hit it in
anger.

### One request, not fifty

A new route takes the whole grid and applies it in one transaction: rows created,
cells written, projection re-materialised once. Fifty rows through the existing
one-row and one-cell routes is two hundred requests, a table that fills in
visibly, and no way to end up with either all of it or none of it.

All-or-nothing matters here: a paste that half-succeeds leaves somebody deciding
which rows to delete by reading them against a spreadsheet.

### Undo means undoing the last operation, not a general history

A stack of the operations this table performed, in this browser, since it was
opened. Each entry knows how to reverse itself: created rows are deleted, an
overwritten cell is written back.

Not the editor's undo, and not the CRDT's. Collection edits go over HTTP to the
projection rather than into a Yjs document, so `Ctrl+Z` in the page has nothing to
reverse them with — and a paste of fifty rows creating fifty pages is not
something a text undo stack should be asked to model.

Bounded and local, and honest about it: it is emptied on reload, and it does not
attempt to undo somebody else's edit. A shared undo history is a different feature
and mostly a way to surprise two people at once.

### Emptying the table deletes its rows, and says that

A row is a page. "Clear the table" therefore deletes pages, and the control has to
say so and ask for confirmation the way deleting a workspace does — not a dialog
dismissed by reflex, but the count typed or a clearly-worded confirmation. It goes
where destructive things go: last, and set apart.

It also becomes one entry on the undo stack, which is the cheapest safety net
available and the reason to build the stack before the button.

## Consequences

A collection stops being a thing you fill by hand. That is the point, and it makes
the row cap the interesting number rather than the typing speed.

Every route this needs is new but small: one bulk write, one bulk delete. Both
belong beside the existing collection routes and answer to the same permission —
edit rights on the page holding the collection.

The undo stack is per browser and per open table, and it will be wrong in one
situation worth naming: somebody else changes a cell, then you undo your own
earlier edit to it, and their value is overwritten. Accepted, because the
alternative is either no undo or a shared history, and the window is small.

## Alternatives considered

**Parse `text/html` from the clipboard** to get cell boundaries exactly. Rejected:
the plain-text flavour of the same copy already has them, and accepting arbitrary
HTML from a paste is a parsing surface nobody needs to maintain.

**Create missing columns from a wide paste.** Tempting, because it makes one
gesture do everything. Rejected on types: a column's type decides what a cell can
hold, and inferring it from the first row is how a PIN becomes a number and loses
its leading zero.

**Import from a file instead.** A file picker is a better answer for a thousand
rows and a worse one for the case in front of us, which is a selection somebody
already has on the clipboard. Worth having later; not instead of this.

**Editing a row only in a side panel**, as Notion does. Rejected for the same
reason as the link: it is a good way to see everything about one row and a bad way
to fill a column.

**No cap, with a warning above some size.** Rejected: the failure mode is pages,
and a warning is something people click through. A cap that fills fifty and says
what it left is a limit somebody can act on.
