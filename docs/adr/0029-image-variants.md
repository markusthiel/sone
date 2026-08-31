# ADR-0029: An image is kept twice, and shrunk in the browser

## Status

Accepted and implemented.

## Context

Two requests with one decision underneath: a profile picture that accepts a
large file and shrinks it, and content images that display a smaller version
while keeping the original available to download.

Today an uploaded image is stored once, as sent, and displayed at whatever size
the page gives it. A photograph straight from a phone is eight megabytes and
four thousand pixels wide, sent in full to everybody who opens the page — on a
phone, over mobile data, to be drawn six hundred pixels wide.

## Decisions

### Two files, related, both kept

An upload produces the **original**, untouched, and a **web version** bounded to
2048 pixels on the long edge. The web version is what a page displays and what
sync carries; the original is what "Download the original" gives.

Keeping both costs storage, and that is the trade being made deliberately: the
alternative is either sending eight megabytes to draw six hundred pixels, or
discarding what somebody uploaded. The second is worse than it sounds — a
photograph resized on the way in cannot be got back, and somebody who put their
only copy in a note has lost it without being told.

### Shrunk in the browser

The resizing happens client-side, on a canvas, before the upload.

Server-side would mean a native image library in the container. That is a
dependency with its own security releases, a build that differs by architecture,
and an image several hundred megabytes larger — for work the machine doing the
uploading can do while somebody watches a progress bar they were going to watch
anyway.

It also means the network carries the large file once rather than the small one
plus the large one, which matters most on exactly the connection where it hurts
most.

**The cost, stated:** a client that cannot resize — an old browser, a script
posting to the API — uploads only an original. The server therefore treats a
missing web version as normal and falls back to the original rather than
refusing, and nothing in the interface assumes both exist.

### The relationship lives on the file, not in the block

A file row gains `variant_of` and `variant`, so the pair is a fact about the
files rather than something a block remembers. A block that stored both ids
would be a block that can lose one, and an image copied into another page would
carry a reference to a variant nobody can find.

### Only for images, and only above the bound

A small image is uploaded once and has no variant. Producing a "web version"
that is the same size as the original is two files where one would do, and a
download menu offering two identical files is a menu that makes somebody choose
between nothing.

### Avatars are the same mechanism, bounded harder

A profile picture is an image upload with a 512-pixel bound and no original
kept. It is cropped to a square and displayed at 22 pixels; the original serves
nothing, and keeping a face at full resolution because the code path was already
there is not a decision anybody made.

## Consequences

`files` gains two columns and images gain a second row on upload. The materialiser
and the orphan sweep both need to know a variant is not an orphan.

The file block's menu gains "Download the original" beside "Download", and only
when a variant exists — otherwise it is one entry, as now.

Existing images have no variant. They keep working, displayed at full size, and
a later pass could generate variants for them; nothing here requires it.

## Alternatives considered

**Resizing on the server with a native library.** Rejected above on the size of
the dependency, not on the quality of the result — which would be better, and is
the reason to revisit this if the browser path turns out to produce visible
artefacts.

**Storing only the web version.** Rejected: it destroys what somebody uploaded,
silently, and the person most affected is the one who put their only copy of a
photograph into a note.

**Resizing on display, in CSS.** What happens today. It is not a size decision at
all — the bytes still travel.
