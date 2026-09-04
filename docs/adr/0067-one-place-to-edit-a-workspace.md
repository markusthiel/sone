# ADR-0067: One place to edit a workspace

## Status

Accepted and built.

## Context

An operator reported that the workspace settings are in two places and neither
is complete, and asked whether they could be one. **They were already supposed
to be.**

[ADR-0027](0027-administration-areas.md) decided this and said why, in the
paragraph that matters most here:

> The middle one is deliberately not "the workspace you are looking at". A first
> sketch had both — settings for the current workspace, and a list for the
> others — and that is two interfaces for one job. The one nobody uses is the one
> that drifts, and here it would be the one an instance administrator relies on
> to fix somebody else's workspace.
>
> So the workspace you are in is simply one row in the list.

What was built is the sketch it rejected. There is a `/workspace/…` screen for
the workspace you are in, and a `WorkspaceDetail` inside the administration for
any workspace, and they have drifted exactly as predicted:

| `/workspace/…` | administration → workspaces |
| --- | --- |
| name and mark, typography, people, groups, export | appearance, icon, members, invitations, deletion |

They overlap on the name, the appearance, the members and invitations — and each
holds something the other lacks. **Neither screen can do the whole job**, which
means the prediction came true in both directions at once: an administrator
fixing somebody else's workspace cannot change its typography, and an owner
looking after their own cannot delete it.

So this record is not a new decision about structure. It is ADR-0027's decision,
finally implemented — plus the one thing ADR-0027 did not decide, which is what
somebody who is *not* an administrator sees there.

## Decisions

### One screen, reached from two places

A single workspace detail screen, taking a workspace id. The administration's
list links to it for any workspace; "this workspace" in the account menu links to
it for the one you are in.

Not two screens sharing components — **one screen**. Shared components were
available for the last three releases and are what allowed the drift: two
callers each picked the parts they needed.

### The sections are the union, and nothing is dropped

Name and mark, appearance, typography, people, groups, invitations, export,
deletion. Everything either screen offered today, in one list.

A merge that quietly loses a section is worse than the split it replaces,
because the split at least had the section somewhere.

### Rights decide what is **editable**, not what is **visible**

A member sees the whole screen and can change nothing but what concerns them. An
owner or a workspace manager can change everything.

Hiding fields would be cheaper to build and worse to use: **a field that is
absent produces "where has it gone", and a field that is present and disabled
answers the question by existing.** Somebody who cannot rename a workspace still
benefits from seeing what its name is, and from seeing that renaming is a thing
that exists and is not theirs.

Deletion is the exception, and only in one direction: it is present and disabled
for a member, because a destructive control that appears the moment somebody is
promoted is a control they meet by accident.

### Who appears in the list

An instance administrator or somebody with the workspace-management right sees
every workspace. Everybody else sees the ones they are a member of.

One list of different lengths rather than two screens — the same shape the
second-factor work settled on, and for the same reason: a screen whose existence
depends on a right is a screen somebody has to be told about.

### ~~"This workspace" stays, as a link~~

*Amended: it does not, and keeping it was the mistake.*

The reasoning above is sound in isolation and was wrong in company. With the
list added, the account menu had **both** entries — "this workspace" and
"workspaces" — and the administration still had the list as well. So a record
about removing two interfaces for one subject produced three ways in, and the
operator's verdict was that it had not been improved. That was correct.

One entry now: **Workspaces**, opening the list, with the workspace being looked
at first in its table and marked. That costs one click more than the shortcut
did, and it buys one concept instead of two.

### The administration gives workspaces up entirely

Not a section there at all. An instance is the server — accounts, single sign-on,
mail, maintenance — and a workspace is not one of its settings. Leaving the list
in both places was the same duplication in a new coat, and its section's own
comment still claimed a distinction that had stopped being true.

With it goes the only administration section that answered to the
workspace-management right rather than to being an instance administrator, so
that filter is gone too.

## Built so far

`WorkspaceDetail` is deleted, and the screen at `/workspace/…` gained the two
sections it lacked: invitations and deletion. The id is in the address —
`/workspace/:id/:section` — so there is one URL for a workspace's settings from
either direction, and the short form still means "the one I am in" so an old
link lands somewhere useful.

Deletion moved into its own component to be lifted, and it follows the rule:
present and disabled for somebody who may not use it, with a line saying whose
it is. The typed name still has to match — a button enabled by a right alone
would be one click from gone.

**Five guards failed, and every one of them was holding a decision this record
reverses.** One asserted the administration keeps the opened workspace in local
state — "a step inside the section, not a place to link to", which is exactly
what is being undone. Three read `WorkspaceDetail` and could not, because it is
gone. One found a message nothing used any more.

They were right to fail. A guard that survives a reversal of the thing it guards
is a guard that was checking the wrong layer.

**The list, for everybody.** It was administrator-only, and the scoping is now
in the server: every workspace for somebody with the right, the ones they are a
member of for everybody else. Filtering in the interface as well would have been
a second answer to one question — which is how the two screens this record
merges drifted apart in the first place.

It has its own route at `/workspaces`, reached from the account menu beside the
shortcut to the current one.

**And loosening that route nearly removed the deletion guard beside it.** The
replacement matched twice, and the second site was `POST
/api/admin/workspaces/:id/deletion` — which would have let any member mark any
workspace deleted. The compiler caught it only because a variable went unused.
There is a test for it now, in the same test as the loosening, because the
loosening is not safe without it.

**Rights, and two things they were not.**

The screen's `canEdit` read the workspace role alone — owner or admin of *this*
workspace. The route has always accepted the role **or** the instance-wide
workspace-management right, which is how somebody administers a workspace they
are not in. So an administrator opening a foreign one found every control
disabled while the server would have accepted the save: **the interface was
stricter than the rule it was mirroring**, and a disabled control produces no
failure to read.

It also had no name to show for a workspace the session does not carry, so a
foreign one read "Untitled" with everything greyed out. It asks the list route,
which is scoped by the same rights and is therefore the one source that already
knows.

**And the route disagreed with its own comment.** The rights were fetched only
when the role was null, so somebody with the management right who happened to be
an ordinary *member* of a workspace was refused — while the same person could
have edited it by leaving the workspace first. **A right a membership takes away
is not a right.** Fixed, with the test named for that case.

Nothing finer than this is needed for the report that prompted the record: an
owner edits their own, a manager edits any, a member reads. Per-section rights
stay undecided below.

## Consequences

`WorkspaceSettingsScreen` and `WorkspaceDetail` become one component. The
administration keeps its list; the account menu keeps its entry; the URL for a
workspace's settings becomes the same one from both directions, which is also
what makes it linkable.

Everybody who is a member of a workspace can now reach a screen that was
previously administrators-only, reading rather than editing. That is the point,
and it is worth saying out loud rather than discovering: **the member list of a
workspace is visible to its members.** It already was, in the people panel.

## What is deliberately not decided

**Folding the instance area in.** An instance is not a collection of workspaces;
it is the server. The mail relay, the sign-up policy and the second-factor
requirement belong where they are, and a "settings" screen that mixes the two
would make "who can change this" unanswerable at a glance.

**A per-section right.** "Can edit the name but not the members" is a
permissions system, and this record is about where controls live rather than what
they are called.

**A per-workspace right finer than owner and member.** "Can edit the name but
not the members" is a permissions system, and this record is about where controls
live rather than what they are called.
