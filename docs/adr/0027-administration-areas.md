# ADR-0027: Three areas, and a right that can be given away

## Status

Accepted; the single-screen arrangement it describes is superseded by ADR-0032,
which keeps its reasoning about naming the subject and makes the subject the
boundary.

**And "implemented" was wrong about the middle area.** This record decided that
the workspace you are in is one row in the list, and explicitly rejected having
both a current-workspace screen and a list — "two interfaces for one job", where
"the one nobody uses is the one that drifts". What was built is the sketch this
paragraph rejected, and both halves then drifted exactly as predicted: neither
can do the whole job. [ADR-0067](0067-one-place-to-edit-a-workspace.md) finishes
what this one decided.

## Context

Settings has grown into a flat list where "Invite people" appears twice and
means two different things, and nothing on either says which. Workspace matters,
personal matters and instance matters sit beside each other in one column.

The request: separate them, and make managing workspaces a place of its own
rather than something done inside whichever workspace happens to be open.

## Decisions

### Three areas, and the middle one is not "this workspace"

- **You** — account, appearance, what concerns nobody else.
- **Workspaces** — every workspace on the instance, with an overview and the
  editing of each: members, roles, invitations, permissions, deletion.
- **Instance** — accounts, single sign-on, maintenance, invitations to the
  instance.

The middle one is deliberately not "the workspace you are looking at". A
first sketch had both — settings for the current workspace, and a list for the
others — and that is two interfaces for one job. The one nobody uses is the one
that drifts, and here it would be the one an instance administrator relies on to
fix somebody else's workspace.

So the workspace you are in is simply one row in the list.

### A right that can be given away

Today there are two states: instance administrator, or not. Managing workspaces
becomes a third, grantable separately.

Kept narrow on purpose: **create, edit, invite to, and delete workspaces, and
set who is in them**. Not accounts, not single sign-on, not maintenance. A right
that covers everything except one thing is an administrator under another name,
and the point of granting it is to hand over a job without handing over the
instance.

### Management, not reading

Somebody with the right manages a workspace's membership and settings. It does
not let them read the pages.

They could add themselves as a member and read that way — and that is the
answer, not a hole in it. Adding yourself appears in the members list, where the
people already there can see it. Silent reading would not. A right that quietly
grants access to everybody's notes is a different thing from one that lets you
administer them, and it should not be possible to confuse the two.

### The short way stays

Somebody who may manage workspaces and is looking at one gets a link from there
straight to its row. The long way through the list exists and is not the route
somebody should have to take when they are already standing in the thing they
want to edit.

This is a shortcut into the single interface, not a second copy of it — which is
what the whole first decision is about.

## Consequences

`is_instance_admin` stops being the only question anything asks. Every place
that checks it has to decide which of the two it means, and some of them mean
the new one.

The workspace list needs numbers worth reading — members, pages, when it was
last touched. A list of names is a list somebody has to click through to learn
anything.

An instance with many personal workspaces (ADR-0025) will have a long list, most
of it one person each. The overview should separate them from shared ones, or a
hundred people read as a hundred teams.

## Alternatives considered

**Leaving workspace settings inside each workspace as well.** Rejected above:
two interfaces for one job.

**Making the new right imply reading.** Rejected: administering a workspace and
reading it are different, and conflating them would mean the only way to let
somebody manage members is to let them read everything.

**No new right, instance administrator only.** Rejected as asked — but worth
recording that it is the simplest option and the one to fall back to if the
right turns out to be granted to nobody.
