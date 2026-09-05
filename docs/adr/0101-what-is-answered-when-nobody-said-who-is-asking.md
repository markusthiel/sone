# ADR-0101: What is answered when nobody said who is asking

## Status

Accepted. Built. Not a feature — a list of open points, checked.

## Context

`claude/rechte-und-zugriff.md` ends with a list of open points, and three of
them had been carried for weeks with the same kind of note attached:

> 2. `allow_anonymous: false` → HTTP 500 statt „bitte anmelden". **Latent, keine
>    Bedienung.**
> 3. **Workspace-Export ist nur durch die Mitgliedschaft geschützt** — jedes
>    Mitglied darf alles exportieren.

Plus one that was not on the list at all, and turned out to be the same
question: `visiblePagesCondition` with a null user matched every unrestricted
page in the workspace.

They are one question in three places: **what does this answer when the answer
to "who is asking" is missing?**

The reason to take the list seriously rather than re-reading it is that "latent,
nobody can reach it" ages badly. The reach is what changes, not the code — and
in the six months these entries sat there, ADR-0093 through ADR-0100 added a
notification bell, four notify scopes, a role on every tree entry and a live
revalidation path, every one of which is a new caller.

## What the three were

### The condition

`visiblePagesCondition(alias, userParam)` builds the `WHERE` fragment that
thirteen list queries use. Its first branch is *nothing on this page's path is
restricted*, which is true of most pages and says nothing about who is asking.

That is deliberate, and the comment says so: every caller establishes membership
first, and the condition answers the narrower question of what is withheld
*within* a workspace somebody is already in.

It also means a null user matches every unrestricted page. No caller passes
null — a dozen of them write `kind === 'anonymous' ? null : userId` and every
one of those ternaries is unreachable, because each route requires a session
before it gets there.

**A rule that holds because each of a dozen callers happens to prevent it is the
shape this repository has been bitten by six times** (ADR-0088, ADR-0091,
ADR-0092, ADR-0094, ADR-0098, ADR-0099), and three of those six were the caller
written most recently. So the condition answers no, rather than relying on
nobody asking.

The counterweight matters as much: a fix that read as "members see less" would
be worse than the latent hole. There are two tests, and the second is the one
that keeps the first honest.

### The export

The open point said every member may export everything.

**It is not true any more.** Both exports go through one builder, and the
builder puts every page through the same condition as the tree and the search.
The note was written when only the subtree half had been fixed (ADR-0089), and
nobody went back.

That is its own finding, and the reason this ADR exists at all: **an
open-points list nobody re-checks is a list that describes a codebase that no
longer exists.** The entry is now marked as done rather than deleted, and it has
a test rather than my word for it — because the next person to read that list
deserves better than a second unverified sentence in the other direction.

### The link that needs an account

`allow_anonymous: false` means the link exists and grants nothing until somebody
signs in and claims it. The resolver **threw** for that case, and the route did
not catch it.

So the answer was HTTP 500 — and the interface, seeing a failed resolve, fell
through to the "what is your name" form, and then to a connection error. Two
wrong screens in a row for a link that is working exactly as its author set it
up.

## Decisions

### A state, not an exception

`ShareTokenResolution` gains `signInRequired: boolean`, beside the
`passwordRequired` that has always been there. The two are the same shape: *the
link is fine, and here is what is still needed.*

A throw makes every caller decide what an exception from a resolver means, and
the caller that mattered most — the route a visitor's browser hits first —
decided nothing. As a state it lands in a branch every caller already writes.

The claims returned are empty, exactly as the password branch returns them.
Confirming that a live link exists is what the neighbouring case already does;
what must not leak is anything about the page behind it, and the test asserts
the absence of `pageId` and `title` rather than trusting the shape.

### The caller says whether somebody is signed in

`allow_anonymous: false` requires an **account**, not membership — the link is
how somebody gets in, and the point of the flag is that it records who.

Whether an account is present is a question about a *second* credential, and
this resolver is handed a share token and nothing else. So `opts.signedIn` is an
explicit argument and the three callers answer it, rather than the resolver
learning to read cookies and each caller's answer then depending on which
headers happened to be on the request.

`GET /api/share/:token` resolves the session first for that reason, which it did
not need to do before.

### The screen says the one thing there is to do

`requiresSignIn` on the resolve response, its own state in `ShareRoute`, and an
early return before the name form — with a link to sign in.

Not a kind of failure: the link is not broken and the page is not gone. There is
exactly one thing to do and the screen can say it.

## Consequences

**Six tests, six failing before the change** — including the two that assert the
export is already correct, which fail on the old code for the null-user case and
pass for the member case, which is the honest way to record "one of these three
was already done".

**The condition now needs a cast.** `${userParam} IS NOT NULL` is the parameter's
first mention and gives Postgres nothing to infer a type from; `::uuid` fixes it
and the comment says why, because the next person to add a branch there will hit
it again.

**Two of the six remaining open points are unchanged and stay on the list**: the
old `workspace_members.role` enum that nothing reads, and the absence of a
mechanical guard against the next copied "the listing already excluded it"
comment. Both are still true, and neither is a hole.

## Alternatives considered

**Leave the condition alone and rely on the callers.** Correct today, and it is
the argument that has failed six times in this repository. The cost of the fix
is one `AND` on thirteen queries against an indexed column.

**Have the resolver read the session cookie itself.** Removes the argument and
adds a dependency from the claims layer to HTTP, and makes the answer depend on
which of two credentials a caller happened to forward. The parameter is a
question the caller can actually answer.

**Answer 401 for a link that requires an account.** Truthful, and it puts the
browser in the position of translating a status code into a screen — which is
where the 500 came from. A 200 with a stated requirement is what the password
case already does, and the interface has one place to branch instead of two.

**Delete the stale export entry.** Faster, and it replaces one unverified
sentence with another. A test costs ten lines and says the same thing to somebody
who does not trust me.
