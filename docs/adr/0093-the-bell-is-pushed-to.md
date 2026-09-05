# ADR-0093: The bell is pushed to

## Status

Accepted. Built. Closes the gap ADR-0092 named in its own text rather than
leaving as a surprise: *"a badge still does not appear while somebody is
staring at the page."*

## Context

ADR-0092 fixed the badge in every way that did not require a new frame. It moved
it from the account avatar to the inbox icon, gave it one source — the list the
inbox already holds — and refreshed that list on `focus` and `visibilitychange`.

`focus` answers "what happened while I was away". It cannot answer the case
somebody actually watches: sitting on a page, in the tab that already has focus,
while a colleague writes their name three rooms away. The reported words were
*"die Zahl sowohl die Inhalte sollten sich live aktualisieren"*, and half of
that — the reload half — was what got fixed.

So the residual gap was named, costed at "a new server frame and a NOTIFY
channel", and left. This is that work.

## The shape of the problem

**Everything in the sync layer is indexed by document, and a notification is
about a person.**

That sentence is the whole difficulty. A room knows its subscribers; a
connection knows its open handles; the update bus carries `{docId, seq}`. None
of it can answer "which sockets belong to Anna", and the page Anna has open is
unrelated to the page she was named on — usually it is not even the same
workspace. A push that reused the document machinery would deliver a badge to
people looking at the right page, which is nobody in particular.

## Decisions

### The frame carries a scope and nothing else

`ServerMessage.Notify = 8`, payload one string: `inbox`. No handle, no count, no
excerpt.

**No count** is the load-bearing one. The obvious frame carries the unread
number, and it would be a second answer to a question the inbox's own list
already answers — which is precisely how the badge and the list spent the
previous release disagreeing (ADR-0092). The client is told *that* something
changed and goes and looks. One source, still.

**No excerpt** is the one that would have been a disclosure. A NOTIFY payload
reaches every listening instance regardless of who is connected to it, and an
excerpt is somebody's sentence. The inbox route is the one place that decides
what a person may see, and it stays that place.

**A scope rather than a bare frame** so the next thing worth nudging — the page
tree — costs no protocol version. That only holds if an older client treats an
unfamiliar scope as "nothing to do" rather than as a broken frame, which is
asserted.

> The page tree is exactly what came next (ADR-0096), and it cost none: one
> constant on each side of the wire. The claim above was the whole argument for
> the scope, so it is worth recording that it held.

### Statement-level triggers, over transition tables

`notify_inbox_changed()` fires on insert and delete; `notify_inbox_read_changed()`
on update, comparing the rows before and after. All three emit one NOTIFY per
distinct person per statement.

Row-level would have passed every test in the file except the one that says so.
It matters twice: a projection can write a mention for the same person in
several blocks at once, and — the other direction — the projection runs its
"delete notifications whose thread has gone" sweep on **every** rewrite of a
page. That is every keystroke that triggers a flush. A sweep that matched
nothing leaves the transition table empty, and an empty table sends nothing.

The update trigger compares rather than naming columns because Postgres refuses
a column list beside a transition table. That turned out to be the better check:
the mail job stamps `emailed_at` on every row it has sent, in one nightly sweep,
and `AFTER UPDATE OF read_at, snoozed_until` would still have fired on an update
that set `read_at` to what it already held.

**In the database rather than in the server after the write**, because NOTIFY is
transactional: it is delivered at commit and discarded on a rollback. A
notification produced inside a projection that then rolls back is never
announced. The previous round's worst fault was a projection that rolled back
for ever without saying so, and an announcement it had already made would have
been a badge pointing at a row that does not exist.

### One connection, two channels

The listening connection lives outside the pool because it is blocked for
everything else. That cost is per connection, not per channel, so `sone_inbox_changed`
is a second `LISTEN` on the bus that already exists rather than a second bus.

### A person is a set of connections

`SyncServer` gains one map: account id to connections. Filled after
authentication, emptied on close, and emptied *of its key too* — a map keyed by
everyone who has ever connected to an instance is a leak that only shows on an
instance that has been up a month.

A set, not a connection: the phone in somebody's hand and the tab on their desk
are two, and a badge that appears on one of them is the reported bug wearing a
hat.

A share-link visitor is not in it. They have no account and therefore no inbox
(ADR-0046), and filing them under a placeholder key is the shape both of the
last fortnight's guest bugs had (ADR-0091, ADR-0092).

### The client subscribes; it does not receive a callback

`SoneClient.onNotify(scope, handler)` returns its own unsubscribe. The client is
created where the workspace is known and the bell lives several components away;
a callback passed at construction would have to be threaded down through
everything between, or would tempt somebody into a second client for the bell.

The frame is intercepted in `SyncConnection` and deliberately **not** passed to
`onFrame`. Every other server frame names a document handle and belongs to the
store; handing this one to the store would make the document store the thing
that knows about inboxes.

### The focus refresh stays

Not redundant, and worth saying because deleting it would look like tidying. A
push tells you what happened while you were listening. Nothing tells you what
happened while you were not — a laptop that slept, a tab the browser discarded,
a deploy — and that is the question `focus` answers.

The hook refetches on a nudge whether or not the tab is visible, which is the
opposite of what the focus handler does and right for the opposite reason:
skipping a hidden tab would leave the badge stale at the exact moment somebody
switches to it.

## Consequences

**The bell is live in both directions.** Up when somebody is named, down when a
thread is deleted or something is marked read on another device — that last one
falls out of the update trigger rather than being built, and is the case a
second device could never have got right before.

**Every push is a refetch of the whole inbox list.** For one person's inbox that
is a small query on an indexed column, and it is the price of having one source
instead of two. If it ever stops being small, the fix is a smaller list, not a
number on the wire.

**The test file goes through all seven joints** — row, trigger, NOTIFY, bus,
index, frame, hook. A test that called the server's own send method would assert
that a wire exists, and this codebase has now learned twice that such a test is
not a test (ADR-0091). Twelve cases; eight of them failed against the old code
before anything was written, and the two that passed were the two about absence,
which is what "nothing is sent" looks like when nothing is sent at all.

**`isPermanentWriteFailure` still does not treat `22*` as permanent.** Named in
ADR-0092, still true, still unrelated to this. It is now the oldest open item on
this list.

## Alternatives considered

**Server-Sent Events on their own endpoint.** The honest second choice, and it
loses on the things that are already solved: the sync WebSocket authenticates
with an HttpOnly cookie on the upgrade request, reconnects with jittered
backoff, and is already proven through whatever proxies people run. A second
long-lived connection would need all of that again, and the first thing anybody
would discover is a reverse proxy buffering it.

**Put the unread count in the frame.** One request cheaper per notification and
one source of truth more. See above.

**Reuse the document bus: notify the rooms a person has open.** No new channel,
no new index — and it delivers to whoever has the page open, which is not the
person the notification is for. It is the wrong index, not a cheaper one.

**Poll on a timer.** Considered and rejected in ADR-0092 for the same reason it
is rejected here: a notification is not urgent enough to poll for, and polling
costs every open tab whether or not anything happened.

**Notify per row instead of per statement.** Simpler SQL, and it turns one edit
into several refetches of one list, and an empty sweep into a broadcast on every
keystroke.
