# ADR-0094: A projection failure is not a write failure

## Status

Accepted. Built. The class behind ADR-0092's worst fault, rather than the
instance — which turned out to be three separate things, only one of which was
the error code everybody had been calling the problem.

## Context

ADR-0092 recorded, as an open item: *"`isPermanentWriteFailure` does not treat
`22*` as permanent, so a value error makes the room retry for ever."* It stayed
open through ADR-0093, where it was noted as the oldest thing on the list.

The instance it came from: a `guest:` key reached `actor_id uuid`, threw
`22P02` inside the projection's transaction, and took the page's comment counts,
blocks and search row down with it — every time, permanently, silently.

Adding two characters to a list would have closed the sentence and not the
problem. Looking at the class first found three things.

## What was actually wrong

### 1. The rule was still missing in two more places

`textMentionsFor` was given the "is this a uuid" guard in ADR-0091.
`notificationsFor` was given the actor half of it in ADR-0092. Neither of them
was the last place.

- **`assignmentsFor`** drops a `guest:` key and checks nothing else. `props` on
  a block is whatever a client, an importer or an older build put there, and
  `assignee` goes into `user_id uuid`. A todo assigned to `'anna'` aborted the
  projection of the page it was on.
- **`notificationsFor`** has the same gap on `message.mentions`, and a subtler
  one on the reply path: `user_id` there comes from a *previous message's
  author*, which for a document written by an importer need be neither a uuid
  nor a `guest:` key.

Both live in `main`, found by writing a test for the class rather than for a
report. That is now the **fifth and sixth** occurrence of one rule holding in
some places and not others, and the fourth distinct value of "some".

So the guard is one exported function, `isAccountId`, and it is applied in two
kinds of place on purpose: in each producer, where a wrong value can be dropped
near where it was made, **and once more in `writeNotifications`** — which is the
single function that touches the column. The producers' copies can be forgotten
by a seventh producer. The writer's cannot.

A bad `user_id` drops the candidate; a bad `actor_id` is nulled instead, because
`actor_id` is nullable precisely for "there is no account to name" (ADR-0058)
and the notification is still worth having.

### 2. The room put the batch back after a failure that had already succeeded

This is the one worth the record.

`doFlush` did two things in one `try`: append the update to `doc_updates`, then
project. **The append comes first**, so by the time the projection throws, the
edit is durable — documents are the truth and the projection is derived
(ADR-0002).

The catch put the batch back at the front of the queue regardless. So the next
flush appended *the same bytes again*, and the one after that, for as long as
somebody kept typing on a page whose projection was broken. That — not the error
code — is what "it retried for ever" was.

They are now two steps with two answers:

| | fails how | answer |
|---|---|---|
| **append** | work cannot be stored | permanent → poison the room; transient → put the batch back and retry |
| **project** | a derived table is stale | record it, keep the room working, let the next flush try the current document |

A projection failure no longer poisons. Poisoning stops persisting, which is
right for "this instance cannot store work" and exactly wrong for "a table could
not be rebuilt": it would throw away everything typed after the first bad value,
to fix nothing.

**And nothing is scheduled to try again.** Every flush re-projects the *current*
document, so the edit that removes the offending value is the thing that repairs
the page. No retry loop, no job, nothing to run by hand — and the cost of a page
that stays broken is one failed transaction per flush of it, which is bounded by
how fast somebody types.

### 3. It was silent

`markFailed` writes `status`, `last_error` and a climbing `attempts` into
`materialization_state`, and it was called only on the *transient* path. A
permanent failure logged one line to a console and set a boolean that dies with
the process. The page in ADR-0092 had been broken for days.

Now every projection failure is recorded there, and `/api/ready` reports the
count and the twenty most recent page ids beside the poisoned rooms. Read from
the table rather than from the rooms deliberately: the room that saw the failure
may be long gone from an instance that has since restarted.

Like a poisoned room, it does not make the instance unready. The page is still
served, and taking an instance out of rotation over one stale search row is a
worse outage than the bug. It is there to be *seen*.

## The two characters

`22` is in `isPermanentWriteFailure` now. It is the most permanent class there
is — the same bytes produce the same error until the document changes — and it
was the one class of write failure that could be caused by *content* rather than
by an operator.

But the function is now asked in **one** place, the append. The projection's
answer is the same whatever the class, so classifying it there would have been a
distinction with no consequence.

## Consequences

**The cost of a bad value is now one notification.** It was a page.

**A page can be stale without being broken**, and there is now a name for that
state and a place to see it. `projectionFailure` on the room, `status='failed'`
in `materialization_state`, `checks.projections` in `/api/ready`.

**Compaction moved outside the projection's `try`.** It is about the log rather
than the derived tables, and a page whose projection is broken is precisely the
page that keeps accumulating updates — it should not also be the one page that
never compacts them.

**`notifications.test.ts` is on real uuids throughout.** It was half-converted in
ADR-0092, and the half that stayed on `'anna'` is the half that broke when the
guard was added — which is the same lesson a third time: a fixture Postgres
would refuse cannot find out what Postgres does.

**Six tests, all six failing against `main` before any of this was written.**
Two for the live producers, one for a good value beside a bad one, and three for
what happens when a value gets through anyway — which it will.

## Alternatives considered

**Add `22` to the list and stop.** Closes the sentence in ADR-0092. It would
have made the reported bug worse, not better: a value error would now poison the
room, so a page with a malformed assignee would stop *storing edits* rather than
merely stopping projecting.

**Validate on the way into the document instead.** The right place in principle
and unreachable in practice: the document is a CRDT written by clients of
several versions, and there is no chokepoint to validate at. The projection is
the boundary between "whatever is in the document" and "what a typed column will
take", and boundaries are where checks belong.

**Raise on a bad value rather than dropping it.** Which is what the code did,
by accident, and the accident is the ADR. A notification is a courtesy about
somebody else's writing; taking the page down over one malformed name in it is
out of all proportion.

**Retry a failed projection on a timer.** Would repair a page that nobody is
editing. It would also retry a page whose workspace has been deleted, for ever,
and it needs a scheduler, a backoff and a give-up rule — all to shorten a window
that closes on the next edit anyway. `rebuild.ts` already exists for the
deliberate case.

**Make a failed projection unready.** One page with a stale search row would
take an instance out of rotation. The instance is fine; the page is not.
