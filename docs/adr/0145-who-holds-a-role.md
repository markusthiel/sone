# ADR-0145: Who holds a role

## Status

Accepted. Built. Closes *„Rollenkarten zeigen keine Namen der Personen, die eine
Rolle halten, nur die Anzahl"*, open since ADR-0119.

## Context

The card that defines what a role means ends with a line about who has it:

> Eine Person, eine Gruppe

Which is an answer to a question nobody asked. Somebody looking at this card is
about to change what the role *means* — what they want first is **whom that
lands on**, and a number sends them to another screen to turn it into people.

The count was right to be there and is not enough: ADR-0119 put it on the card
precisely so that changing a role would not be done blind, and then stopped one
step short of the thing being guarded.

### And there is a rights question in it, already answered elsewhere

ADR-0087 drew this line and the roles screen had never been asked it:

> **Was eine Rolle bedeutet, festzulegen ist `roles.manage`; wer sie hält, zu
> entscheiden ist `people.manage`** — ob der Halter Person oder Gruppe ist.

Both rights reach the roles listing, deliberately: you need it to define a role
and you need it to give somebody one, which is why it is one route rather than
two. So the *count* travels for both — it is a fact about the role. **Names are
a fact about people**, and by that line they belong to `people.manage`.

## Decisions

### The names come with the list, and only the first few

Five people and five groups per role, ordered by name in SQL rather than
afterwards, so the five that arrive are the first five by name and not the first
five the planner reached.

A card is not a member list. That screen exists, it scrolls, and it is one click
away; this line exists to say *whom this affects*, which five names and a
remainder answer as well as forty would.

### The remainder is subtracted, not sent

The card already has the totals. "and 3 more" is computed from them, so a sixth
person is a number rather than a name that never arrives — and there is no
second count on the wire to disagree with the first.

### Absent is not empty

`heldBy` is **absent** for a caller who may define roles but not decide who
holds them, and an **empty pair of lists** for a role nobody holds.

The card has to draw both without lying: empty means *nobody has it yet*, absent
means *the count is all you are being told*. Collapsing them would print
"nobody" at somebody who was simply not told — ADR-0139's rule, from the other
side: there it was a screen promising mail it could not send, here it would be a
screen reporting an emptiness it had not been shown.

### The second right is asked, not inferred

`requireAnyRight` answers *may you see this list at all*. Whether the caller
holds `people.manage` is a second question, so it is a second call rather than
something read off the first — the shape ADR-0110 argues for, where a
precondition that lives only in a caller's head is a precondition somebody gets
wrong.

## Consequences

**Nine tests, six red.** Five on the route — the names, a group among them, the
cap and its order, and the rights boundary — and three on the card: names, a
group beside a person, and the remainder.

**Two could not fail before and stay:** "nobody" is still said in words, and a
card that was not told the names still shows the count. They are what this
change could have broken, and the second is the one that would have been a lie.

**The rights test was proved to bite**, by making the server hand the names to
everybody and watching it go red. A test about a refusal that has never seen the
refusal fail is a test about nothing.

**Not done:** the names are not links. A card is not a place to navigate people
from, and the screen that is — Leute — is one click away in the same settings
area.

## Alternatives considered

**All the names.** A role every member holds would put the whole workspace on a
card, and the card's job is to be read at a glance before a decision.

**A second request per card, on demand.** A request per role for a line that is
five short strings, and a card that changes shape after it is read.

**Send the remainder as its own number.** Two counts for one fact, and the
second is the one that will be wrong.

**Names for anybody who can see the roles list.** Easier, and it hands the
membership of a workspace to somebody whose right is over definitions. The line
was drawn in ADR-0087; this record applies it rather than deciding it again.

**Leave the count and link to Leute.** The link exists already, and the trip is
exactly what the card is meant to save.
