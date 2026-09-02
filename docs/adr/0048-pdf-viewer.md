# ADR-0048: A PDF viewer of our own

## Status

Accepted.

## Context

A PDF in a page is drawn by the browser, in an `<iframe>`. On Chromium and
Firefox that is a real viewer with scrolling and paging. On iOS and iPadOS it is
a static picture of the first page: WebKit renders an embedded PDF without a
viewer, and no attribute changes it. So the same document is readable at a desk
and unreadable on the device most likely to be reading it.

There is no way to fix that with the embed. The choice is between telling
somebody to open the file elsewhere — which is where this landed as a stopgap —
and rendering the pages ourselves.

## Decision

**Render PDFs with `pdfjs-dist`, as a library rather than as its viewer.**

Two things ship in that package: a prebuilt viewer (`viewer.html`, its own
toolbar, its own stylesheet, its own idea of what a document looks like) and the
rendering engine. We take the engine. Every page is drawn to a `<canvas>` we
place, and everything around it — the scrolling column, the page indicator, the
controls, the colours — is ours, in our own tokens.

That is the answer to whether it can be made to look like SONE: not "themed",
but *ours*, because the dependency draws pixels of a page and nothing else.

### The dependency, weighed honestly

ADR-0004's rule is that a dependency has to earn its place. This one:

- **448 KB for the engine, 1.3 MB for its worker**, minified. Roughly 130 KB and
  400 KB over the wire.
- **Loaded only when a page actually shows a PDF.** A dynamic import, so nobody
  who never opens a PDF ever downloads it, and the main bundle does not change
  size at all.
- **Served from our own origin.** The worker is bundled as an asset by the build;
  nothing is fetched from a CDN, which would be a third party watching who reads
  which document (ADR-0005's reasoning about self-hosting applies to assets too).

The alternative to a dependency here is writing a PDF renderer, which is not a
weekend and would be worse. The alternative to *rendering* is what we have now: a
document that cannot be read on a phone.

### A scrolling column, not a page-turner

Pages are stacked and scrolled, which is what a PDF viewer means to everybody who
has used one — and what the desktop already did before this. Paging controls are
a second way to move, not the only way.

Pages are rendered when they come near the viewport and not before. A hundred-page
document must not draw a hundred canvases to show its first one, and an
`IntersectionObserver` is how the browser answers "is this nearly visible" without
a scroll handler measuring things.

### Rendering is bounded on purpose

- **At most twice the device pixel ratio, and never more than 2.** A canvas at a
  phone's full pixel ratio times a zoom factor is tens of megabytes for one page.
- **A page's canvas is released when it goes far out of view**, or a long document
  read to the end holds every page in memory at once.
- **One page rendered at a time per document.** Concurrent renders of ten pages
  make the first one slower, which is the only one anybody is waiting for.

### What is deliberately not built

**Text selection and searching inside a PDF.** pdf.js can produce a text layer,
and it is the natural next step; it is also a second rendering pass per page and
its own set of positioning problems. Reading comes first.

**Annotating.** A different feature: it means writing to somebody's file, or
storing marks beside it, and neither belongs in a first viewer.

**A print view.** The browser's own print of the original file is better than
anything we would build over canvases.

## Consequences

`pdfjs-dist` is the first dependency in the web package that ships more code than
the application's own bundle. It is loaded lazily, and the test that keeps that
true asserts the import is dynamic — a static import would quietly add half a
megabyte to every first load, which is exactly the kind of regression nobody
notices.

The viewer is imperative rather than a React component, because the file block is
a ProseMirror node view. That is the same arrangement the collection and video
views already use.

Upgrades matter more than for most dependencies: a PDF renderer parses untrusted
files. pdf.js runs in a worker and SONE serves attachments with a policy that
lets them load nothing (see the file routes' header comment), but the version
still has to be kept current.

## Alternatives considered

**The prebuilt pdf.js viewer in an iframe.** Works everywhere and looks like
pdf.js: its own toolbar, its own dark grey, its own fonts, sitting inside a page
that has spent a lot of effort on how it reads. Rejected for that reason, and
because restyling somebody else's viewer through an iframe is not restyling.

**A server-side render to images.** Every page becomes a PNG on upload. No
client dependency, and it turns every PDF into a pile of pictures we then have to
store, invalidate and serve — and a text document becomes unsearchable and
unselectable for ever, not just for now.

**Leave it as a link.** What is there today. Honest, and it means a PDF in a page
is a link on a phone rather than content.
