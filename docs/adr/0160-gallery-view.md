# ADR-0160: A gallery is a table drawn as covers

> **Renumbered.** Written as ADR-0039 and moved here by ADR-0161: the sync
> protocol's record was written in the same batch and kept that number. The
> changelog entry and the commits from that week call this one 0039.

## Status

Accepted.

## Context

A collection can be a table or a board. Asked for: a gallery, as Craft has —
cards with a picture, switchable alongside the other views.

The board already exists and is switched to the same way, so the shape of the
answer is settled. What is not settled, and is the only real decision here, is
what the picture on a card **is**.

## Decisions

### A gallery is a third view type, not a mode of the table

`view_type = 'gallery'` in `collection_views`, chosen the way a board is. The
`ViewType` union has had `gallery` in it since the first version of the model; this
fills it in.

Filters, sorting and the search box apply exactly as they do to a table, because
they belong to the view and not to the drawing — and a gallery that could not be
filtered would be the one view where those controls quietly did nothing.

### The cover is the first image in a files column

No new field, no new attribute on a row: ADR-0035 gave a table columns that hold
files, and each file carries the category the server decided. So the cover is the
first file of category `image` in the view's cover column, and the cover column
defaults to the first files column in the collection.

The alternative — a `cover` attribute per row, as a page has — was rejected. It
would be a second place to put a picture, and the question "why does my table's
image not show in the gallery" has no good answer when the answer is "that is a
different picture".

`coverFieldId` may name a different files column, for a collection with two.
Stored in the view's definition, like everything else the view decides.

### A row with no image gets a blank panel, not a placeholder image

An empty tinted panel of the same size, which is what Craft does and what keeps a
grid a grid. Not a generic icon, and emphatically not the first image found
anywhere in the row's document: a gallery must not show a picture that is not in
the column it says it is showing.

### The cover is cropped, not fitted

`object-fit: cover`. A gallery of mixed aspect ratios fitted inside the same box
is a grid of letterboxes with ragged whitespace, which reads as broken rather than
as considerate. Cropping loses part of the picture and keeps the grid, and the
whole point of the view is the grid.

### A card is a cover, a title, and the values a board card shows

Same card body as the board: the title opens the row, because a row is a page.
The values below it are the ones the view is already showing, so a gallery is
genuinely the same data with a picture attached rather than a different report.

### The gallery is offered only when there is something to show it with

A gallery of blank panels is not a view, it is a mistake nobody meant to make. So
the offer to add one appears when the collection has a files column, in the same
way the board's offer appears when a select column exists. An existing gallery
whose column was deleted keeps working and draws blank panels — it was asked for
once, and removing a view because a column went is a bigger decision than drawing
it empty.

## Consequences

No migration: `view_type` is a text column and the type union already named this.
One route change — the creatable view types — and a component.

Filters and sorting come for free, which is the argument for making it a view
rather than a display mode.

Somebody with a collection of files but no images gets a gallery of blank panels.
That is the honest drawing of what is there, and the alternative — falling back to
any file's icon — would make the view about attachments rather than pictures.

## Alternatives considered

**A `cover` attribute per row**, as pages have. Rejected above: a second place for
a picture, and no good answer to why one of the two shows.

**A display mode of the table view** rather than a view of its own. Rejected: it
would make "gallery" a property of a view that also has a row height and a set of
filters, and switching would then discard nothing — which sounds better until two
people want the same collection as a table *and* as a gallery at once, which is
exactly what having views is for.

**Fitting the cover instead of cropping.** Rejected on the grid, but worth
revisiting as a per-view choice if anybody actually has a collection of tall
images; the setting would live beside `coverFieldId`.
