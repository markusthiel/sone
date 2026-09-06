# ADR-0102: A column nothing read

## Status

Accepted. Built. The fifth open point in `claude/rechte-und-zugriff.md`, checked
before being acted on — which is what ADR-0101 said to start doing, and the
first time it paid.

## Context

ADR-0087 made a role a row. `workspace_members.role`, the four-word enum, was
superseded by `role_id` and `is_owner`, and migration 0058 wrote its epitaph
into the database:

```sql
COMMENT ON COLUMN workspace_members.role IS
  'Superseded by role_id and is_owner (ADR-0087). Nothing reads it: what it
   said is now the role row it points at, and ownership is its own column.
   Kept so a rollback does not lose the mapping; dropped in a later migration.'
```

The same sentence went into the ADR, into the open-points list, and into a code
comment in `invitationRoutes.ts` that went further: *"the column is only read by
a server that predates roles being rows."*

**Four copies of a claim that was false when it was written.**
`GET /api/auth/session` and `GET /api/workspaces` both selected `m.role` — both
of them older than the migration that declared them gone.

This is the same shape as ADR-0089's copied comment, which held six holes open
by explaining why a check was unnecessary at seven places where its premise held
at one. A comment that justifies why something is safe is load-bearing, and this
one was copied from a migration into an ADR into a list into a route.

## What the word was doing

Both listings handed it to the browser, where three places used it:

| | decided | on the enum word |
|---|---|---|
| `WorkspaceSettingsScreen` | whether every control is disabled | `role === 'owner' \|\| 'admin'` |
| `MoveToWorkspaceDialog` | which workspaces are offered | the same comparison |
| `Settings` | what it tells you your role is | printed it |

And assigning a **custom role** writes `member` into that column — the write
path says so in a comment, because the four-word vocabulary cannot name a custom
role and `member` is "the nearest of the four words, and the safe direction to
be wrong in, since the column is only read by a server that predates roles being
rows."

So somebody holding `workspace.settings` through a custom role opened the
workspace settings, found every input disabled, and was told they were a member.
The route would have accepted every one of those saves.

`WorkspaceSettingsScreen` already carried a comment about finding exactly this
fault once (ADR-0067): the screen was stricter than the route for an instance
administrator. That half was fixed. The half where the *rule itself* was the
wrong rule was not, and it could not be found the same way, because a disabled
control produces no failure to read.

### The invitation nobody could withdraw

Removing the column turned up one more. Four routes in `invitationRoutes.ts` ask
for the `people.manage` right. The fifth — withdrawing an invitation — kept a
hand-written `role IN ('owner','admin')`, defended by a comment about SQL:

> Left as its own statement, not `roleIn`: this asks whether somebody is one of
> two roles, which is a different question from which role they are — and it
> answers it in the database rather than fetching a value to compare in
> JavaScript.

Every word true, and none of it about the question being asked. Somebody holding
`people.manage` through a custom role or a group could create an invitation and
not withdraw it.

## The finding underneath: what the tests were testing

`seedWorkspace` wrote memberships as `(workspace_id, user_id, role)` — the enum
column alone, no `role_id`, no `is_owner`. So did thirty other fixtures across
the suite, and the client package's harness.

Production has written `role_id` since ADR-0087. **Every one of those rows was a
shape the running server never produces**, and every access assertion built on
them was resolved through the compatibility bridge in `loadWorkspaceStanding`
rather than through the path under test.

The bridge was justified as a rolling-deploy safety net. It was in fact holding
up a third of the suite, and nobody could see it, because it answered correctly.

It cost one real test. `replies.db.test.ts` demotes somebody to guest to prove
the mail path refuses them — by writing the enum word. With the fixture fixed
and the word ignored, the demotion did nothing and the guest posted. That test
has been passing since it was written, against a demotion the running server
never performs.

This is ADR-0099's lesson from the other end. There, three tests supplied the
missing link themselves: *a test that completes the chain by hand is testing a
chain that does not exist.* Here: **a fixture that writes a shape production
never writes is testing a shape production never has.**

## Decisions

### The listings send the standing, not the word

Both carry `role` (the key, or `'custom'`), `roleName`, `rights`, and `isOwner`,
from one SQL fragment shared between them — for the reason `WORKSPACE_ORDER_SQL`
is shared: the two listings must agree, and the half that was not shared is the
half that drifted.

The rights are the **union** with every group's, exactly as the loader computes
them (ADR-0026). A listing that reported only the membership's own role would
understate whoever holds a right through a group, which is the same fault in a
new place. The role *name* is deliberately not unioned: "your role" means the
one on your membership.

This is ADR-0095 one layer out. There, the tree route computed a role per entry,
used it as a filter, and threw it away. Here, the server knows the standing and
sent a word instead. **Fourth time in this repository that a value was computed,
used for a decision, and discarded.**

### The browser asks for a right

`mayEditWorkspace` in `workspaceRights.ts`, beside `entryRights.ts` and for the
same reason: not a second place for rights, a second *reading* of the answer the
server sent. Every write is still refused by the route that receives it.

### A membership must point at a role

The bridges go, and the state they rescued becomes impossible: `role_id` is
`NOT NULL`, after a backfill that re-runs 0058's.

A constraint rather than a convention, because the previous arrangement was a
convention and thirty fixtures broke it for four ADRs without anybody noticing.
`addMember` in the test support is the other half — one function, so the next
fixture cannot get it wrong by hand.

### The enum type stays

`invitations.role` still uses it, still means one of the four words, and is read
on every acceptance. An invitation cannot offer a custom role — no screen, no
column — so the type is carrying a real meaning there. There is a test asserting
the type survives, so that "the enum is gone" cannot be read off this change as
more than it is.

## Consequences

**Eight new tests, five failing before the change.** The three that passed are
the counterweights — an owner still answers `owner`, still reaches a restricted
page, and the type is still there — which are the assertions that would catch a
cleanup going too far.

**Two flaky things fell out of the fixture change, and both were real.** An
absence assertion in `sharesPush` counted every frame the connection ever saw,
including a nudge the fixture itself set off, which landed either side of the
AuthAck depending on timing; `TestClient.forget()` gives it a mark to count
from. And `resetDatabase` truncated tables in whatever order `string_agg`
returned, against a live sync server reading `workspace_members` then `roles` —
two lock orders that eventually crossed. Neither was caused by this change; both
were made likelier by it, which is how they were seen at all.

**A third source-text assertion moved.** `scale.test.ts` asserted that
`WorkspaceSettingsScreen` contains `const canEdit = … || manages;`. The rule is
now a call to a module, so the assertion broke while its subject got stronger.
ADR-0095 moved two of these for the same reason; the behaviour lives in
`workspaceRights.test.ts` now.

**One route's answer changed on purpose.** Withdrawing an invitation as somebody
outside the workspace answers 404 rather than 403 — `mayAdminister`'s deliberate
choice, since "you may not withdraw this" confirms it exists. Its four siblings
have always answered that way.

**A guard narrowed rather than died.** `loadWorkspaceStanding` still throws
"the system roles are missing from this database" — but with `NOT NULL` and a
foreign key, reaching it needs broken referential integrity, which is what a
partial restore is. Its test now simulates that by dropping the constraint for
the length of the assertion, which is more honest than what it did before.

**The open-points list was right for the wrong reason.** It said the column
"is read by nothing" and it should be dropped. It should be dropped, and it was
read by two routes, a browser screen, a dialog, thirty fixtures and two
compatibility bridges. ADR-0101 said an unchecked list describes a codebase that
no longer exists; this one described a codebase that never did.

## Alternatives considered

**Drop the column and leave the two listings selecting a role word from the role
row.** One line each, and it keeps a browser deciding permissions from a word
while the routes decide from rights — the fault, preserved through the cleanup
that was looking straight at it.

**Send `pageLevel` too.** The listing would then carry everything the loader
knows. Nothing in the browser asks what a workspace's default page level is —
the tree says what each entry allows (ADR-0095) — and a field nobody reads is
the next thing somebody decides from.

**Keep the bridges.** They are eleven lines and they work. They also make the
`NOT NULL` impossible, which means the fixtures could go back to writing the
old shape and nothing would say so.

**Fix `seedWorkspace` and leave the other thirty inserts.** They would have kept
working — the bridge would have caught them — which is the whole problem.
Removing the column is what makes the shape unwritable, and that is worth more
than the diff it costs.

**Drop the `workspace_role` type as well.** It would mean deciding whether an
invitation can name a custom role. That is a feature with a screen attached, not
a cleanup, and it is on the list now.
