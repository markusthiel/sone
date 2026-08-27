# ADR-0012: Sync protocol and document rooms

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

The sync server is where the CRDT store, the room layer and the capability
model meet. Several decisions here are hard to change once clients exist,
because they are wire format.

## Decision

### One connection, many documents

Documents are multiplexed over a single WebSocket and addressed by a
per-connection numeric handle.

The alternative — a connection per document, which is what `y-websocket` does —
means a page with eight subpages open costs nine TCP connections and nine
authentication round trips. In a page tree that is the normal case. Handles
rather than uuids because the document id is then transmitted once at open
instead of on every update: at a few updates per second per document, the
difference is 36 bytes of overhead per message versus one.

### Binary framing via lib0

Already a Yjs dependency. JSON with base64 payloads would be easier to read in
a debugger and cost a third more bytes on every keystroke.

The auth message is the exception: JSON inside the binary frame. It happens
once per connection, carries strings rather than bytes, and gains nothing from
a hand-rolled layout — whereas a mistake in the field order of a hand-rolled
auth message is a security bug.

### Authorisation is re-checked on every open

ADR-0006 rule 1, implemented in `handleOpen`. Every document a connection asks
for is authorised independently, including documents reached from an
already-open page, because a share token's scope is a subtree and the client is
free to ask for anything. A missing page and a forbidden page return the same
error: the distinction tells a caller which pages exist.

### Claims are re-resolvable, and revocation acts on live connections

This was found by a test rather than by design, and it matters.

Claims are a snapshot taken when a connection authenticates. Without
re-resolution, revoking a share link has no effect until the client reconnects
— which for a WebSocket may be hours. ADR-0006 chose revocable rows over signed
tokens *precisely* so revocation could be immediate, and the first
implementation quietly failed to deliver that.

Each connection therefore records **which credential** authenticated it, by id:
`{ kind: 'session', sessionId }` or
`{ kind: 'share', shareTokenId, shareSessionId }`. The plaintext token is never
retained — the server has no reason to hold a credential. `revalidateClaims`
re-resolves from those ids, and `revalidateConnection` closes documents the
connection may no longer see.

A role *downgrade* keeps the document open and sends `RoleChanged`. Being
disconnected because an admin adjusted a permission is worse than being told.

### Read-only violations are refused, not ignored

A viewer that sends an update gets an explicit `read_only` error. Silently
dropping it would leave the client believing the edit landed, showing content
that does not exist on the server — which the user experiences as data loss
and reports as a sync bug.

Awareness is exempt: presence touches no document state, and a viewer's cursor
is useful.

### Persistence is debounced, and the durability window is explicit

Updates accumulate in memory and flush after 400 ms of quiet, or 3 s at the
latest. Writing per keystroke would put a database round trip on the typing
path.

The consequence, stated plainly: **a crash can lose up to 3 seconds of edits.**
That is the trade. The alternative makes every keystroke wait for `fsync`.
`SyncServer.shutdown` flushes every room, so a routine restart loses nothing —
it must be awaited on SIGTERM, and skipping that is user-visible data loss.

### A permanently failing write poisons the room instead of retrying

Also found by a test. The first implementation put a failed batch back on the
queue and retried forever, so a write that could never succeed — workspace
deleted, schema mismatch — would hold memory and re-fail on every subsequent
update indefinitely.

Postgres SQLSTATE classes 23, 42, 3D and 3F are treated as permanent: the room
stops persisting, logs, and reports itself through `poisonedRooms`. Everything
else is transient and retried, which is the safer default — retrying a
permanent failure wastes memory, discarding a transient one loses work.

A poisoned room keeps serving its in-memory document rather than cutting
clients off mid-sentence.

### Cross-instance updates reconcile by sequence number

`LISTEN/NOTIFY` (ADR-0005) is not durable: a listener that is down misses
messages entirely. Notifications therefore carry ids only, and a peer fetches
from `doc_updates` and compares sequence numbers. A missed notification
self-heals on the next one. This is required for correctness, not an
optimisation.

### Every limit exists because its absence is an attack

`LIMITS` in `protocol.ts`: message size, documents per connection, update rate,
auth timeout, idle timeout. Each is a resource an authenticated but hostile
client would otherwise consume without bound.

## Consequences

The protocol is versioned (`PROTOCOL_VERSION`) and a mismatch is refused at
auth. Changing the wire format means bumping it and supporting both for a
release, or breaking every client.

Rooms hold a Y.Doc in memory for as long as they are open plus a linger period.
Memory is therefore proportional to concurrently-open documents, not to
workspace size. `roomLingerMs` is configurable because the right value differs
by deployment.

`revalidateAll` needs to be called periodically, not only on explicit
revocation, or a session revoked without touching a page stays live until the
next reconnect. That sweep is not yet scheduled; it belongs with the
maintenance job alongside `pruneAuthTables`.

## Alternatives considered

**Hocuspocus.** Rejected in ADR-0004 on dependency grounds. In hindsight also
on design grounds: the bespoke auth, per-document ACL re-checks and revocation
handling here are most of what the sync server does.

**A connection per document.** Simpler, and what the reference implementation
does. Rejected on connection count in a page tree.

**Synchronous persistence per update.** Removes the durability window.
Rejected: it puts a database write on the typing path.

**Trusting the NOTIFY payload to carry the update.** Would remove a query per
notification. Rejected: the payload is capped at 8000 bytes, and a lost
notification would then mean a permanently diverged document.
