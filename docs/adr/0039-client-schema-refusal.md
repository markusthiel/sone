# ADR-0039: A client that cannot render a block type is refused, not tolerated

## Status

Accepted.

## Context

A video block was added, uploaded, drawn — and then deleted, repeatedly. The
console eventually said who did it:

```
[sone] block removed: video — from the network {origin: 'remote'}
```

Not this browser. Another participant deleted it and the deletion synced back,
which in a CRDT is indistinguishable from the author having deleted it. The block
was gone for everybody, permanently.

The mechanism was already documented one commit earlier, from a test written while
looking for something else: y-prosemirror builds each node with
`schema.node(el.nodeName, …)` and, when that throws, **deletes the element from the
shared document**. A client whose schema predates a block type does not ignore it.
It removes it, for everyone, silently.

Two facts make this worse than a bug in one block type:

- It applies to **every** block type this application will ever add. Nothing about
  video is special.
- It is **data loss caused by an old tab.** Somebody's phone, left open on a page
  since yesterday, deletes today's writing.

## Decision

**A block type is part of the document format. Adding one bumps `SCHEMA_VERSION`,
and a client whose document schema version differs is refused at the handshake.**

Three parts:

### The version is sent at authentication and checked

The auth frame carries `documentSchemaVersion`. The server compares it with its own
and refuses anything else — including its **absence**, which is exactly what a
client built before this change sends.

`isClientSchemaCompatible` already stated the rule and demanded equality rather
than a minimum. Nothing called it. It is called now.

Equality, not "at least": a client *newer* than the server writes blocks the server
cannot project, and a client older deletes blocks it cannot draw. Both are refused
for reasons of the same kind.

### The refusal is its own reason, and says what to do

`document_schema_mismatch`, not `auth_failed`. Somebody whose tab is a day old has
done nothing wrong and needs one instruction — reload — rather than a message
about credentials, which is what a generic authentication failure would tell them.

### The video block bumps the version to 2

With a migration in the chain that changes nothing structurally. That looks odd and
is deliberate: `migrateDocument` refuses a gap in the chain, so the step has to
exist, and what it records is not a change of shape but a change of *requirement* —
from this version on, a client must be able to draw a video.

## Consequences

An old tab is now refused instead of being allowed to eat a block. That is the
whole point, and it is a visible change: after this deploys, every open tab must
reload before it can edit again.

Adding a block type is no longer free. It costs a `SCHEMA_VERSION` bump, a
migration entry, and a forced reload for everybody. That is the correct price —
the alternative is what happened here, which is losing writing.

The document schema version and the sync protocol version stay separate contracts
(ADR-0013). This change is a document schema change; the wire format did not move,
and conflating them would mean bumping the protocol every time a block is added.

## Alternatives considered

**Teach y-prosemirror to keep what it cannot render.** The honest fix, and not
available: the deletion is in its `catch`, upstream, and a fork of the binding layer
is a maintenance burden far larger than a version check.

**A permissive schema — one "unknown block" node type that preserves attributes.**
Genuinely attractive, and it would make old clients harmless. Rejected for now
because every block type would have to round-trip through it faithfully, including
children and marks, and getting that subtly wrong is the same data loss with more
machinery in the way. Worth revisiting if forced reloads become a nuisance.

**Warn instead of refusing.** This is what the stale-bundle notice already does, and
it did not help: the notice is a sentence in a corner and the deletion happens
whether or not it is read.
