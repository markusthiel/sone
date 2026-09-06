# ADR-0128: The other half of being let in

## Status

Accepted. Built. Asked for. The first of the six mails proposed beside ADR-0121
and left unbuilt; uses that record's letter and obeys ADR-0058's rule unchanged.

## Context

From the concept, listed first among what was still missing:

> **Zugriff entzogen / Rolle geändert.** Das Gegenstück zur jetzt gebauten
> Info-Mail — und die wichtigere Nachricht, sonst merkt es jemand an einem 404.

That last clause is the whole argument. ADR-0121 built the mail that says *you
can now work in X*; the two that say the opposite were named beside it and not
built. And they matter more, because of **how each is otherwise discovered**:

- Gaining access shows up as a workspace appearing in a list.
- Losing it shows up as a bookmark that stops working — and the first guess is
  that something is broken rather than that something was decided. The person
  then asks the wrong question of the wrong people.

## Decisions

### Two letters, at the two acts

`removalLetter` when somebody is taken out of a workspace, `roleChangeLetter`
when their role there changes. Both say **who** and **where**, and nothing about
what was in it — ADR-0058's rule holds here exactly as it does for the mail that
lets somebody in: the workspace's name is *where*, and a list of what they can no
longer see would be the content leaving along with the access.

### The removal letter offers nothing to press

There is nothing left for them to open. A button here would lead to the 404 this
letter exists to explain.

The role-change letter does carry one, because there is still something to open —
and it says plainly that what they can do there may have changed, rather than
leaving them to find out by being refused.

### A role set to the one somebody already has is not a change

Read before the write, and no letter when the role id is the same. This is the
saving-a-form case: an administrator opens the members screen, presses save, and
everybody in the workspace gets a letter about nothing.

### An administrator acting on their own row hears nothing

Somebody who just pressed the button knows what they did. A confirmation for
every act is what teaches people to filter mail from this instance — which is
precisely what would then hide the letter that matters.

### Three ordinary reasons there is nobody to write to

No relay on this instance (ADR-0059), an account with no address at all — a guest
(ADR-0033) — and the actor being the target. All three are silence rather than
errors, and they are all in one place, so a fourth caller cannot forget one.

### A failed send never undoes the act

ADR-0121's rule, restated at the other end: they have lost the access whether or
not their mailbox took a message about it, and failing the request would be
undoing a removal that succeeded.

## Consequences

**Eight tests, and five of them are about a letter that must _not_ go out.**
That ratio is the point of the record: the risk here is not a missing mail, it
is a mail sent for every save until people stop reading any of them.

**English only**, the gap ADR-0121 named and this inherits. These two go to
somebody who *does* have an account with a language on it, so unlike the share
mail this one is a real gap rather than an honest answer — and it will be closed
for all of them at once when it is closed at all.

**Five of the six proposed mails remain**: a sign-in from a new device, an
invitation nobody redeemed, a guest link about to expire, a relay that has
stopped working, and a welcome mail. The middle three are scheduled rather than
route-triggered and need the maintenance job; they are the next record.

## Alternatives considered

**One letter for both acts.** "Your access to X has changed" covers removal and
demotion in one template, and it is the wording somebody writes when they have
not decided which of the two happened. The reader has to open the application to
find out which — and in the removal case, cannot.

**Tell them what they lost.** The list of pages would be genuinely useful to the
person and is exactly what ADR-0058 refuses to put in a mailbox. The access is
gone; the titles should not outlive it.

**Notify the workspace's administrators too.** They did it, or somebody with the
same right did. A mail to everybody who *could* have done it is a mail about
somebody else's decision, which is the disclosure ADR-0026 spends its length
avoiding.

**Send on every write regardless.** Simpler code, one fewer query — and the
members screen becomes a mail generator.
