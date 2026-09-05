# ADR-0097: The string moves into the message

## Status

Accepted. Built. The trash is the third subject on the notify frame — and the
one that showed the claim made twice about that frame was not yet true.

## Context

ADR-0093 added `ServerMessage.Notify` with a scope string and justified the
scope like this: *"so the next thing worth nudging — the page tree — costs no
protocol version."* ADR-0096 built the page tree, confirmed the protocol had
cost nothing, and repeated the promise for the next one: *"The next subject —
the trash, the shares screen — is a constant and a trigger."*

That was half right, and the wrong half is worth recording.

The **protocol** cost nothing: `NotifyScope.Pages` was one constant on each side
of the wire. But 0064 gave the page tree its own Postgres channel,
`sone_pages_changed`, and the server its own bus handler for it. So a third
subject would have needed a third channel, a third handler and its wiring —
three copies of a shape whose only difference is a string.

**Three copies of something that differs only in a string is the point at which
the string moves into the message.** So this change makes the earlier claim true
before it uses it.

## Decisions

### One workspace channel, carrying its own scope

`sone_workspace_changed` with `{workspaceId, scope}` replaces
`sone_pages_changed`. The trash is then what was promised: a constant and a
trigger.

The person channel stays separate, and that is not an inconsistency. An inbox is
keyed by **person** and these lists by **workspace**; they are two different
addresses, not two names for one. What was folded together is the set of
subjects sharing one address.

**A deploy costs something, once.** An instance on the previous release listens
on `sone_pages_changed`, which nothing emits after this migration applies; its
clients fall back to the focus refresh until it restarts. Accepted rather than
papered over with a release of double emission that somebody then has to
remember to remove.

### The scope is checked before it reaches a client

The payload names its own scope, and that payload is written by a trigger rather
than by the server process. So the sync server checks it against
`WORKSPACE_SCOPES` before forwarding.

Our own SQL either way, and the allow-list is one line: a string that reached
clients because a migration typed it is a contract nobody agreed to.

### The trash is its own scope, overlapping the tree on purpose

| | tree | trash |
|---|---|---|
| archive, restore | ✓ | ✓ |
| permanent delete | ✓ | ✓ |
| rename, move, icon, permission | ✓ | |

Archiving changes both lists in one act, so it rings both. A rename cannot
change what is in the trash, and one scope for the pair would mean every rename
in the workspace refetching a list it cannot have changed — the fault ADR-0096
was written to avoid, arriving from the other side.

A delete rings both without asking which list the row was in: deciding would
mean reading a row that is gone, and a hard delete is not only "emptied from the
trash" — a workspace deletion cascades, and a purge takes rows that were never
archived.

### One hook for the three listeners

`useNudge(client, scope, onChanged)`. The coalescing was written inline in
`usePages` and is now shared by the tree, the trash and the bell.

The bell did not have it before and should have: one projection can send that
listener two nudges within milliseconds — its inserts and its sweep of deleted
threads — and there was no reason for it to be the listener that fetched twice.

The hook keeps the handler in a ref rather than in the dependency array. Every
caller passes a closure over its own state, so listing it would rebuild the
subscription on most renders — and take the open window with it, so a nudge
followed by a render would be a nudge that vanished.

## Consequences

**A fourth subject is now genuinely a constant and a trigger.** The shares
screen, whenever somebody wants it: a `NotifyScope`, a name in
`WORKSPACE_SCOPES`, a trigger emitting it, and a `useNudge` call.

**Eight route tests, six failing before the change** — and the two that passed
are the two asserting the trash stays quiet, which passed for the wrong reason:
nothing was being sent at all. That is the standing shape of these files, and
the reason the presence tests carry the proof.

**The claim in ADR-0096 is corrected in place.** It said the next subject would
be a constant and a trigger; it would have been a constant, a trigger, a
channel, a handler and its wiring. Left standing it would have been a record
that reads as a description of what was built.

## Alternatives considered

**A third channel, `sone_trash_changed`.** Consistent with what was there, and
the shortest change. It also makes the fourth subject a fourth channel, and it
leaves ADR-0096's claim standing and false.

**Let the trash listen to the `pages` scope.** No migration, no constant, and
every rename in the workspace refetches the trash for everybody who has it open.
The whole point of a scope is to say which list.

**Fold the inbox channel in too, keyed by a generic subject id.** Then one
channel carries two kinds of key, and every consumer starts by asking which kind
it got. The address is the honest boundary: person, or workspace.

**Carry the changed page id so the trash could patch one row.** Same answer as
ADR-0096: the frame reaches everybody with the workspace open, and whether any
of them may see that page is a question only the route answers. The trash is a
short list and refetching it is one query.
