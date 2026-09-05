# ADR-0091: The actor was not the author

## Status

Accepted. Built. Two reported faults, one shared shape, and a third found on the
way.

## Context

Two reports in one message:

> Erwähnungen klappen nicht. In meine Benachrichtigungen kommt gar nichts rein.
> Eine Email habe ich bekommen aber dafür haben wir doch auch die Glocke oder?
> Dort sehe ich gar nichts, alles leer.

> Im Leute Menü soll man ja texte hervorheben können wenn man eine Person
> anwählt. Da tut sich auch nichts im Content. man sieht nichts.

They look unrelated and are the same failure twice: **a value that was almost
the right one, used where only the right one works, in the one seam nothing
tested.** ADR-0085 built mentions and ADR-0022 built authorship; each part of
both has tests, and in both cases the join between two parts had none.

## The mention: the projection's actor is not the author

`textMentionsFor` does not notify the person who wrote a mention — naming
yourself is a note to self. A comment message carries its author as a field
(ADR-0046) and the comment path compares against that. Page text has no such
field, so this compared against `actorId`, the projection's actor.

Follow where that comes from:

- `sync/server.ts` called `room.setActor(actorIdOf(conn.claims))` on **every
  inbound message from every connection**, before the write-permission check.
- `sync/room.ts` keeps it for the next flush and never clears it, describing
  itself accurately as "best effort: the last writer wins".

So the actor was not "who wrote this". It was **who last said anything** — and a
reader who merely opened the page said something. The person most likely to have
a page open the moment somebody names them is the person being named, whose own
mention was then filtered out as if they had written it. Permanently:
`ON CONFLICT DO NOTHING` stops a duplicate and never fills a gap, so every later
projection dropped it again.

The mail Markus received was the activity digest, not the mention mail. There
was no row to mail.

### Decision

**`mentionsIn` reports who wrote each mention, from the document.**

The CRDT already knows: the item holding the mention node carries the client
that inserted it, and the document's attribution mapping (ADR-0022) says which
person that client is. `authorsByClient` in core inverts the mapping;
`mentionsIn` returns `writtenBy` beside `userId` and `blockId`.

This is the same answer ADR-0046 reached from the other end. A comment carries
its author because "who said this must not be inferred". Page text cannot carry
a field, so it is read from the item — inference from the document, which is the
only kind that is not a guess.

`writtenBy` is null when the document does not say: an old page, or attribution
pruned after the writer's other words were deleted. Then nothing is filtered and
a self-mention notifies once. That is the right way round — telling somebody
about their own sentence is a small annoyance, and silently dropping everybody
else's is the bug being replaced.

**And the actor is set only for somebody who could have written.** Independent of
mentions: a reader taking credit for a paragraph in `last_edited_by` is wrong on
its own terms. Still best-effort — one flush covers several people's edits — but
"the last person who could write" is a defensible approximation and "the last
person who said anything" is not one.

## The highlight: a text is not a node

Every link in that chain existed. Click handler, bridge, listener, dispatched
transaction, registered plugin, per-character authorship, CSS class. And eleven
tests, all of which assert the wiring **as source text**:

```js
assert.match(bridge, /export function registerHighlighter/);
```

The one half with no test was the one the plugin's own header calls the risky
part — turning an index inside a `Y.XmlText` into an editor position. It did
this:

```js
const node = mapping?.get(text);      // text is a Y.XmlText
if (!node) return null;
const found = findNodePosition(state, node);   // identity search in the doc
const position = found + 1 + absolute.index;
```

y-prosemirror maps a `Y.XmlElement` to one node and a `Y.XmlText` to an **array**
of text nodes. An array is truthy, so it passed the guard; nothing in the
document was ever identity-equal to it; every range was skipped; the decoration
set was always empty. The button toggled, `aria-pressed` flipped, and the page
did nothing.

### Decision

**Use y-prosemirror's `relativePositionToAbsolutePosition`** — the exact inverse
of the `absolutePositionToRelativePosition` the comment anchors already use, from
the same file in the same library. The plugin's header says the reason not to
compute the offset here is that re-deriving y-prosemirror's mapping and being
subtly wrong puts a highlight over the wrong sentence. The code under that
paragraph re-derived the mapping.

**And on a local edit the marks are mapped, not recomputed.** Writing the test
turned up an ordering fault the fix would otherwise have left in place: a local
edit reaches the plugin's `apply` *before* y-prosemirror writes it into Yjs, so
recomputing there reads the authorship from before the keystroke and lays it over
the document from after it — every character typed above a highlight moved the
text and left the mark behind. Now a recompute happens on y-prosemirror's own
announcement (the one moment the two documents agree), and an ordinary edit moves
the existing decorations through `tr.mapping`, which is the only question
answerable before Yjs has heard about it.

## Consequences

**Two more bugs found by writing the tests that were missing.**

A mention node's `userId` is written by a client, so it is whatever a client put
there — and `notifications.user_id` is a uuid column. `notificationsFor` and
`assignmentsFor` both drop a `guest:` key; `textMentionsFor` did not. A mention
naming a guest aborted **the whole projection** with `invalid input syntax for
type uuid`, taking the page's comment counts, its search row and its
notifications with it. The third time in this file that a rule held in two of
three places.

`GET /api/inbox/count` joined neither `pages` nor `workspaces`; `GET /api/inbox`
joins both and drops a row whose page is archived or whose workspace is deleted.
So a notification on a page somebody later trashed was **counted on the badge and
absent from the list** — a badge saying two over an empty screen, which reads as
the list being broken and made "alles leer" ambiguous to diagnose. The count is a
separate query because it sits on a button on every page and has to be one
indexed count; that is a reason for a second query and never for a second answer
(ADR-0086, again).

**A test that asserts a wire exists is not a test.** `contributors.test.ts` has
eleven of them and they would all still pass with the feature completely broken —
which is what happened. The rule this suggests is narrow enough to be usable: a
source-shape test is fine for *where* something is, and cannot stand in for *what
comes out of it*. Where the second is possible, it is the one that counts. Both
of the new test files here ask a running thing what it produced.

**A guarded value that is nearly right is worse than an absent one.** Both faults
had something plausible in hand — an actor that is usually the author, a mapping
entry that is usually a node — and both guards passed. Neither failed loudly;
both produced nothing, quietly, forever.

## Alternatives considered

**Stop filtering self-mentions.** Would have fixed the report in one line and
told everybody about their own writing. Rejected: the rule is right, it was the
input that was wrong.

**Reset the room's actor after each flush.** Narrows the window and does not
close it — the actor would still be whoever last wrote, which for a debounced
flush covering two people is still not "who typed this mention". The document
already knows; asking it is not more work.

**Derive the mention's author in the server rather than in core.** The walk over
Yjs items is generic, and core is where `mentionsIn` and the attribution
convention already live. A second copy on the server is the thing ADR-0022 moved
this code into core to avoid.

**Map the `Y.XmlText`'s parent element instead.** Would have worked, and requires
summing the sizes of preceding siblings inside the parent to find where the text
starts — arithmetic over y-prosemirror's model, which is exactly what the header
warns against. The library exports the function that does it.
