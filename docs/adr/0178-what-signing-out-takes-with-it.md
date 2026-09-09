# ADR-0178: What signing out takes with it

## Status

Accepted. Built. Closes a loose end ADR-0176 shipped.

## Context

Asked plainly, after five rounds on cross-references:

> War noch was offen aus diesem Umbau?

Most of what those rounds left open was left open on purpose and written down.
One thing was not: ADR-0176 added a module-level cache of page titles across
every workspace a person is a member of, and shipped with a
`forgetLinkTargets()` written for exactly this and **called from nowhere**.

`useSession`'s logout already states the rule, in a comment beside the line that
clears the local documents:

> Signing out and leaving somebody's documents in the browser is the failure
> this guards against: the next person at that machine would find them in
> storage, readable without any credential at all.

**A logout is not a reload.** It revokes the cookie, clears `localStorage`,
clears the local documents and re-fetches the session — so a variable at module
scope outlives it. The next person to sign in in that tab and type `[[` would
have been offered the previous person's workspaces, by name and by page title,
with no credential of any kind.

That is the same failure the comment describes, in memory rather than in
storage. Not a large disclosure — titles, not contents — and not one that should
have to be noticed by being asked about.

## Decisions

### The cache is let go where the documents are

One line beside `clearLocalDocs()`, because that call is the precedent and the
reasoning is identical. Nothing new is invented for it.

### And the test is a census, not an assertion

Three assertions that the three known things are let go would have caught this
one and missed the next. So the test also enumerates **every module-level
mutable binding in `src/hooks/`** and requires the list to be exactly what the
logout accounts for.

A cache at module scope outlives a logout by construction. Adding one now means
editing this file by name — and being made to do that is the moment to ask what
it is holding, which is the question nobody asked in ADR-0176.

This is the third census in the suite, after the one over `useChoiceList` and
the one over the SQL columns, and it earns its place the same way: it fails when
somebody adds a thing, rather than when somebody breaks a thing.

## Consequences

**Four tests**, one of which is the census.

Nothing else in `src/hooks/` currently keeps state at module scope, so the list
has one entry. That is the useful state for it to be in: the next entry is a
decision somebody makes out loud.

## Alternatives considered

**Reload the page on logout.** It would clear every cache there will ever be,
and it throws away an in-progress edit that the CRDT is still flushing — the
case `clearLocalDocs` is careful about.

**Key the cache by user id.** It would answer this one and leave the titles in
memory afterwards, which is the part that matters.

**Hold it in React state instead.** Then it is refetched on every page somebody
opens, which is the request-per-page ADR-0176 avoided; the cache is about the
person, not the page.

**Report it and leave it.** It was found by being asked whether anything was
open, which is not a mechanism.
