# ADR-0090: A comment is not an edit

## Status

Accepted. Built. Completes the half of ADR-0046 that record left for later, and
gives `commenter` — a level that has existed since the first share link — its
first consequence anywhere.

## Context

Asked for as "bau die Kommentare für Gäste", after ADR-0089's sharing work put a
right-hand panel in front of a link's visitor for the first time.

The investigation found something narrower and more interesting than a missing
feature. **Nobody could comment without being able to edit.** Not guests, and
not members either:

- `sync/server.ts` computes `canWrite = atLeast(role, 'editor')`, and `room.ts`
  refuses a Yjs update outright below that.
- `SelectionToolbar` was therefore gated on `handle.canEdit`, with a comment in
  the source saying commenting "requires edit rights until there is a role that
  separates them (ADR-0046)".
- `canComment` existed in `auth/claims.ts` — and a repo-wide search found **no
  call site**. It had been written, and never used.

So `viewer` and `commenter` were the same thing in every part of the running
system. The word was in the sharing dialog, in the database enum, in
`ROLE_ORDER`, in the role editor — and it decided nothing.

The reason is not an oversight, it is the shape of the sync gate. A Yjs update
that adds a comment thread is opaque bytes. Telling it apart from one that
rewrites a paragraph means applying it to a scratch copy of the document and
diffing the result — per update, on the server, for every write. "Let a
commenter through and check what they touched" is not a flag; it is a parser
standing between every keystroke and the document.

## Decision

**A comment written by somebody who may not write the document goes through a
route, and the server composes the mutation itself.**

`POST /api/pages/:pageId/comments` and
`POST /api/pages/:pageId/comments/:threadId/messages`. They take a quotation, an
anchor and some text. They never take a document update. The server calls
`addThread` / `addMessage` from core, so **there is no argument to these routes
that can reach a paragraph** — the guarantee is structural rather than parsed,
which is the whole reason to prefer this over relaxing the sync gate.

Three things follow from it.

### The transport follows the write right

Somebody who may write the document keeps writing it, and their comment rides
along with everything else they type — offline, merged, unchanged. Somebody who
may not asks the server for one specific thing.

This is deliberately *not* the failure ADR-0086 records. That is about two
**decisions** drifting apart. This is one decision — `canComment`, over the same
claims, from the same `effectiveRole` — reached over two transports. The branch
lives inside `useComments`, so the panel, the margin and the canvas each call one
function and none of them has to ask which wire it is on. A call site that had to
ask is a call site that eventually asks wrongly.

### The link's level is the sharing option

The question that started this was whether sharing needs a new switch. It does
not. A link is already graded `viewer | commenter | editor`, that control has
been in the dialog since links existed, and the middle rung is the switch. It
simply never did anything.

So a `commenter` link gets the comments tab and the comment button; a `viewer`
link gets neither, and nothing new appears in the dialog.

### A visitor signs with the name they gave

The `guest:` key from ADR-0022, which ADR-0046 already named for exactly this.
The consequence that record accepted holds and is more visible here than it was
in a list of contributors: **two visitors who both type "Anna" are one name in
the thread.** There is nothing else to tell them apart by, and inventing
something — a session id in the name, "Anna (2)" — would be inventing a person.

The name comes from the share session, never from the request body. A request
that can name its own author is a request that can sign somebody else's name.

## Consequences

**`commenter` means something, for everybody.** A member graded `commenter` on a
page could not comment before this either. The route is not a guest feature that
members happen to share; it is the level finally doing what it is named after.

**Names, without a directory.** The panel resolves an author id against a list of
people, and a link's visitor is given an empty one on purpose — that list is a
directory of everybody who works here. But a thread whose authors have no names
is barely a thread. So `GET /api/share/:token/pages/:pageId/authors` returns
names for the people who wrote a message **on that page**: the ids come from the
page's own document and never from the request, so it cannot be asked "whose id
is this", and it returns names, never addresses.

**Whoever shared the page hears about the first thread.** A reply notifies
everybody already in the thread, which the projection handles. A new thread has
nobody in it, so a visitor's first comment would have notified no one — and a
comment nobody hears about is a comment lost, the lesson ADR-0081 paid for with
a queue that never retried. Who to tell is not a guess: somebody made the link,
and they chose to let this page out.

**Deleting stayed on `canEdit`, and that is a decision.** A commenter may add to
a conversation and may not delete any part of it, including their own message. A
message somebody can take back after it has been answered is a conversation that
can be rewritten.

**Resolving stayed where it was.** Closing somebody else's thread is a judgement
about the page rather than a contribution to it.

**A round trip, and no offline commenting for a commenter.** The comment appears
when the server has written it and the room's update bus has sent it back — the
same path a colleague's arrives by, which is why nothing is inserted locally and
reconciled. That version produces two threads when the round trip is slow.

**A hole this opened, and closed.** The route first checked that an anchor was
base64 and wrote the bytes through, reasoning that a relative position is opaque
and one that points nowhere makes a *detached* thread — a state the panel draws
on purpose. That is true of an anchor whose text was deleted and false of bytes
that are not an anchor: reading those **throws**, inside `readThreads`, which the
materialiser calls. A visitor could have posted a handful of bytes and left the
page unable to project — no comment counts, no notifications, no search row, for
everybody, until somebody dug the thread out of the document by hand.

Narrowing the check to "it decodes" was not enough either:
`decodeRelativePosition` accepts three arbitrary bytes without complaint and the
failure happens further in. So the anchor is validated **by running the reader**
— write the thread into an empty `Y.Doc`, read it back, refuse if that throws.
Validating by running the reader cannot drift from the reader, which a
hand-written parser of the same bytes would do the first time Yjs changed its
format.

Found by a test that used fake anchor bytes for convenience. It is worth saying
plainly that the test found it *by being wrong* about what an anchor is — and
that the fix is in the route, not in the test.

## Alternatives considered

**Relax the sync gate and validate the update.** Decode each update from a
commenter, apply it to a scratch copy of the document, diff, and accept only if
every changed key is under `comments`. Rejected: it is a full document copy per
comment, it depends on reading a format that is deliberately opaque, and the
security property becomes "our parser agrees with Yjs" — which is exactly the
kind of claim that is true until a version bump.

**Move comments into their own document**, the way ADR-0057 did for internal
ones, with a `#comments` room gated at `commenter`. Genuinely attractive: the
machinery exists, and the guarantee would be structural in the strongest sense.
Rejected for what it costs *now* — every existing page's comments would have to
be migrated out of its document, and a migration across every CRDT in an
instance is the riskiest operation this codebase has (ADR-0002 exists to stop
the documents diverging). Worth revisiting if comments ever need their own
permissions; not worth it to unblock a level that a route unblocks today.

**A per-share "allow comments" option.** Rejected above: the link's level already
says it, and a second control saying the same thing is a second thing that can
disagree with the first.

**Let a commenter mention people.** A visitor cannot enumerate the workspace's
members and must not be able to address one by id, so the route accepts no
mentions. Nothing is lost that matters: a reply already notifies everybody in the
thread, which is who a mention would have been for.

**Pass the member list to the guest's panel so names resolve.** The obvious fix
and a directory disclosure. See the authors route above.
