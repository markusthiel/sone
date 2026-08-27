# ADR-0016: Web client architecture

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Three things about the web client are expensive to change later. Everything
else — component library, visual design, keyboard shortcuts, slash menu
contents, which block types come first — is cheap to change and better decided
after a week of using it than at a whiteboard.

This ADR covers only the three. It deliberately does not specify the UI.

## Decision

### 1. Package boundary: the client core knows nothing about React

`@sone/client` holds the sync connection, the document store, the local cache
and the query layer. It has no React dependency and no DOM dependency beyond
`WebSocket`.

`@sone/web` holds React components and hooks. It never opens a WebSocket, never
touches a Y.Doc directly, and never builds a query.

Already committed to in ADR-0009 as a precondition for native mobile later, but
it earns its place independently: a store reachable only through hooks cannot be
tested without a renderer, and the interesting bugs in a local-first client are
all in the store.

The boundary is enforced by a lint rule on import direction, not by good
intentions.

### 2. URL structure is a public contract

Share links get written into emails and chat messages. A link someone sent in
2026 must still work in 2028. This is the one part of the UI that cannot be
refactored freely, so it is settled now:

```
/                                 workspace root, redirects to last page
/p/:pageId                        a page
/p/:pageId/:slug                  a page, slug for readability only
/s/:token                         a share link
/s/:token/p/:pageId               a page within a share link's subtree
/login  /signup  /setup           auth
/settings/:section                account and workspace settings
/search?q=                        search results
```

Four properties, each with a reason:

- **The page id is in the path, the slug is decorative.** A renamed page keeps
  working. Wikipedia-style slug-only URLs break on every rename, and a note-
  taking tool renames constantly.
- **Share links are `/s/:token`, a separate space from `/p/`.** An anonymous
  visitor's URL must not be confusable with a member's, because the two carry
  different authorisation and the distinction has to be visible in the address
  bar.
- **A share link keeps its prefix while navigating its subtree.** Otherwise
  clicking a subpage drops the credential and the visitor hits a login wall
  mid-document.
- **No workspace id in the path.** A user is in one workspace at a time and the
  session carries it. Putting it in the URL means every link breaks when a page
  moves between workspaces.

Tokens appear in the path rather than the query string, so they stay out of
`Referer` headers on outbound links.

### 3. Touch and narrow viewports from the first component

Not desktop-first with a mobile pass later. Binding, because ADR-0009 makes the
PWA the first mobile client and because retrofitting touch into an editor with
drag handles and hover-revealed controls is close to a rewrite.

Concretely, from the start:

- Every interaction reachable without hover. A drag handle that only appears on
  `:hover` does not exist on a phone.
- Logical CSS properties (`margin-inline-start`, not `margin-left`) and `dir`
  handling, so right-to-left is a setting rather than a rewrite (ADR-0011).
- No `window` width branching in components. Container queries and CSS, so a
  narrow panel on a wide screen behaves like a narrow screen.
- ICU MessageFormat for all text, no sentence concatenation (ADR-0011).

## Consequences

The store is testable without a browser, and a native client later is a
different surface over the same logic rather than an excavation.

The URL structure constrains routing. Adding a workspace switcher, for
instance, means a session-level change rather than a URL change — which is more
work but keeps existing links valid.

Touch-first costs some desktop density early on. Hover-revealed controls make a
desktop UI cleaner, and refusing them means finding another way to keep the
page uncluttered. That is a real design cost, accepted deliberately.

Nothing here says what the editor looks like. That is intended: it is the part
that should be shaped by use, not by an ADR.

## Alternatives considered

**Store inside the React tree via context and hooks.** Conventional and faster
to start. Rejected on testability and on ADR-0009.

**Slug-only URLs.** Prettier. Rejected: a note tool renames pages constantly,
and every rename would break every existing link.

**Share tokens in a query parameter or a cookie.** A cookie would keep the URL
clean, but then a share link is not self-contained — forwarding it to someone
who has a stale cookie for a different link would silently show the wrong
thing. Query parameters leak into `Referer`.

**Desktop-first, mobile later.** Rejected in ADR-0009; recorded again here
because it is the decision most likely to be quietly abandoned under time
pressure, and abandoning it invalidates the mobile plan.
