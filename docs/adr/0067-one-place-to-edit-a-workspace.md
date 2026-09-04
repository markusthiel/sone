# ADR-0067: One place to edit a workspace

## Status

Accepted. Nothing built yet.

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

### "This workspace" stays, as a link

It is how people reach the settings for what they are looking at, and removing it
to prove a point about structure would be removing the useful thing. It navigates
to the same screen with the current workspace's id — a shortcut, not a second
interface.

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

**A per-workspace right finer than owner and member.** "Can edit the name but
not the members" is a permissions system, and this record is about where controls
live rather than what they are called.
