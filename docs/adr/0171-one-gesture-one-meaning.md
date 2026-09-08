# ADR-0171: One gesture, one meaning

## Status

Accepted. Built. Corrects what ADR-0170 shipped.

## Context

Reported the moment internal links existed, as a question rather than a
complaint:

> Man landet aber direkt beim klicken auf den link am verlinkten inhalt. Bei
> normalen externen Links muss man gezielt erst drauf klicken und dann auf Link
> öffnen gehen. Gewollt? Könnte sogar sinnvoll sein.

Not intended, and the two-step is right — but the reason has nothing to do with
deliberateness. ADR-0157 settled it:

> A link nobody can correct is worse than one nobody can follow, so the plain
> click stays what it was.

In editable text a plain click puts the caret in the word. **Nothing in that
reasoning mentions where the link points.** ADR-0168 said the same thing again
for comment marks: *"the words under a comment mark are ordinary writing and
somebody clicking them is usually about to type"*.

So the same gesture was doing two different things depending on which host the
address named — and worse than inconsistent: **the words of an internal link
could not be edited at all**, because clicking into them left the page.

## Decisions

### The application stands down inside editable text

`useLinkInterception` is a listener on `document`. `followLinks` returns `false`
for a plain click in an editable view — deliberately not handling it, so the
caret lands — and the click carried on up to the interception, which navigated.

The editor was not overruled. It was answered first by something above it that
did not know the question had already been settled.

`answersClick(anchor)` is `anchor.closest('[contenteditable="true"]') === null`.
The browser's own word for *this is text being written*, rather than a class or
a ProseMirror API: it is what makes a browser refuse to follow the anchor in the
first place, and it stays true for whatever draws editable text here next. A
read-only view carries `contenteditable="false"`, where there is no caret to
place and following the link is the only thing a click can mean.

### A link home is followed here; a link out is followed over there

Three places follow a link, and each had its own idea:

| | before | now |
|---|---|---|
| a row in the links panel | new tab | in place (ADR-0170) |
| a plain click in a read-only page | `window.open` | in place |
| *Öffnen* on the link card | `window.open` | in place |

ADR-0170 fixed the first and left the other two, because internal links were one
round old and nothing had followed one yet.

`followLinks` now leaves an internal href alone: nothing prevented, nothing
opened, so the click reaches the interception that already knows how to navigate
in place — **and how to put a share visitor's credential back on**, which a
second tab would have lost. The one exception is the modifier: cmd-click means
*somewhere else* in every browser and every application, and an address pointing
home is not an exception to a gesture that general.

### *Öffnen* is an anchor, not a button

It called `openLink`, whose two jobs were asking `isFollowable` and then
`window.open(…, '_blank')`. The first is load-bearing; the second was the fault.

As a real anchor, one address gets one treatment: the interception answers a
link home exactly as it answers one in the text, the browser opens an external
one in its own tab, and `rel="noopener noreferrer"` sits on the element where a
browser looks for it rather than in a call. An address that executes is drawn as
a disabled row — the shape the links panel already uses for the same refusal.

### One definition of what counts as ours

`isSameOrigin` lives in the editor's `hrefs.ts`, beside `isFollowable`, for the
reason that file's header already gives about the other one: two places have to
agree, and **a rule written in two packages is a rule that gets updated in one**.

Parsed rather than compared as text, because the shapes that fool a string test
are the dangerous ones: `//evil.example/p/x` is protocol-relative and resolves to
another host while looking like a path; `javascript:` has no origin at all. Both
come back as *not ours*.

## Consequences

**Six tests on the web side** and **three in the editor**, driven through the
plugin's own handler with real elements — what is being decided is `closest()`
against a DOM tree, and the tree is the whole input (the shape of ADR-0168's
tests, for the same reason).

### A fixture with no origin agreed with itself

The editor's link tests built their JSDOM without a `url`, so
`window.location.origin` was the opaque string `"null"`. Nothing resolves against
that, every address looked external, and the first run of the new rule opened a
link home in a new tab while the test said it should not.

The fixture had to be given an origin to be a world the application has. **The
third time this shape has been written down here** — PR #103's subscription
order, ADR-0167's missing editor, and now a missing origin: *a fixture that does
not reproduce the caller's world agrees only with itself.*

### Two tests changed, and both were right about their subject

`followLinks.test.ts` asserted that a relative address in a read-only view is
passed to `window.open`. It was written to pin *the attribute, not the property*
— which is still true and still tested. What it also pinned, without meaning to,
was a new tab for a link home; internal links did not exist, so nothing had to
disagree.

`linkCard.test.tsx` asserted `openLink(existingLink.href)`. Its subject is the
door that refuses a script, and the door is still there — asked before the anchor
is drawn at all. The mechanism moved; the property did not.

**A test can be correct about what it was written for and pin something else by
accident.** Both of these did, and in both the accident was `window.open`.

## Alternatives considered

**Leave it as it was.** It is quick, and it makes an internal link a word you
cannot edit.

**Have the editor consume the click and navigate itself.** The editor package
would need the router, or a bridge to it, for something the application already
does at the door.

**Ask ProseMirror whether the view is editable, rather than the DOM.** The
interception would then need a handle on the view, which is exactly the coupling
a document-level listener exists to avoid — and `contenteditable` is what the
browser itself is reading.
