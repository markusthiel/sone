# ADR-0073: Access is not an invitation

## Status

Accepted. Amends ADR-0025, which gave a workspace an invitation form of its own.

## Context

A workspace had an **Einladungen** section that made a link, optionally bound to
an address, which let whoever opened it join that workspace — creating an
account on the server if they did not have one.

That form was doing two jobs, and they belong to different people.

Making an **account** is the instance's business: it decides who exists on this
server at all, which is why the administration has an invitation section and why
sign-up mode is an instance setting (ADR-0032). A workspace owner could bypass
all of it — one form in one workspace's settings, and a stranger has an account.

Deciding who may work **in a workspace** is the owner's business, and it is a
question about people who already exist. That is the question actually being
asked most of the time: a colleague is on the server, in their own workspace,
and should now see this one too.

Because one form answered both, the second question had no answer at all.
`PUT /api/workspaces/:id/members/:userId` changes an existing member's role and
refuses somebody who is not one — there was no way to add a person who already
had an account except to send them a link and have them accept it.

## Decision

**A workspace gives access; the instance invites.**

`POST /api/workspaces/:workspaceId/members` takes an address and a role and adds
that account to the workspace. Owners and admins only, like every other change
to who is here: a member who could add people could add somebody with more
rights than themselves.

**By address, not from a picker.** A list of every account on the server would
make every workspace owner a reader of the instance's directory, which the
administration keeps on purpose. An owner adding a colleague knows their
address.

**"No such account" is said plainly.** The alternative — one answer for a typo
and for a success — leaves an owner unable to tell which happened. The people
who may ask this question are already trusted with who is in the workspace, so
the oracle it creates is bounded by a right that already exists.

**Adding is not promoting.** Somebody who is already a member is refused rather
than silently having their role changed; the role control in the same table does
that job, deliberately.

**Owner is not on offer.** A second owner is a decision about who may delete the
workspace. It stays a separate act on the row.

The workspace's invitation section is gone, and so is the route that made new
ones. `GET` and `DELETE` on `/api/workspaces/:id/invitations` stay: an
invitation sent last week is still a way in, and something that cannot be seen
cannot be withdrawn. The outstanding list moved into **Leute**, where it draws
nothing when there is nothing outstanding.

## The rights, checked

The question that came with this was whether the group rights work — whether
somebody besides the owner can see and edit another workspace with them. They
do, and the path is:

1. **Access** puts the person in the workspace with a role. `guest` grants
   nothing by itself, which is what makes it the right role for "only what I
   give them".
2. **A group** is a named list of people, per workspace. A group may only hold
   people who are already in the workspace — otherwise somebody reaches pages
   through a grant while appearing in no list of who is here.
3. **A grant** gives a group a role on a page, and it inherits down the subtree
   like any other grant (ADR-0026). The more permissive of a personal grant and
   a group grant wins, so joining a group never demotes anybody.
4. Leaving the group takes the access with it and leaves the membership alone;
   losing access to the workspace takes the group memberships with it.

Each of those four had tests of its own and the path between them had none, so
it now has one: `workspaceAccess.db.test.ts` walks it end to end through the
routes. Nothing was found broken — the joins hold — but the coverage was in
pieces, which is how a working system quietly stops working.

## Consequences

A person new to the server takes two steps instead of one: an instance
invitation makes their account, and then an owner gives them access. That is one
step more than the old link, and it is the honest number — the old single step
was a workspace owner making an account on somebody else's server.

`WorkspaceInvite` is deleted, along with `inviteToWorkspace` and six message
keys. The workspace's sections drop from seven to six.

Two English leftovers went with it: the role dropdown in the members table
listed the raw ids (`owner`, `admin`, `member`, `guest`) in a German table, and
the row's label was built as `Role for ${name}`.
