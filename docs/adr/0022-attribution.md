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

**A guest is attributed, under the name they gave.** Corrected after shipping the
opposite: a share link asks for a name before letting anybody in, and that name is
the identity the visitor chose for this page. Refusing to use it — which is what
"a guest has no user id to record against" led to — threw away the only thing they
had told us and then reported that nobody had written.

The key is prefixed, and the prefix is the point rather than a namespace trick: a
guest calling themselves after a member must not be indistinguishable from that
member's account. The panel reads the prefix and says "guest" beside the name, so
an unverified name is shown as an unverified name.

Two guests who type the same name become one entry. That is the honest outcome of
an identity that is self-declared: the alternative is a per-session id, which
lists one person twice for reconnecting — a worse lie than merging two people who
both chose to be called Anna. A session that gives no name at all is still not
recorded, and the panel says that separately.

**A read-only link does not ask.** The name exists so other people can see who is
editing, which makes it pointless on a link that only reads — and on a page shared
with strangers it is a question somebody may not want to answer to read something
they were invited to read. So the link's role is resolved first and the form is
shown only when it grants writing.

That makes an unnamed session the ordinary case rather than an edge one, which
matters because the mapping is written when the document *opens* rather than when
somebody first types: without a name there is nothing to record, so a reader
leaves no trace. Presence still labels their cursor — it needs something to put on
it — but that label is deliberately not what attribution reads.

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

Pruning runs where the document is already loaded and already being written —
inside `applyToDocument`, in the same transaction as the change that made the
pruning possible — rather than as a separate scheduled job that would open every
document again to answer a question usually answered "nothing to do".

> This said "during materialisation" until ADR-0116, and it was never true:
> materialisation reads a document and writes tables, while pruning writes the
> document itself. The correction matters because the sentence was load-bearing.
> Pruning runs when the **server** mutates a page — a rename, a move, an icon, an
> import — and not when somebody types. So how recently a page had been renamed
> decided whether its list of people had been swept, and two pages with the same
> history listed different people. Asking at the moment of reading (`writersIn`,
> ADR-0116) makes the answer independent of when the sweep last ran. Pruning
> stays: bounding the document's growth is its other job.

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
