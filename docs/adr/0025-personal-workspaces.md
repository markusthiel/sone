# ADR-0025: Everybody has their own workspace, and invitations are two steps

## Status

Accepted and implemented.

The last part — seeing and withdrawing an invitation that has been sent — arrived
after the rest, which is why nothing could be undone for a while.

## Context

Today there are exactly two ways into SONE, and both are wrong for what a notes
application needs.

An **invitation** is always to a particular workspace with a particular role.
Accepting it creates an account *and* puts somebody in that workspace, with
nowhere of their own. **Open sign-up** creates an account in no workspace at
all: somebody signs in and sees nothing.

There is no way to invite a person to the instance without also placing them
somewhere, and no notion of a person outside their memberships.

Two defects found while reading this:

- Every account created through sign-up is made an **instance administrator**.
  The comment explains why — on an empty database nobody would be promoted
  otherwise — but the condition is missing, so it applies to everybody. With
  open sign-up that is serious.
- An invited person's first experience is somebody else's workspace. For a
  notes application, the first thing somebody needs is a place of their own.

## What comparable systems do

Worth recording, because it did not match the assumption this ADR started from.

**Outline** and **Docmost** both have **one workspace per instance**. Privacy
comes from a layer *inside* it: Outline has collections that can be private to
one person and shared per document; Docmost has spaces with their own
permissions and groups. Neither gives a person a workspace of their own —
"personal" is a private container within the shared one.

Both reached the same shape independently, and the reason is visible in their
documentation: permissions, groups and sharing all live at that inner layer, so
one shared boundary means one set of rules. Docmost adds groups precisely so
that access does not have to be granted person by person; Outline recommends
groups above ten people for the same reason.

## Decision

**A personal workspace, not a personal space.** SONE already has workspaces with
members and roles, and no layer between a workspace and a page. Introducing one —
becoming workspace → space → page — would be a larger change than this asks for,
and it would leave every existing workspace needing a default space to hold what
it already has.

The cost is real and is accepted knowingly: a person's own notes and their team's
notes are in different workspaces, so moving a page between them is a move across
a boundary rather than within one. Outline and Docmost avoided that cost by
having a boundary somebody rarely crosses. The mitigation is that moving pages
between workspaces is a feature to build, not a thing to prevent.

**It is created with the account, always.** Not offered, not on request. A notes
application whose first screen is empty because nobody has invited you anywhere
has failed at the thing it is for. It is an ordinary workspace whose only member
is its owner, so nothing else in the application needs to know it is special.

**Invitations become two separate things:**

- An **instance invitation** creates an account and nothing else. The person
  ends up in their own workspace, which is where a notes application should
  start.
- A **workspace invitation** adds an existing *or* a new account to a workspace.
  If they have no account yet they register first, and then land in both their
  own workspace and the one they were invited to — one flow, two outcomes,
  because being invited somewhere is not a reason to have nowhere of your own.

**Instance administrator is granted to the first account only**, which is what
the existing comment meant to say. Everybody after that is an ordinary person
until an administrator says otherwise.

**Groups come after this, not with it.** Both systems compared here have them,
and both introduced them because granting access person by person stops scaling
at around ten people. But a group is a way of naming *who* — it does not decide
*what* they may do, and this change is about where people are, not what they can
do there. Building both at once would mean deciding the permission model while
the membership model is still moving.

## Consequences

Every user gains a workspace, including existing ones: a migration creates one
for each account that owns none.

The workspace switcher stops being an occasional thing — everybody has at least
two after their first invitation — so it has to be good rather than adequate.

An instance administrator can invite somebody without deciding where they belong,
which is the thing that could not be expressed before.

The count of workspaces per instance now grows with people rather than with
teams. The administration overview should count them separately, or a hundred
personal workspaces will read as a hundred teams.

## Revisited

The condition this ADR set for reconsidering itself — page-level permissions —
arrived immediately, in [ADR-0026](0026-page-permissions.md).

Part of the case for personal workspaces here was that permissions live at the
workspace boundary, so one boundary meant one set of rules. With rules on pages
that is no longer true, and the argument does not survive.

The decision does, on a better footing: a notes application owes somebody a
place of their own, and that is worth a boundary regardless of where permissions
are enforced. The cost recorded above — moving a page between one's own
workspace and a shared one crosses a boundary — is unchanged and still accepted.

## Alternatives considered

**A private space inside a shared workspace**, as Outline and Docmost do.
Rejected for SONE because it adds a hierarchy level to every existing concept,
not because it is worse — on the evidence it may be better for teams, and this
decision should be revisited if SONE grows page-level permissions, since that is
the layer where both of them put them.

**Creating the personal workspace lazily**, on first use. Rejected: the moment
it would appear is the moment somebody is deciding whether this application is
worth their notes, and an empty screen answers that badly.

**Making the personal workspace unlike other workspaces** — undeletable, hidden
from the switcher, special-cased. Rejected: every special case is a branch in
every piece of code that touches workspaces, and the benefit is cosmetic.
