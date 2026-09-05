# ADR-0098: A constant and a trigger

## Status

Accepted. Built. The fourth subject on the notify frame, and the first one that
actually cost what ADR-0093 promised.

## Context

The claim has a history worth keeping straight, because it was wrong twice
before it was right.

- **ADR-0093** put a scope string on the frame so that *"the next thing worth
  nudging costs no protocol version"*.
- **ADR-0096** built the page tree, confirmed the protocol half, and repeated
  the promise as *"the next subject is a constant and a trigger"* — while giving
  the page tree its own Postgres channel, which made that false.
- **ADR-0097** folded the channel so it carried its own scope, and added the
  trash.

This is the first subject to arrive after all of that, and the claim held: a
constant on each side of the wire, a name in the allow-list, a trigger, and a
`useNudge` call. No channel, no bus handler, no wiring.

So this record is mostly not about plumbing. It is about **which changes belong
to this screen** — which is the only interesting question left, and the one
where a mistake is expensive in both directions.

## What moves the shares screen

Three lists (ADR-0088): links, what this person granted, what was granted to
them.

| change | shares | pages |
|---|---|---|
| a link created, revoked, changed | ✓ | |
| a grant given, changed, taken away | ✓ | ✓ |
| somebody joins or leaves a **group** | ✓ | ✓ |
| a page archived, restored, deleted | ✓ | ✓ |
| a rename, a move, an icon | | ✓ |

**A link is not the tree's business.** It changes nothing a member's tree draws,
and nudging that would be a full tree refetch, for everybody, for a row on a
different screen.

**A grant is both.** It appears in "granted" and in the other person's
"received", and since ADR-0095 it changes what each tree entry *allows*. Two
scopes on one change, the same shape as archiving.

**Archiving takes rows off this screen** without anybody sharing anything: every
one of the three queries ends `AND p.archived_at IS NULL`. Left behind, such a
row is a "withdraw" button for something that is not there — and this is the
screen where a stale row is worst, because every row on it is an action.

**A rename is deliberately absent.** The screen shows a page's title, so a
rename does make one row read differently. Nudging on it would be a request per
rename per person with the screen open, for a word. The focus refresh catches
it, which is what the focus refresh is for.

## The finding

**Being added to a group is being given pages, and nothing announced it.**

"Received" lists a group grant as "via the group X", because *"why do I have
this"* is the question somebody has when they find a page they did not expect.
So a membership is a share, and `group_members` had to nudge this screen.

Which is when it became obvious that a group grant reaches its members — so
somebody added to a group gains pages, and **their sidebar went on showing what
it showed before** until the next focus event. A gap in ADR-0096's trigger set,
found not by a report and not by a test of that feature, but by asking which
changes belong to a different screen.

That is the third time in this sequence that widening the question found
something the narrower one had missed, and it is the argument for writing the
table above before writing the trigger.

> **And the fourth time was checking this one.** ADR-0099 asked whether the
> nudge added here actually leads anywhere — whether somebody added to a group
> can then *open* what their tree now shows. They could not: claims are a
> snapshot from authentication, and the only thing refreshing it was a
> five-minute sweep. Asserting that a nudge arrives is not asserting that the
> chain works.

## Consequences

**`notify_trash_changed` is now `notify_archived_changed`.** It speaks for two
screens, and a function whose name claims one subject while emitting two is a
name somebody will trust.

**Twelve route tests, ten failing before the change.** The two that passed are
the two asserting silence, which passed for the wrong reason — the standing
shape of these files.

**One of those failures was mine, and it is worth the sentence:** the revoke
test passed `link.id`, which does not exist on the returned type, so the UPDATE
matched no rows and nothing was sent. It read exactly like a missing trigger,
and it was the "an empty statement says nothing" property working correctly. The
lesson is in the test file: when one of these reports silence, check that the
statement changed anything before suspecting the trigger. (The typechecker would
have said so; I ran the test first.)

**Four subjects, three channels, two indexes, one frame.** The fifth is a
constant and a trigger, and that sentence can now be written without a footnote.

## Alternatives considered

**Let the shares screen listen to `pages`.** No migration and no constant, and
every rename in the workspace refetches three joined lists for everybody with
the screen open. The whole point of a scope is to say which list.

**Nudge on a rename too, since the screen shows titles.** It is the one change
that makes a row *read* differently without making it *wrong*. Paying a request
per rename for it inverts the trade this whole line of work rests on.

**Nudge on a group being renamed.** Same class as a page rename — "via the group
X" would show the old name until focus. Same answer, and it is rarer still.

**Carry which list changed instead of which screen.** Then the client has to map
three list names onto one fetch, which is one route. The scope names the screen
that refetches; that is what a scope is for.
