# ADR-0035: One column for files, not one per kind of file

## Status

Accepted and implemented.

## Context

A table needs a column that can hold a picture. Asked as an open question: an
image column, or a general media column that could also hold a PDF — and if
general, whether "file", "PDF" and "image" should be three types.

## Decision

**One type, `files`, holding a list of file ids.**

The deciding argument is that the file already says what it is. Every upload is
classified by the server from its mime type — image, pdf, text, document, archive
— so a column type that *also* declared its kind would be a second answer to a
question already answered. The only thing three types could add over one is
refusing a PDF in an "image" column, and nobody has ever wanted that refusal.

What genuinely differs between an image and a PDF is how a cell should be drawn,
and that is a rendering decision made per value: an image is a thumbnail, because
that is how an image is recognised — a filename out of a camera says nothing —
and everything else is an icon and a name, because that is how a document is
recognised. The drawing follows the file, not the column.

This is also what the data model already said. `FieldType` has had `files` since
the first migration, `StoredValue` has had `{ kind: 'files'; fileIds: string[] }`,
and the materialiser has projected its count into the sort shadow all along. Only
the interface never offered it. Adding two more types would have meant extending a
model that had already made this decision, in order to disagree with it.

### A cell stores ids; names come from the collection

The response resolves every referenced file once for the whole table. A name and a
size are the file's own facts, and a copy of them inside each cell is how a
renamed file keeps its old name in three places.

Bounded to the workspace when resolving, because a cell holding an id from
elsewhere must not be the thing that reveals another workspace's filenames.

### A file uploaded into a cell belongs to the row

The row is a page (ADR-0021), and a file is authorised through the page it hangs
on. So the upload names the row: the file is reachable exactly as far as the row
is, and deleting the row takes it along. No new authorisation path.

### Eight files per cell

A cell is a cell. Somebody with twenty documents about one entry has a page to put
them on — that is what a row being a page is *for* — and a table whose cells are
folders is a table nobody can read.

### Removing a chip removes the reference, not the file

The file stays on the row's page. Deleting somebody's upload is a decision, and a
× on a chip in a table cell is not where it should be made.

## Consequences

No migration and no format change: the field type, the value shape and its
projection all existed. What changed is a whitelist, a validation, and a cell
renderer.

An image column is now expressible and so is a mixed one, and a view can already
sort by "how many files" because the shadow column has always held the count.

If a "gallery of images" ever wants a column that is *only* images — for a layout
that assumes a picture in every row — the answer is a view that filters on
category, not a second field type. Writing that here because it is the shape the
next request will arrive in.

## Alternatives considered

**Three types: image, pdf, file.** Rejected above: the file already carries its
kind, and three cells that all pick a file and differ only in what they refuse is
three code paths for one behaviour.

**An `image` type only**, as the narrowest answer to what was asked. Rejected
because the second request — a PDF in a table of tenders — arrives immediately,
and then either the image column quietly accepts PDFs or there are two.

**A single file per cell** rather than a list. Simpler renderer, and the model
already said `fileIds` in the plural. Following the model costs nothing here and
avoids the shape change later.
