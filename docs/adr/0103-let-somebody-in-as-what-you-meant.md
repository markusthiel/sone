# ADR-0103: Letting somebody in as what you meant

## Status

Accepted. Built. The open point ADR-0102 added, checked before being acted on —
and it was wrong, which is the third round running that a note in that list has
described something other than the code.

## Context

ADR-0102 closed with a new open point, written by me the day before:

> **Offen:** eine Einladung kann keine **eigene Rolle** anbieten —
> `invitations.role` ist eines der vier Wörter, es gibt keine Spalte und keinen
> Bildschirm dafür. Ein Feature mit Oberfläche, keine Aufräumarbeit.

Every clause about the schema is true. The conclusion is not, because **nothing
creates a workspace-scoped invitation.** `POST /api/admin/invitations` is the
only route that makes one and it passes `workspaceId: null` unconditionally. So
`invitations.role` is written as `'member'`, always, on rows that name no
workspace and where a role means nothing — which the schema has said since
migration 0018:

```sql
CHECK (workspace_id IS NOT NULL OR role = 'member')
```

That is deliberate. ADR-0073 decided it:

> A workspace gives access; the instance invites. […] The workspace's invitation
> section is gone, and so is the route that made new ones. `GET` and `DELETE` on
> `/api/workspaces/:id/invitations` stay: an invitation sent last week is still a
> way in, and something that cannot be seen cannot be withdrawn.

So the empty listing in **Leute** is a drain for invitations issued before
ADR-0073, not an oversight, and building an invitation that names a custom role
would be reopening a decision rather than finishing one. I wrote that open point
from reading the schema instead of checking the reach — the exact mistake
ADR-0101 and ADR-0102 are both about, made by the person who wrote both of them.

## Where the request actually lands

Under ADR-0073, the act that puts a role on somebody entering a workspace is
**giving access**. Three routes name a role, and until now one of them spoke a
third of the vocabulary:

| act | route | names a custom role |
|---|---|---|
| change a member's role | `PUT …/members/:userId` | ✓ `{roleId}` |
| what a group carries | `PUT …/groups/:id/role` | ✓ `{roleId}` |
| **give access** | `POST …/members` | ✗ `'admin' \| 'member' \| 'guest'` |

And it did not refuse an unrecognised value; it fell back to `member`.

**The consequence is not a missing convenience.** To let a colleague in as
"Redaktion" you added them as a member and changed it afterwards. A member holds
`editor` on every page in the workspace. So giving somebody a read-only role
began by granting them write access to everything — as a required step, for as
long as it took to make the second request, and indefinitely if it failed or the
tab closed in between. In a rights model whose entire subject is not doing that.

### The screen already knew

`WorkspaceMembers` fetches every role the workspace has, and the picker in the
table lists them by id, under a comment quoting ADR-0087: *"a role somebody
defined is no less a role."* Ten lines above, the form offered a hardcoded three.

The reason is written in the component:

> Failing quietly to an empty list: reading them needs `roles.manage`, and
> somebody may look after people without defining what roles mean.

It does not need `roles.manage`. `GET …/roles` takes `requireAnyRight` over
`roles.manage` **or** `people.manage` — one route rather than two, for exactly
this reason, and `people.manage` is what puts anybody on this screen at all.
The comment describes the route before ADR-0087's third step, and a form was
built around it.

**Third stale comment in three ADRs.** ADR-0089's copied "the listing already
excluded it", ADR-0102's "nothing reads it", and now this. All three were true
once, all three were load-bearing, and none of them was re-read when the thing
they described changed.

## Decisions

### One resolver, used by both routes

`chooseRole` takes the request body and answers with the role row, accepting
`{role}` or `{roleId}` and refusing both together. It is what the `PUT` route
already did, lifted out and called from the `POST` as well.

Not tidiness: two routes answering "which role is this" separately is the shape
ADR-0086 is about, and it is how one of them ends up with a condition the other
lacks — which is precisely the state this ADR found them in.

### The fallback is gone with the three words

An unrecognised role is refused rather than quietly becoming `member`. The same
argument the roles screen makes about an unknown right (ADR-0087): a request
that asked for one thing and silently got another is how a permission comes to
half-work. And the value it silently became was the one that grants the most.

### Owner is refused by name

ADR-0073 kept owner off this form because "a second owner is a decision about
who may delete the workspace". It was absent by *omission* — it simply was not
in a list of three. Accepting an id would have been a second door into the same
room, opened by this change and named by nothing.

So both routes to it are refused explicitly, on the server and in the picker,
and both have a test. An absence that a short list used to guarantee needs an
assertion the moment the list comes from the server.

### The picker offers what the table offers

The same list, minus owner. The three words remain as a fallback for a roles
fetch that genuinely failed — a form whose job is to add somebody must still be
able to add somebody — and the request then sends a word, because there is no id
to send.

## Consequences

**Thirteen tests, eleven failing before the change** — eight on the server, five
in the browser, of which two server tests and two browser tests are the
counterweights: one of the four words still works, the default is still
`member`, owner is still refused, and a failed fetch still leaves a usable form.

**The invitation is untouched, deliberately.** `invitations.role`, the empty
workspace listing and its role column stay as ADR-0073 left them. A row written
before ADR-0073 still names a role and is still honoured on acceptance; that is
what the column is for now, and removing it would break the one case ADR-0073
kept the listing for.

**Two more source-text assertions moved**, making four and five. One asserted
the source read `api.addMember(workspaceId, { email: address, role })`; one read
the hardcoded list and asserted `'owner'` was not in it. Both broke on a change
that made their subject stronger, and both are now rendered-picker assertions in
`giveAccess.test.tsx`. The second is the clearer case: it could only ever prove
that a short list was short, and the property it was standing in for — that this
screen does not offer ownership — became real only once the list stopped being
short.

**An open point was wrong in a new direction.** ADR-0101 found one that was
already done; ADR-0102 found one whose reason was false. This one described a
feature for a path that ADR-0073 had deliberately closed. The list is still
worth keeping — it is what produced three rounds of work — but a note in it is a
question to check, never a description to act on.

## Alternatives considered

**Build a workspace invitation that names a custom role**, which is what the
open point literally asked for. It reopens ADR-0073: a workspace owner creating
an invitation is a workspace owner creating an account on the instance, and
splitting those two was the whole decision. If the underlying need is "let in
somebody who has no account yet", that is one ADR-0073 named and left with the
instance, and it deserves its own argument rather than arriving as a role picker.

**Remove `invitations.role` and the empty listing.** It looks like dead code and
it is not: ADR-0073 kept the listing so an invitation sent before it can still be
seen and withdrawn, and such a row names a real role. Reading that ADR is what
stopped this change from deleting a drain somebody deliberately left open.

**Have the form send `{role}` for system roles and `{roleId}` for custom ones.**
Half a spelling each, decided by which kind was picked. The picker holds ids
because the table's does; sending what it holds is one rule.

**Accept the id and keep the `member` fallback for anything unrecognised.**
Smaller diff, and it preserves the behaviour where the most-granting role is
what a malformed request produces.
