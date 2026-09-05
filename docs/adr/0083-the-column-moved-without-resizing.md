# ADR-0083: The column moved without resizing

## Status

Accepted. Amends the reasoning in `useViewportChanges`, twice corrected before
this.

## Context

The block handles, the slash menu and the formatting toolbar are `position:
fixed` at coordinates measured from the document. `useViewportChanges` exists to
tell them to measure again, and its own header records two earlier attempts at
the same bug: first a scroll listener, then a `ResizeObserver` on the editor
element, with the note "that is how the block controls ended up inside the first
line, and it is not what I said it was when I first 'fixed' it."

The report this time: the handles stay behind when the sidebar is collapsed or
expanded, or when its width is dragged — and usually come right again on
clicking into different content.

The cause is one line of CSS reading against one line of JavaScript.

```css
.page-body { max-width: 46rem; margin-inline: auto; }
```

On any window wider than 46rem plus the sidebar, collapsing the sidebar changes
how much room the pane has, and the column **re-centres inside it without
changing width at all**. Its used width was 46rem before and is 46rem after.

`ResizeObserver` reports size. It had nothing to report. No window `resize`
fires either, because the window did not resize. So `viewportToken` never
changed, the positioning effect never re-ran, and the gutter kept a `left`
computed against where the text used to be — until a selection or an edit
happened to recompute it, which is exactly the "usually fixes itself when you
click something else" in the report.

Three of the four overlays did not even pass an element to watch, so they had
only the window and the visual viewport: the formatting toolbar, the table
toolbar and the slash menu all drift the same way, and nobody had noticed
because the handles are the thing you look at while a document is still.

## Decision

**Watch the element and its ancestors.** The pane that got wider is what
changed; the editor inside it did not. One `ResizeObserver` over the chain
catches it, costs a handful of targets, and coalesces into the same single frame
a scroll already uses.

It also catches the next layout that moves the text for a reason this hook has
not been told about, which is the point of a hook whose question is "did
something move" rather than "did this specific thing resize". Both previous
versions of this fix were narrower than the question, and both were wrong in
the same direction.

**All four overlays pass the editor element.** They share one positioning
strategy and had one bug in three quarters of the places it could appear.

## Consequences

The alternative fix is to stop measuring: make the gutter `position: absolute`
inside a positioned ancestor of the column, so the browser moves it and no
JavaScript is involved in the horizontal axis at all. That is the better shape
and it is a larger change — the vertical position still comes from the block's
box, the controls must escape the editor's overflow, and the menu that opens
from the ⋮⋮ is positioned against the button. Worth doing on its own, not as
part of a bug report.

The test does not prove the browser behaves. jsdom has no `ResizeObserver` and
lays nothing out, so what it asserts is what the hook *asks to be told about* —
the pane as well as the editor. That is precisely the decision that was wrong,
and it is checked by mounting the hook with a stand-in observer rather than by
reading the source, so a future rewrite that keeps the shape but drops the
ancestors fails.
