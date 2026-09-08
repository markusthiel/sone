# ADR-0175: A page has a workspace, and the address does not say

## Status

Accepted. Built. Clears the way for cross-workspace links.

## Context

Asked as a question about the `[[` picker:

> Das [[ Menü sucht allerdings nur im selben Workspace richtig? Kann man das
> ausweiten auf alle in denen ich bin?

It can. But the first thing to check was not whether the picker *could* offer
such a page — it was whether the link would open, and **it would not**. Read
rather than guessed, and the chain is three files long:

1. A page address carries no workspace, deliberately (ADR-0016): *"the session
   carries it, so a page moving between workspaces does not invalidate every
   link to it."*
2. The sync client is built with one workspace in its credentials, memoised on
   it.
3. And the server refuses the room, correctly and first:

```ts
if (page.workspaceId !== claims.workspaceId) return null;
// A page in another workspace is invisible regardless of grants.
// Checked first: this is the boundary that must never leak.
```

So the interface opened the right address on a connection bound to the wrong
workspace and reported *"you no longer have access to this page"*, which was not
true and pointed nowhere useful.

**The application already knew this.** The inbox met it and left a note:

> a notification about a page in another workspace opened the right address on a
> connection bound to the wrong one — and the page said "you no longer have
> access to this page", which was not true and pointed nowhere useful

The inbox solved it by carrying a workspace id **beside** the address. A link
written into a document cannot: it is only an address, and putting a workspace
into it is exactly what ADR-0016 refused, for a reason that has not changed.

## Decisions

### The address stays as it is, and where it lives is looked up

`usePageWhereabouts` answers one question — *which workspace is this page in* —
and the caller opens the document only once it has an answer.

### The tree first, the server only when it must be

The ordinary case is a page in the workspace somebody is standing in, and the
tree already lists every entry there. So the request happens only for an address
the tree does not account for: the cross-workspace case, and the archived-page
case, and nothing else. **A page in this workspace costs no request at all.**

### Not in the tree is not the same as not here

An archived page is not listed and can still be opened by its address — which is
precisely what a link written before it was archived points at. So a server
answer naming *this* workspace means *open it anyway*; the tree is a listing, not
the set of pages that exist.

### The document waits until the answer arrives

`usePage` is handed null while the whereabouts are unsettled. That is what keeps
the connection from ever being asked for a room it will be refused — the refusal
that produced the false message.

The alternative was to open optimistically and correct afterwards: one refused
room and one false error on the way to the right answer. The tree is a single
request and arrives before a synced document does, so waiting for it costs less
than the flash it prevents.

### An answer about a different page is not an answer

Two addresses in quick succession — following a link, then Back — and the first
reply can arrive after the second question. The answer is keyed by the page it is
about, so a stale one cannot switch the workspace out from under the page
somebody is now looking at.

### A refusal is an answer; a dropped connection is not

404 and 403 mean *not there, or not yours* — the server does not distinguish
them on purpose, because the distinction reveals which pages exist. Anything
else leaves the question open rather than reporting a page as gone because the
network hiccuped.

## Consequences

**Nine tests**, all against `whereabouts()` — the decision as a pure function of
what is known, separated from the effect that fetches. Every branch is a rule,
and the rules are the part worth holding; a React tree and a network are not
needed to state any of them.

The fix reaches **every** cross-workspace page address, not only the ones a
picker will produce: one pasted by hand, one in an email, one somebody
bookmarked before a page was moved between workspaces. That last one is worth
naming — ADR-0016 chose an address with no workspace in it *so that* moving a
page would not break its links, and until now moving a page broke its links.

## Alternatives considered

**Put the workspace in the address.** It is the shape ADR-0016 refused and the
reason is unchanged: a page that moves would invalidate every link ever written
to it, which is the thing the uuid-only address exists to prevent.

**Carry it beside the address, as the inbox does.** Works where something builds
the link at render time. A link inside a document is data, and there is nowhere
beside it to carry anything.

**Have the sync connection accept any workspace the session covers.** That is the
boundary the server checks first and calls the one that must never leak. Moving
it is not a client convenience.

**Open every page optimistically and switch on failure.** The connection would
be asked for rooms it will be refused as a matter of routine, and a console full
of refusals is how somebody stops reading them (ADR-0057).
