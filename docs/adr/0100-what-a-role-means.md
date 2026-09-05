# ADR-0100: What a role means

## Status

Accepted. Built. The last item ADR-0099 named and deferred, and the reason it
was deferred turns out to be the design rather than an obstacle.

## Context

ADR-0099 made access changes reach live connections, and left one out with a
stated reason:

> **`roles` is left out and named.** Changing what a role *means* changes access
> for everybody holding it, and a system role is held in every workspace — so
> one edit would revalidate the whole instance. The five-minute sweep covers it,
> and doing better needs a decision about how, not another trigger.

That is true, and it is not an argument for silence. It is an argument for two
narrowings, and once both are made the trigger is affordable and honest.

The gap it left is a real one and unlike the others in this sequence: nothing
about the page changed, nothing about the membership changed. **What changed is
what the word on the membership means.** Somebody's role is edited from `editor`
to `viewer` in the settings screen, and every document they have open stays
writable for up to five minutes.

## Decisions

### `page_level` is the access change; `rights` is not

A role has two halves (ADR-0087). `page_level` is what it gives on a page in
this workspace. `rights` is what it may **administer** — members, groups,
settings, roles.

Rights are read per request by the HTTP routes that check them. They have
nothing to do with a document. So revalidating every connection in a workspace
because somebody ticked a box in the roles screen is work done to confirm that
nothing changed, and the trigger compares `page_level` alone.

This is the same narrowing the tree's trigger makes about `last_edited_at`, and
it is what makes the cost proportionate: an edit that changes what people may
*do with pages* is rare; an edit that changes who may administer things is
rarer, and costs nothing here.

There is a test for the absence, and it works the way the rename test does: move
the level behind the trigger's back, change only the rights, and assert that the
**stale** level survives. A strange thing to assert on purpose, and the honest
way to say "nothing was re-read".

### Name the workspaces that hold the role

A custom role belongs to one workspace and says so — for it the query is a
formality.

A system role belongs to none and is held in many. So instead of "every
workspace", the notification names the ones where a membership or a group
actually points at that role. Bounded by the truth rather than by the schema:
for `member` that is every workspace with people in it, and for a role nobody
holds it is none at all.

It stays rare regardless. The settings screen refuses to edit a built-in role,
so a system role changes only by hand or by migration. What this removes is the
case where somebody does exactly that and nothing happens for five minutes —
which is when they are most likely to be watching.

### A group pointed at a different role is the same act

A group can hold a role (ADR-0087) and `loadWorkspaceStanding` reads it. So
changing `groups.role_id` changes what every member of that group gets, without
touching a membership, a grant or a page.

The same family, one join further out, and it had the same window. Only
`role_id` is compared: a group's name appears on the shares screen as "via the
group X" and is cosmetic there (ADR-0098), and its membership already has a
trigger.

## Consequences

**Every way access can change now reaches an open connection.** Grants, caps,
group membership, workspace membership, share links, a page's place in the
tree — and now what a role means, and which role a group holds. The maintenance
sweep is left as the net for what has no trigger: an expiring session, a
deactivated account, a restored dump.

**Four tests, all four failing before the change**, in the file ADR-0099 started
— which is now eleven cases of one question: *does a change of access reach the
half of the application that was told once and never asked again.*

**The deferral was the right call and the reason was wrong.** ADR-0099 said
doing better "needs a decision about how, not another trigger". It needed both,
and the decision was smaller than the sentence implied: two comparisons and a
join. Worth recording, because a named deferral with a plausible reason is the
kind of thing that stays deferred — this one lasted one round because somebody
asked for it by name.

## Alternatives considered

**Notify every workspace on a system role change.** One `SELECT id FROM
workspaces` and no join, and it revalidates instances where the role is held by
nobody. The join is three lines and is the difference between "everything" and
"what actually changed".

**Compare the whole row.** Simpler SQL, and it makes the roles screen's rights
checkboxes revalidate every connection in the workspace. Rights and levels are
different halves of a role and this is where the difference has a cost.

**Recompute affected users rather than workspaces.** More precise, and it is the
same mistake ADR-0099 already rejected for pages: `effectiveRole` answers "what
may this person do with this document" per open document, and working it out
again in SQL would be a second answer to that question.

**Leave it to the sweep, as ADR-0099 decided.** Defensible for a system role,
which nothing in the application can edit. Indefensible for a custom role, which
exists to be edited in a screen built for editing it — and for the group case,
which is one click in the groups screen.
