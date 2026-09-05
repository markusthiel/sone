# ADR-0087: A role is a name for a set of rights

## Status

Proposed. Nothing is built. This record exists to be argued with before code is
written, because it changes a decision ADR-0026 made deliberately.

## Context

Markus, looking at the permission area:

> Momentan kann ich einen user in den workspace hinzufügen. Der sieht dann
> eigentlich alles, richtig? Kann ich da dann noch rechte vergeben, zb nur
> lesend hinzufügen. Kann ich überhaupt Rollen definieren? Das sollte sehr fein
> möglich sein. Das wäre für mich noch einmal ein eigener Settings Bereich. Und
> diese Rolle sollte man Usern und Gruppen zuweisen können.

Three things are true of the model today, and each of them is a decision rather
than an omission.

**There are four roles and they are a string type.** `owner | admin | member |
guest`, in `packages/core/src/types/access.ts`. There is no table, no list of
rights, nothing assignable. A role's meaning is a `switch` statement in two
files.

**There is no read-only membership.** `member` maps to `editor` on every page
that is not restricted. A workspace has no level between "may write everything"
and "may see nothing without an explicit grant".

**A grant can only widen.** Both resolvers take the maximum of role and grants,
and ADR-0026 gives the reason: joining a group must never silently *reduce*
what somebody could already do. The consequence is that granting a member
`viewer` on a page does nothing at all — it is a control that appears to work
and does not, which is the failure mode this project keeps finding.

So "add somebody read-only" is not a setting anybody forgot to expose. It is
inexpressible, and the only shape that comes close today is `guest` plus a grant
per page.

## The thing to decide first

ADR-0026 says, as a heading: **"Groups name who, never what."** That was right at
the time and it is the sentence this record overturns. It is worth being precise
about what was actually argued there, because most of it survives.

ADR-0026's reasoning was about *page* access, and it rests on a constraint that
has not changed: a page is a CRDT document, the server either serves it or does
not, so page access is a **ladder** — view, comment, edit, manage — and not a set
of independent switches. There is no coherent "may edit but not view".

What ADR-0026 did not consider is everything that is *not* a page: who may add
people, who may make groups, who may change the workspace's typography, who may
export it. Those are genuinely independent of each other, and today they are all
answered by one comparison — `role === 'owner' || role === 'admin'` — written out
by hand in `groupRoutes.ts`, `workspaces.ts`, `permissionRoutes.ts` and
elsewhere.

That is the shape a role model fits. Not "make page access configurable", which
the CRDT forbids, but "stop having one boolean stand in for eight different
questions". ADR-0027 already did exactly this once, splitting
`users.is_instance_admin` into two named rights because "`is_instance_admin` used
to be the only question anything asked; now there are two, and every place that
checks has to mean one of them".

## Decisions

### A role is (a default page level, a set of workspace rights)

Not a bag of rights. Two parts, because the two halves of the question have
different shapes:

```
role
  page_level      viewer | commenter | editor | admin | none
  rights          a set drawn from a fixed enumeration
```

`page_level` is what the role gives on a page in this workspace that carries no
rules of its own. It stays a ladder and stays comparable with `atLeast`, because
a dozen call sites compare it and because the CRDT constraint has not moved.
`none` is what `guest` is today.

`rights` is a set, because "may manage groups" and "may export the workspace"
have nothing to do with each other and no order between them.

**"Nur lesend" is then a role with `page_level = viewer` and no rights.** That is
the whole of Markus's first question, and it falls out rather than being built.

### The rights are an enumeration in code, and a check enforces it

```
people.manage      add and remove members, change what role they hold
groups.manage      create groups, change who is in them
roles.manage       define roles and assign them
workspace.settings name, mark, typography, appearance
workspace.export   export the whole workspace
pages.create       create a page at the top level of the tree
links.share        create a share link on a page one may manage
trash.purge        empty the workspace's trash for good
```

Eight, and the list is closed. Adding one is a change to this file and to the
code that checks it, in the same commit.

**A right nobody checks is a lie**, and this project has now found that exact
shape six times (ADR-0084 names it). So the enumeration gets a mechanical guard
alongside the others in `scripts/`: `check-rights-enforced.mjs` fails the build
when a right in the enumeration is not referenced by at least one server-side
check. A settings screen offering a switch that gates nothing is worse than not
offering it, because somebody will turn it off and believe something.

The rights are named after what they let somebody *do*, not after a screen. A
screen can move.

### Owner is not a right

`owner` stays a property of the membership, outside the role.

Not for tidiness: it is the one right that needs a holder of last resort. "The
last owner cannot be removed" is enforceable against a column. Against a role it
becomes "the last person holding a role that includes `workspace.delete`", which
has to be recomputed on every role edit, and a workspace whose last owner-ish
role was edited by mistake is a workspace nobody can administer.

So: every workspace has at least one owner, an owner holds every right
implicitly, and a role cannot grant ownership.

### Roles are assignable to people and to groups

A membership names a role. A group names a role. Somebody's effective role is
the **union** of the rights and the **maximum** of the page levels, over their
own role and the roles of every group they are in.

Union and maximum rather than any form of subtraction, for ADR-0026's reason
unchanged: **being added to a group must never reduce what somebody could
already do.** A model where joining takes something away makes every group
membership a thing to audit before granting.

This is also what keeps roles composable in the way Markus asked for: a person
is "Redaktion" and in the group "Vorstand", and holds what either gives.

### The four roles today become the four roles tomorrow

`owner`, `admin`, `member`, `guest` become **system roles**: real rows, with
`workspace_id IS NULL`, present in every workspace, not editable and not
deletable. A custom role is the same table with a `workspace_id`.

Every existing membership is migrated to point at the system role matching its
current string, so behaviour on the day of the upgrade is identical. The string
column is then no longer read.

**Migrated rather than kept alongside.** A nullable `role_id` that falls back to
the old enum would mean two sources for one answer, which is precisely what
ADR-0086 was written about a week ago: two resolvers disagreed for months
because one of them had never learned about a table. One source, or this record
is describing the next incident.

### The precedence rule: base, widen, cap

Three layers, and they are asked in this order.

1. **The role's page level** is the base.
2. **Grants widen it.** A page permission or a group page permission raises the
   level for the page it names and, if it says so, its subtree. Never lowers.
   Unchanged from today.
3. **A cap on a page lowers it, and beats everything.** A new row: a maximum
   level for a page and its subtree. A page capped at `viewer` is read-only for
   everybody it applies to, whatever their role or grants say.

Markus chose this shape over the two simpler ones. It is the most expressive and
it is the one that needs the most explaining, and both halves of that are worth
being honest about.

The cap is what makes "this section is reference material, nobody edits it"
sayable in one place instead of by removing everybody's grant one at a time. It
is also what makes "why can I not edit this" a question with a non-obvious
answer, which is the next decision.

### A cap can never lock out the people who must lift it

Somebody holding `roles.manage`, and the owner, are exempt from caps.

The same escape hatch `resolvePageAccess` already carries for restricted pages —
"Owners and admins keep manage, or a restriction would be able to lock out the
people who have to be able to undo it". Without it the first misapplied cap on
the workspace root is unrecoverable without database access.

### Every refusal names the rule that caused it

`Resolution.reason` exists already: `'role' | 'granted' | 'inherited' |
'restricted' | 'not_a_member'`. It gains `'capped'`, and the interface uses it.

This is the price of layer 3 and it is not optional. A model where access is the
maximum of two things is explainable by "somebody gave you this". A model with a
cap on top is not: the page looks like every other page and behaves differently,
and without a sentence saying *which* rule decided, every permission question
becomes an investigation. The reason is already carried through A; it has to be
carried through B and reach the screen.

### Both resolvers, one loader — again

The role and its rights are loaded by **one** function, used by
`resolvePageAccess` and by `resolveSessionClaims`/`revalidateClaims` alike, and
`accessAgreement.db.test.ts` grows cases for roles and caps.

Stated as a decision rather than left as an obvious implementation detail
because it was obvious last time too. `page_group_permissions` was read by one
resolver and not the other from the day it existed, and the end-to-end test
written to prove group rights worked went through the resolver that had them
(ADR-0086). The agreement test is the only guard that catches this, and it only
catches what it covers.

## Order of building

ADR-0026 sequenced its own work and that was right. The same here:

1. **Roles as data.** The table, the system roles, the migration of existing
   memberships, one loader, agreement tests. No new behaviour at all — the
   observable result is that nothing changes, which is the point.
2. **Rights replace the hand-written checks.** `role === 'owner' || role ===
   'admin'` becomes `has('groups.manage')` and the rest, one route at a time,
   with the enforcement check script landing in the same change as the
   enumeration.
3. **The settings area.** Define a role, assign it to people and to groups.
4. **Caps.** Last, because it is the only part that adds a rule readers have to
   learn, and because layers 1 and 2 are worth having on their own if 4 turns
   out to be a mistake.

Steps 1 and 2 are invisible to anybody using SONE and are most of the work.
Step 3 is the thing that was asked for. That ordering is deliberate: the screen
is easy to build against a model that is wrong.

## Consequences

**"Nur lesend" becomes expressible**, both as a role for a whole workspace and
as a cap on a subtree.

**Eight questions stop being one boolean.** Today, giving somebody the ability to
manage groups also gives them the ability to change everybody's role, export the
workspace, and delete pages nobody shared with them. That is not a design; it is
what happens when a role is a string.

**A workspace can be misconfigured in ways it could not be before.** A role with
no rights and `page_level = none` is a person who can log in and see nothing.
Roles are power, and power includes the power to get it wrong. The owner
escape hatch and the un-deletable system roles are the floor.

**Explaining a refusal becomes part of the feature**, not a nicety. See the
decision above.

**ADR-0026's heading is superseded, its argument is not.** Groups still name who.
What changes is that a *role* names what, and a group can hold one. The CRDT
constraint that made page access a ladder is untouched, and block-level
permissions remain unbuildable for the reason ADR-0026 gives.

**Share links are a second grant path and must respect caps.** ADR-0026 already
warned that links must not become a way round page permissions. A cap that a
share link ignores is a cap that anybody who may create a link can lift.

## Alternatives considered

**Rights only, no page level — one flat set including `page.edit`.** Simpler to
describe and wrong: page access is a ladder that a dozen call sites compare with
`atLeast`, and the CRDT makes "may edit but not view" meaningless. Flattening it
would mean either forbidding incoherent combinations at the edit screen — rules
about rules — or serving documents to people who may not read them.

**Roles per page rather than per workspace.** Considered because grants are
already per page. Rejected: it makes a role a thing you define once and assign
two hundred times, which is the problem groups exist to solve, restated one
level up.

**Let a grant lower access, instead of a separate cap.** Markus was offered this
and chose against it, rightly. It would delete ADR-0026's rule that joining a
group cannot demote you — a grant that lowers is a grant that a group can carry,
and then adding somebody to "Vorstand" can take away what "Redaktion" gave them.
A cap is attached to a **page**, not to a person or a group, so it cannot travel
that way.

**Keep the four roles and add only `viewer`.** The smallest change that answers
the literal first question, and it was tempting. It leaves the eight
workspace-level questions answered by one comparison, and it means the next
request — "the office should be able to add people but not export everything" —
needs this record anyway. Answering half of it now and half of it later costs a
second migration of the same column.

**Copy Docmost's or Outline's model.** Both keep a fixed role list and put
flexibility in groups, which is where SONE is today. Neither offers definable
roles, so there is nothing to copy for the part that was actually asked for.
