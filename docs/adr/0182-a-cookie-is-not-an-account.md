# ADR-0182: A cookie is not an account, and a role is not a wall

## Status

Accepted. Built. The findings come from an external review of `main` at
`8056a44`; this record is the first four fixes and their reasoning. The larger
structural question the review raised — that a client can move a page by writing
its parent over Yjs, past the checks the HTTP move makes — is only half closed
here (the projection no longer *breaks* on a bad parent) and is carried in
**Left open**.

## Context

Someone read SONE from the outside and wrote down what they found. Most of it
was right, some of it was aimed slightly off the real fault, and one thing was
worse than they thought. Four of the findings are the same shape and belong in
one record: **a check that stands in one doorway and not the others.** The whole
point of the app is doorways that are meant to be there — a share link with edit
rights, an anonymous link, a link with a password — so the fault is never "the
door exists", it is "the lock on this door is not the lock on that one".

Each of the four is a place where the answer to *who is this* was decided by
something cheaper than the question.

## What the four were

### F01 — the presence of a cookie stood in for a session

A link marked **„Anmeldung erforderlich"** (`allow_anonymous: false`) admits a
person with an account and turns away a nameless visitor. Whether an account is
present was passed to the resolver as `signedIn`. Two of the three callers
computed it as `Boolean(sessionToken)` — that is, *did the browser send a
string*. Any string. `Cookie: sone_session=anything` was an account.

The one caller that got it right, the link's preview route, asked the database.
So the preview honestly told an attacker "sign in first", and the sync
connection and the file route then let the same attacker in anyway — the
preview authorises nothing, it only describes.

The fix is one function, `accountPresent`, that all three now call. It resolves
the token against a live session with `resolveSession` — not the weaker
`resolveSessionId`, which ignores the idle window and a disabled account, so
that "an account is present" means here exactly what it means on every other
door. The link still admits a signed-in non-member, which is its job (ADR-0101);
it just no longer admits a cookie jar with a made-up crumb in it.

### F02 — the second-factor requirement guarded one door of many

Recorded but not built here — it lives in its own change — because it is a
different shape from the other three: the fix is to move the policy gate from
`requireSession` down into `resolveSessionClaims`, the one function every
un-gated path (search, export, files, comments, sync) already flows through.
Noted so the reader knows it was seen and where it went.

### F03 — a malformed message could take the process down

The review said an empty inner sync payload would crash the server. It does not:
the process-wide `unhandledRejection` handler catches it and logs. But that is
not a fix, it is a coincidence — the connection lived on having *silently
dropped a frame it was never told about*, which is the bug ADR-0091 is about in
another place.

The real crash was one line the review passed over as a footnote. The upgrade
request's cookie was decoded with `decodeURIComponent`, uncaught, inside `ws`'s
`connection` handler — which runs synchronously off the HTTP upgrade. So
`Cookie: sone_session=%` throws a `URIError`, which reaches `uncaughtException`,
whose handler shuts the process down. One request, **no credential of any
kind**, every connection on the instance gone; repeated, a standing outage.

Three fixes, so the process never leans on the global handler for correctness:

- The cookie decode, in both the sync server and the HTTP cookie parser, treats
  a value it cannot decode as no value. A broken cookie is not a credential.
- The message handler's promise is caught at the call site: whatever a handler
  throws past the outer frame now closes *that* connection with an error, the
  way a malformed outer frame already did, rather than becoming a rejection
  nobody holds.
- The inner sync and awareness protocols — a second wire format that throws on
  its own terms — are wrapped, and answered like the outer one: the peer that
  cannot frame a message is told and let go.

### F06 — the guest *role* walked through the internal-comment wall

Internal comments (ADR-0057) are for the team, not for a share-link visitor. The
gate asked for `principal.kind === 'user'` and `workspaceRole !== null`. Both are
true of an account holding the **guest role** — which ADR-0110 created precisely
for people *outside* the team — and the account flag `is_guest`, which would
have made `kind` anything other than `'user'`, is set by nothing in the product.
So the one guest that actually exists is a role on an ordinary account, and it
sailed through. The client then opened the room for it (keyed off `isGuest`
again) and showed it the threads.

The mirror of the same mistake: a **custom role** has no system key, so its
`workspaceRole` is null, so a paying member holding one was refused the internal
room and got an error frame on every page.

The rule was never "is this account special" — it is "does the workspace give
this person its pages by default". That is `pageLevel` (ADR-0087): set for the
four system roles that mean something, null for `guest` and for any custom role
defined to grant nothing without an explicit share. The gate now reads
`pageLevel`, the session route sends it to the client, and the client decides
`canSeeInternal` from it instead of from `isGuest`. Guest out, custom-role
member in, and neither answer comes from a name any more.

## Decisions

**One question, one function.** `accountPresent(db, token)` is the only answer
to "is this cookie an account", and `resolveSessionClaims`'s `pageLevel` is the
only answer to "does the workspace stand behind this person on a page". A
question answered in three places is a question answered three ways, and the one
that drifts is the one nobody is looking at.

**A refusal that fails closed is still preferred over one that leans on a
catch-all.** The `unhandledRejection` handler stays — it is a last resort — but
nothing correct now depends on it. Every throwing path has a close beside it.

**The projection does not trust the parent a client writes.** `parentPageId`
comes from the document, and a document is written by clients. A parent in
another workspace, or the page's own descendant, is refused at materialisation:
the row keeps the parent it had, and the bad value never reaches `ancestor_ids`.
This closes the availability half of the structural finding — a page set as its
own parent used to null its ancestors but write the cyclic parent anyway, and
the cascade then recursed forever on a pool connection with no
`statement_timeout`. The cascade CTE is also depth-bounded now, so it terminates
whatever the data is.

## Consequences

The share link, the password link, and the anonymous link all still work — the
review's own list of what must be preserved. What changed is that
„Anmeldung erforderlich" now requires an account rather than a header, the
internal wall is where the product always said it was, a malformed cookie is a
non-event, and a client cannot hang a page's projection by lying about its
parent.

Tests were the point. Every one of these fixes had a green test sitting next to
the hole:

- `sync.db.test.ts`'s `makeMember` set `is_guest` from the role, which is the
  state production never produces — so a role-guest came out as
  `kind: 'guest'` in the test and `'user'` in reality, and the gate looked
  right. The fixture now sets `is_guest` false always, and two new tests cover
  the role-guest (refused) and, for F01, an invented cookie on an account-only
  link (refused) beside a real one (admitted).
- `materialize.db.test.ts` gains a page-as-its-own-parent case (terminates,
  keeps its parent) and a cross-workspace parent case (refused).
- `sync.db.test.ts` gains a malformed-inner-payload case (that connection
  closes, a second one keeps working) and a malformed-cookie case (the process
  is still there to authenticate the next connection).

## Left open

**The move that goes around the move.** An editor can still set `parentPageId`
over Yjs to another folder *in the same workspace* that they could not move into
over HTTP — the projection accepts it because it is a real, acyclic,
same-workspace parent. The HTTP move checks write access to the target and the
folder rule (ADR-0019); the sync path checks neither. The confidentiality effect
is small (the content moved is the editor's own, already-writable page), which
is why this is deferred and not in this change, but the honest fix is to treat
the structural keys of the `page` map — `parentPageId`, `idx`, `kind`,
`collectionId`, `archivedAt` — as server-owned: the client never writes them,
so an inbound update that changes one should be reverted in a server
transaction. That is a larger change to the room layer and wants its own record.

## Alternatives considered

**Keep `Boolean(sessionToken)` and document it.** The comment already there
described the behaviour as intended („that it exists at all is the fact this
link asks for"). A sentence is not a lock (ADR-0101, ADR-0181): the fix is to
remove the wrong possibility, not to describe it.

**Give the internal room its own right, `comments.internal`.** Cleaner in the
long run and the right shape if internal access ever needs to vary independently
of page level — but it is a migration, a role-screen control, and a new entry in
`check-rights-enforced`. `pageLevel` already carries exactly the line ADR-0110
draws between a member and an external collaborator, so the small fix is the
correct one until a second reason to separate them appears.

**A `statement_timeout` instead of refusing the cyclic parent.** A timeout would
stop the hang but leave the page holding a parent that says it is its own
ancestor, and every later projection would hit the same wall. Refusing the value
is the fix; the depth bound and a timeout are the belt beside it.
