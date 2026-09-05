# ADR-0086: Two answers to one question

## Status

Accepted. Built.

## Context

Markus asked what the permission model actually does, so I read it rather than
recalling it. The answer to the first question turned out to be that there is no
single answer.

SONE decides "may this person reach this page" in **two** places:

| | Where | Serves |
|---|---|---|
| A | `resolvePageAccess` and `visiblePagesCondition`, `packages/server/src/pages/access.ts` | the page tree, search, favourites, the tasks panel, ~12 listing queries, and the permission routes themselves |
| B | `effectiveRole` over the claims from `resolveSessionClaims`, `packages/server/src/auth/claims.ts` | **sync** — opening and writing a document — and page GET/PATCH, preview, files, collections, import, the share routes |

A read `page_group_permissions` from the day groups existed (ADR-0026). B did
not. There was no reference to that table anywhere in `claims.ts`.

So a page whose only path to somebody was a **group** grant was listed in the
tree, appeared in search, and refused to open. Granting to a person worked;
granting to a group produced a page that looked broken rather than forbidden —
which is the worse of the two failures, because the reader has no way to tell
which it is.

## Why nobody saw it

Three things had to line up, and all three are worth naming because each of them
is a habit rather than an accident.

**The end-to-end test went through the wrong half.**
`packages/server/test/workspaceAccess.db.test.ts` was written for exactly this
worry — "every step is covered, the path between them is not" — and it walks the
real story through the real routes: give a colleague workspace access, put them
in a group, grant the group a page. It was green. It calls `resolvePageAccess`.
The routes it exercises are the permission routes, which also use A. The test
never touched the resolver that serves the document.

**Every test of B supplied its own claims.** `effectiveRole` is a pure function
and is well covered — but each test hands it a literal `grants: [...]` array. The
function was tested thoroughly; the query that fills its argument was tested
nowhere. A pure core with an untested loader is a very comfortable place for a
bug to live, because the coverage all points at the part that is correct.

**The migration knew.** `0020_groups.sql` says, in its own comment, that
`page_permissions` is "read by claims.ts" — as the reason for putting group
grants in a second table. The author had `claims.ts` in mind while writing the
table that `claims.ts` would not read.

And underneath all three: the same four words exist as two type aliases,
`PageAccess` in A and `Role` in B, with two rank tables and two "more permissive
of the two" helpers. Two vocabularies for one idea is how two implementations
stop being noticed as two implementations.

## Decisions

### One loader for a person's page grants

`pageGrantsFor(db, userId, workspaceId)` in `claims.ts` returns every grant
somebody holds in a workspace — their own and their groups' — as separate
grants, in one query.

Separate grants rather than a resolved maximum, because `effectiveRole` already
takes the most permissive grant in scope, and a group grant must never be able to
*reduce* what somebody could already do (ADR-0026). Handing it a pre-computed
number would move that rule into the loader, where the other resolver could not
see it.

One function rather than two queries, because there were already two copies of
the personal half — `resolveSessionClaims` and `revalidateClaims` — and neither
had the group half. Two copies is how a fix corrects one and leaves the other,
and `revalidateClaims` is the copy that runs on an already-open WebSocket: a
half-fix there would work until a connection was re-checked and then stop, which
is the worst shape a permission bug can take.

### Claims stay a snapshot

The obvious repair is to delete B and have everything call A. Rejected, for the
reason ADR-0006 built claims the way it did: `effectiveRole` is a pure function
over a snapshot, with no database access, so sync can ask it per operation —
per subdocument open, on every document in a room. Making it a query would put a
round trip in that loop.

So the two remain, and what changes is that the snapshot is now complete.

### A test that only checks they agree

`packages/server/test/accessAgreement.db.test.ts` builds real rows, asks **both**
resolvers, and asserts the answers match. It tests neither one on its own.

That is the only property that actually has to hold, and it is the one property
no test of either half could have seen. Before the fix it fails on five of seven
cases; after it, it passes. It resolves claims through `resolveSessionClaims`
with a real session token rather than constructing them, which is the specific
habit that hid this.

## Consequences

A group grant now opens the document, as the interface has been promising since
groups existed.

The divergence is closed for group permissions specifically. The two resolvers
still differ in one further respect, deliberately left: A treats the owner of a
*personal* workspace as admin via `workspaces.personal_for`, which B does not
model. In practice a personal workspace's owner always has an `owner` member row
(`registration.ts` writes it in the same transaction), so both answer `admin` and
the difference is unreachable. It is recorded here rather than fixed because
adding a column read to the hot path to cover a case that cannot occur is worse
than a note.

The project document `claude/rechte-und-zugriff.md` claimed group rights were
"geprüft und funktionsfähig". It has been corrected. This is the sixth instance
this week of the pattern ADR-0084 names: **a record written before the work reads
afterwards as a description of the work** — and here it had a green test standing
behind it, which is a stronger claim than prose and was equally wrong.

## Alternatives considered

**Resolve claims lazily, one page at a time.** Ask A whenever B is consulted.
Correct by construction, and it puts a query in the sync loop that ADR-0006
exists to keep out.

**Materialise an effective-access table.** A row per (user, page). Fast to read,
and every grant, group membership, move and restriction change has to maintain
it — a cache with five invalidation paths, in the part of the system where a
stale row is a disclosure.

**Keep one vocabulary and delete the other type alias.** Worth doing and not done
here: `PageAccess` and `Role` are the same four words, and merging them touches
every file that names either. It belongs in its own change, where the diff is
about the rename and nothing else.
