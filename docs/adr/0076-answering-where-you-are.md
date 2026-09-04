# ADR-0076: Answering where you are

## Status

Accepted. Completes stage four of ADR-0069.

## Context

I told the owner of this project that answering a notification from the inbox
was blocked, and gave a reason: comments live in the Yjs document, a room loads
its document once and does not learn about writes made outside it, so a reply
written by a route would land in the store and stay invisible until somebody
reloaded.

That reason was wrong, and the way it was wrong is the most useful part of this
record.

The mechanism exists and is complete. A trigger on `doc_updates` fires
`pg_notify` on every insert — including one made by a REST route. `UpdateBus`
listens, `SyncServer.onRemoteUpdate` compares sequence numbers and fetches what
the room has not applied, and `DocumentRoom.applyRemoteUpdate` applies it with
the origin `remote-bus` so it is fanned out to the people in the room but not
written back a second time. Every piece was there, written years before this
question came up, with the reasoning in ADR-0005.

What was not there was any test that exercised it. And the reason none existed
is worth writing down: the sync suite passed the **base** database URL to the
bus while every write went to the per-file database the harness creates for
parallelism. The bus was listening to `sone_test` and the writes were going to
`sone_t_sync_*`, so no notification could ever arrive. The suite still passed,
because the tests that look like they cover this — "an edit by one client
reaches another" — travel the in-process fan-out and never touch the bus at all.

A mechanism with no test is a mechanism nobody can check a claim against, and I
made a confident claim about this one by reading it.

## Decision

**The guarantee is tested.** Two tests: a write made outside a room reaches the
people in it, and it is not written back a second time. They are the reason
anything below is buildable, and they will fail loudly if the bus is ever
misconfigured again.

**Writing a reply and projecting it are one operation**, in `postReply`.
Notifications are written by the materialiser from the comments it finds, so a
reply that is only appended to the document notifies nobody. The room cannot
cover for it — an update arriving with the origin `remote-bus` is deliberately
not persisted or projected, because whoever wrote it is responsible for both.

This was already broken for replies that arrive **by email** (ADR-0060): they
were appended and not projected, so answering by mail told the person being
answered exactly nothing until somebody happened to edit that page for another
reason. Both callers go through the one function now, where a caller cannot
take one half and forget the other.

**`POST /api/inbox/:id/reply`, addressed by notification.** Not by page and
thread. The inbox is the one place in SONE that spans workspaces and holds no
page open; a route taking a page and a thread would have the browser tell the
server which conversation a row is about, when the row *is* the server's own
answer to that. It also bounds the feature honestly: a reply can only go where
somebody was actually written to, and the notification is the proof.

The right is re-checked at the moment of writing rather than taken from the
notification. Somebody removed from a workspace since being mentioned must not
be able to post from a row still sitting in their inbox — the same rule the
email replies follow, for the same reason.

**Answering is reading.** Somebody who has just written a sentence about a
notification has dealt with it, and leaving the row bold afterwards is the inbox
disagreeing with what the person just did. Done on the server, so it holds for
any caller.

**The box is optimistic about nothing.** Marking read and putting aside update
the list before the server answers, because the worst a failed one costs is a
row in the wrong view. A reply is a sentence addressed to somebody: showing it
as sent when it was not is the one failure here nobody could recover from, since
the box that held the words would already be empty. So it waits, and keeps the
text if the write fails.

Only a conversation can be answered. An assignment is a task rather than a
question, and a notification with no thread is about a page rather than about
something somebody said.

## Consequences

The room's `throughSeq` is not advanced by an outside update, so the next
notification for that document re-fetches from an older sequence and re-applies
updates it already has. Yjs makes that harmless — applying an update twice is
the operation's whole point — and it self-corrects on the room's next own
flush. Left alone deliberately: making `applyRemoteUpdate` advance a field
called "persisted through" would be a small lie in the name of a small saving,
and the field is what decides what gets projected.

`postReply` is where a third caller would go — a reply from a mobile
notification, say. That is the shape to keep: one place that knows both halves.

What this record is really about is the first half. A mechanism that is never
exercised is a mechanism whose behaviour is a guess, however well it is written
and however carefully its reasoning is recorded. This one was written well,
reasoned carefully, and quietly disconnected in the tests for long enough that
nobody could have noticed.
