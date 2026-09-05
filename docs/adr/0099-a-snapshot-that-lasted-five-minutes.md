# ADR-0099: A snapshot that lasted five minutes

## Status

Accepted. Built. Found by checking the chain that ADR-0098 had only checked the
first link of.

## Context

ADR-0098 made a group membership nudge the page tree, and asserted that the
nudge arrives. The obvious next question — **does the chain work** — had not
been asked, and asking it found something considerably worse than a missing
nudge.

The application has two halves with two different ideas of when to ask who
somebody is:

- **The tree** is fetched over HTTP, and `claimsFor` resolves claims per
  request. Always current.
- **The documents** are served over a WebSocket, and claims were resolved once,
  at authentication. ADR-0006 rule 1 re-checks the ACL on every document open —
  against that snapshot.

`SyncServer.revalidateConnection` exists to refresh the snapshot.
`SyncServer.revokeAccess(pageId)` exists to call it for everybody holding a
page, and its comment says exactly why: *"Revocation that only affects the next
connection is not revocation: an anonymous editor with an open socket would keep
writing."*

**It was called by nothing.** The only refresh in the running system was the
maintenance sweep, every five minutes.

## What that cost, in both directions

**Given.** Somebody added to a group gains pages. The nudge arrived, the tree
redrew with a new entry — and clicking it asked the sync connection, which knew
nothing about a group joined since. A page that appears and refuses to open is
worse than one that does not appear: the first reads as a broken application,
the second reads as a permission.

**Taken.** Somebody removed from a group, or whose grant was withdrawn, or whose
share link was revoked, or who was removed from the workspace entirely, **kept
every document they had open, writable, for up to five minutes** — while the
person who withdrew it had been told it was done.

Neither is new. Both have been true since the sync server was written; what is
new is that ADR-0095 put the role on each tree entry and ADR-0098 made the tree
live, which turned a quiet inconsistency into a visible one.

## Why nobody noticed

Three tests covered revocation on a live connection, and all three did this:

```
await revokeShareLink(db, link.shareTokenId);
await sync.revokeAccess(uuid(1));      // ← the test calls it
await client.waitForType(ServerMessage.Closed);
```

They proved the method worked. They could not notice that nothing else called
it, because they were the thing calling it.

This is the same shape as ADR-0091's *"a test that asserts a wire exists is not
a test"*, one step further out: these tests asserted an outcome, and supplied
the missing link themselves to get it. **A test that completes the chain by hand
is testing a chain that does not exist.** All five call sites are gone; the
tests now let the change travel the way it does in production, and they still
pass.

## Decisions

### An `access` scope, on the channel that already exists

The workspace channel carries `{workspaceId, scope}` (ADR-0097). Access changes
become another scope on it — and the one scope the **server** acts on and never
forwards.

No client wants to know that somebody's access changed *as such*; what a client
sees is a document closing, a role changing, or a tree with a new entry in it.
So `ACCESS_SCOPE` is deliberately not in `NotifyScope`, which is the set of
things a client can subscribe to: a name in that enumeration that nothing may
subscribe to is a name somebody will try.

### By workspace, deliberately not by page

`revokeAccess(pageId)` is replaced by `revalidateWorkspace(workspaceId)`.

A grant on a folder changes access to everything under it; a page moved changes
what its whole subtree inherits. Working out the affected pages in SQL would be
a second answer to a question `effectiveRole` already answers per open document
— which is what `revalidateConnection` then asks, once per document a connection
actually holds.

### Which changes count

| | access |
|---|---|
| `page_permissions`, `page_group_permissions`, `page_caps` | ✓ |
| `group_members` | ✓ |
| `workspace_members` — the largest revocation there is | ✓ |
| `share_tokens` revoked, downgraded, deleted | ✓ |
| a page restricted, moved, re-parented, deleted | ✓ |
| a rename, an icon, a title | |

**A rename must not revalidate anybody.** Revalidation loads a page location and
resolves a role per open document per connection; on a permission change that is
nothing, and on every rename in a workspace it is the cost this whole line of
work exists to avoid. It has its own trigger for that reason rather than a
branch inside the one that fires for renames — and its own test, which asserts
that a stale role *survives* a rename. A strange thing to assert on purpose, and
the honest way to say "nothing was re-read".

**`roles` is left out and named.** Changing what a role *means* changes access
for everybody holding it, and a system role is held in every workspace — so one
edit would revalidate the whole instance. The five-minute sweep covers it, and
doing better needs a decision about how, not another trigger.

### Coalesced, like everything else on this channel

An import can write a subtree's permissions as many statements, and each is a
nudge. A revalidation in flight absorbs the ones that arrive during it, and one
more runs afterwards to cover whatever changed while it was working.

## Consequences

**Revocation is revocation now.** A withdrawn grant closes the document it
opened, a downgrade arrives as `RoleChanged` rather than a disconnection, and
removal from a workspace ends the connection — all within the time it takes a
NOTIFY to cross the bus, on every instance rather than the one that served the
request.

**The maintenance sweep stays.** It is the net for everything with no trigger
behind it: a session expiring, a user deactivated, a `roles` edit. A push says
what happened while the server was listening; nothing says what happened while
it was not — the same argument the focus refresh gets in the browser.

**Six tests, four failing before the change.** The two that passed were "the
tree gets the grant", which was never in doubt and is the premise of the rest,
and "a rename does not revalidate anybody", which is the guard on the cost.

**A method with no callers survived four ADRs about this exact subject.** It had
a good name, a correct implementation and a comment explaining why it mattered.
What it did not have was anything exercising it from the outside — which is the
oldest lesson in this repository, and it keeps being about the same thing:
`claude/sync-schicht.md` opens with "a mechanism nothing exercises is a
mechanism whose behaviour is a guess".

## Alternatives considered

**Call `revokeAccess` from the routes that change permissions.** The obvious
fix, and it wires the sync server into the HTTP layer, misses every change made
by another instance, and misses anything done outside a route — an import, a
migration, a maintenance job.

**Shorten the maintenance interval.** Turns a five-minute window into a
one-minute window and multiplies the work by five. A window is the wrong shape
for revocation regardless of its width.

**Re-resolve claims on every document open instead of at authentication.** The
most correct answer, and it puts a claims resolution on the path of every open —
which for a page tree of subpages is many opens in a burst, on the interaction
people notice most.

**Give clients the `access` scope and let them reconnect.** A reconnect is
visible, loses awareness and re-syncs every open document, to achieve what the
server can do without telling anybody.
