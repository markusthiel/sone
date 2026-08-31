# ADR-0022: Attribution is derived, prunable, and optional

## Status

Accepted and implemented.

Pruning is server-side only, as the record requires: `Y.PermanentUserData` throws
when entries are removed, so `liveClientIds` lives in `@sone/core` where the
server can reach it.

## Context

Requested: a list of the people working on a document, and selecting one
highlights what they wrote.

Yjs can do this. `Y.PermanentUserData` keeps a mapping from a user to the client
ids they have edited under, and every item in the document already carries the
client id that created it — so "which of these characters did Mark write" is
answerable without storing anything per character.

The cost is that the mapping is permanent by default, and that is a real
decision rather than a display detail: it records who typed what, keeps
recording it for people who have long since left, and on a shared link it is
visible to everyone who can read the page.

## Decisions

**Not retroactive.** Attribution begins when it is switched on. Documents
written before carry no client-to-user mapping, and inventing one would mean
guessing. A document with partial attribution must say so rather than implying
that unattributed text belongs to nobody.

**A guest sees attribution.** Somebody editing through a share link is a
collaborator; hiding from them who wrote what, while showing them the writing,
would be an odd half-secret. This is the default and is intended to become an
instance setting in the administration area, alongside the switch below.

**It can be turned off.** Per workspace, and off means off: no mapping is
written from that point. Existing mappings are not deleted by the switch —
that is what the deletion below is for, and conflating "stop recording" with
"erase the record" would make one of the two impossible to ask for.

**It can be deleted**, by somebody with the rights to do it. Deleting the
mapping loses attribution and never loses writing: the text is items in the
document, the attribution is a separate map from client ids to people. This is
deferred to a later change, but the shape is decided now so nothing is built
that would make it hard.

### Pruning, which is the interesting one

The request: *if nothing of mine is left in the document — my text was fully
rewritten — the entry could go.*

This is right, and it is safe for a reason worth writing down. The attribution
map says "these client ids belong to this person". The document's items say
"this content was created by this client id". Removing an entry from the map
therefore makes that content **unattributed**; it does not touch the content,
and it cannot make two clients disagree about what the document says.

That is the crucial difference from the tombstones underneath. A CRDT keeps a
record of deleted items forever, because convergence depends on it — two clients
must agree that a deletion happened. Attribution has no such requirement: it is
an annotation, and losing it costs a label.

So the rule is: **an entry may be pruned when no live item in the document was
created by any of its client ids.** Live, not "ever existed" — the point of the
request is precisely that deleted text should not keep somebody's name in the
record.

Pruning runs where the document is already being walked — during
materialisation, which loads the whole document anyway — rather than as a
separate scheduled job that would open every document again to answer a question
usually answered "nothing to do".

It is deliberately conservative in one respect: a client id with no live items
is pruned, but the person's *other* client ids are considered separately. Each
browser session gets a new client id, so somebody who wrote in three sessions
has three, and losing one of those does not remove the other two.

## Consequences

The document grows by one map entry per person per session, not per edit. That
is small, and pruning bounds it: a document nobody's original text survives in
carries no attribution at all.

Highlighting is a decoration computed from what is already loaded, so selecting
a collaborator costs nothing on the server.

The list of collaborators is not the same as the list of people currently
connected. Presence answers "who is here now"; this answers "whose writing is
this". Both belong in the side panel and they must not be conflated — somebody
who wrote half the page last week and is not connected today belongs in one list
and not the other.

## Alternatives considered

**Storing an author id per block.** Rejected: it is wrong at the granularity
people care about — a paragraph edited by two people has one author id and a
misleading one — and it is a second source of truth about something the CRDT
already knows.

**Attribution from the update log.** The server has every update with its actor.
Rejected as the primary mechanism: the log is compacted into snapshots, so the
answer would degrade over time and differ between a fresh instance and a restored
backup. It remains a reasonable source for a coarser "recently edited by" that
does not need to survive compaction.
