# ADR-0113: A link that keeps the link

## Status

Accepted. Built. Reported from use.

## Context

Somebody opened a shared folder through a link. Clicking a subpage in the
sidebar opened it. Clicking the same subpage in the folder's own listing — the
"SEITEN" section in the page body — landed on the login screen.

Two builders, one of them wrong:

```tsx
// the sidebar, App.tsx
href={`/s/${encodeURIComponent(token)}/p/${entry.id}`}

// the listing, FolderView.tsx
href={paths.page(child.id, child.title ?? undefined)}   // -> /p/<id>/<slug>
```

`/p/…` is a workspace route. An anonymous visitor on one falls through every
branch in `App`'s router to `LoginScreen`. The credential was dropped by the
link, one click into a document somebody had been given.

## What was already written down

`paths.ts` has said the rule in its own header since ADR-0016, third of four
properties:

> A share link keeps its prefix while navigating its subtree, or clicking a
> subpage drops the credential and hits a login wall mid-document.

It is an accurate description of the bug, written before the bug, in the file
that could not prevent it. Beneath it, `paths.sharePage()` — the correct
builder — had **no callers anywhere in the web package**. The one place that
needed it built the string by hand instead, so the only correct function in the
codebase was dead code sitting under a paragraph explaining why it mattered.

That is the shape this project keeps finding, one turn further out than
ADR-0102's "nothing reads it": here the sentence was true, the function was
right, and neither was reachable from the mistake.

## It was not one link

`FolderView` is what was reported. The same call is in the collection table, the
gallery, the board, a relation chip, a collection cell and the editor's own
container navigation — **all of them page body content**, so all of them render
inside a shared page for somebody with no session. Nineteen call sites in total,
ten of them reachable from a share view.

None of them could have got it right. `FolderView` is rendered by the share view
*and* by the workspace shell and is passed nothing that distinguishes them; a
relation chip is four components below anybody who knows.

## Decisions

### The mode is not a parameter

`usePageLink()` reads a share token from context and returns a function that
builds the right shape. A component asks for a link to a page and gets one that
works where it is standing.

This is ADR-0087's argument again, and the third time it has been the answer: *a
parameter every caller has to compute correctly is a parameter one caller
computes wrongly.* There the parameter was "does this person hold full access",
computed by thirteen callers, one of which passed the literal `false`. Here it
was not even a parameter — it was a sentence in a doc comment, which is the same
arrangement with nothing to grep for.

Context rather than a prop, because a prop is what would have to reach a
relation chip through four components that have no business knowing. The
provider wraps the share view from **outside**, so `ShareSession`'s own sidebar
is in the context too — its hand-built string is gone, and the half that was
right no longer has its own answer.

### `paths.page` is not available to a component

`scripts/check-page-links.mjs` fails the build on `paths.page(` anywhere in
`packages/web/src` outside `routes/`.

ADR-0104 refused a checker for a family with one member and said exactly what
would change the argument: the number. This family had nineteen.

**No exception list, deliberately.** With no token in context the helper returns
what `paths.page` returns, so a screen that can only ever be a member's loses
nothing by asking — and an exception list is precisely where the next component
that "obviously cannot be shared" would be written down by somebody about to be
wrong about that. ADR-0112 found an exception entry for a name its checker had
never produced; one that is merely wrong is not better.

### `sharePage` gains the block fragment

`page` took a `blockId` and `sharePage` did not. Nothing links to a block from a
share view yet, so nothing was broken by it — the asymmetry is *how the two
looked interchangeable* while one of them was not. They are the same signature
now, and the helper is the only caller of either.

## Consequences

**Three mounted tests, two of them failing before the change**, reading the
`href` off the anchors: a shared folder listing, the same listing outside a link
(a fix that made every link share-shaped would pass the first and break the
whole workspace), and a relation chip inside a shared page — which was not what
was reported and had the same fault.

**Five guard tests**, including one that watches the checker fail and one that
proves a `paths.page` named in a comment is not a call.

**Three existing tests broke, and all three name a function rather than an
outcome.** A gallery card's link, a search result's block fragment and the
relation chip were asserted as source matches for `paths.page(...)`; the call
was renamed and they stopped matching. None of them could have said whether the
URL was right. Two are updated to the new name — they were never about this —
and the relation one is deleted, because the mounted test now reads its href.
That is the **sixth** source-level assertion this project has moved, and the
sixth time it moved at a change that made its subject stronger.

## Alternatives considered

**Give `FolderView` the token as a prop.** Four lines, fixes what was reported,
leaves the other nine call sites and adds a tenth way to get it wrong. It is
also the arrangement that produced this: a value the caller must remember to
pass, in a component that has two callers.

**Put the token in the URL for every route** so there is one shape. It makes a
member's link and a visitor's link indistinguishable in the address bar, which
ADR-0016 rejected on the grounds that they carry different authorisation and the
difference should be visible.

**Make `paths.page` itself read the token**, from a module-level variable set by
the share view. No hook, no context, no component changes at all — and a global
that a server render or a second document would get wrong, with a lifetime
nobody can see. The context is the same idea with a scope.

**Rewrite the anchors as a `<PageLink>` component.** Tidier at the call site and
a much larger change: several of these are not anchors (a `window.location`
assign, three `navigate(...)` calls), so there would still be a function beside
the component and two ways to do it.
