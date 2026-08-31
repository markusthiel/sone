# ADR-0038: A page can move to another workspace, and says what that costs

## Status

Accepted.

## Context

Entries can be moved within a workspace, by dragging or from the entry menu.
Asked: can they move to another workspace, and if not, can they at least be
copied?

Move is the right primitive, and copy is the larger job rather than the fallback —
which is the opposite of how the question was framed, and worth writing down.

## What a page is attached to

A page is not only its parent. Read from the schema rather than remembered:

- `pages.workspace_id`, `ancestor_ids` and `idx`, for the page and every
  descendant.
- `files.workspace_id`, or a file in a table cell stops resolving — that query is
  bounded to the workspace on purpose (ADR-0035).
- `collections`, `page_search` and `page_tags`, all workspace-scoped.
- `page_permissions` and `page_group_permissions`, which name **members and groups
  of the workspace being left**.
- `share_tokens`, scoped to a page in a workspace.
- `favourites` and `workspace_landing`, held per person.
- `page_relations`, which after a move can point across the boundary.
- Attribution, which names people the target workspace may not contain.

## Decisions

### Move, in one transaction, with the losses named first

The move is a single transaction: the subtree's `workspace_id` and `ancestor_ids`
are rewritten, it is placed at the target's root, and everything in the list above
is carried, dropped or severed. Half a move is not a state this application should
be able to be in.

### The confirmation counts what will be lost, and the move refuses nothing

Chosen over refusing while restrictions or share links exist. Refusing is stricter
and reads as tidier, but it makes the person guess what to clear and then do it
blind — and it is the interface saying "not like this" without saying what
"this" is.

So the dialog is a sentence per consequence, counted from the actual subtree
before anything happens: how many share links will be revoked, how many pages will
lose a restriction, how many references will be severed, how many favourites will
be dropped. Then the button.

The counts are read in the same transaction that performs the move, so what was
shown is what happens — a preview computed from a separate read is a preview that
can be wrong by the time it is confirmed.

### Restrictions are dropped, not translated

`page_permissions` names users and `page_group_permissions` names groups. A user
may not be a member of the target; a group certainly does not exist there. There is
no honest translation, and inventing one — matching groups by name, say — would
silently grant access on a guess.

So a restricted page arrives **unrestricted**, and that is the single most important
line in the confirmation. A restriction that survived a move as something
approximate would be worse than one that is visibly gone.

### Share links are revoked

A share token grants access to a page. Leaving one alive across a move would mean
a link handed out by one workspace continuing to serve a page that now belongs to
another — a hole with no way to notice it. Revoked, and counted.

### Relations across the boundary are severed, not left dangling

To be precise about what a relation is here: `page_relations` is a collection's
relation *column* pointing at a page. It is not a link written in prose — that
lives inside the document and is nobody's row.

A relation from a moved page to one left behind would point into a workspace the
reader may not see, so rows crossing the boundary are deleted, in both directions.
Rows wholly inside the subtree are untouched.

A link written in text is left exactly as it was: it is somebody's writing, and
editing prose to keep a database tidy is not this application's business. Such a
link resolves to nothing for a reader without access, which is what any link to
something they cannot see already does.

### Attribution stays

It records who wrote what, which remains true after a move. It may name people the
target workspace does not contain, and that is a fact about the history rather than
a leak: attribution is a name and a client id, not access.

### The mover needs rights in both places

Edit in the source — the same right the existing move requires — and owner or
administrator in the target. Anything less would be a way to push content into a
workspace where you have no standing, and a workspace's owners would find pages
they did not put there.

The target list therefore only contains workspaces the person may write to, which
also makes the common case one where nothing can go wrong.

### A folder lands at the root; a page lands in a folder

Found while testing, and the schema is right about it: a page must have a folder
for a parent (0003), because a page at the root of a workspace is the arrangement
0.2.0 had and dropped.

So a folder becomes a root of the target, and a page goes into the target's first
root folder — and the response says which, because "it moved" without "to where" is
not something somebody can act on. If the target has no folder at all, the move is
refused with that as the reason rather than the constraint failing underneath.

Not a folder chosen in the dialog. That would mean showing another workspace's
whole tree inside this decision, and the entry can be dragged where it belongs the
moment it arrives.

### Only a top-level entry moves

A collection row cannot be moved out on its own — it belongs to its collection —
and neither can a page inside a protected section, whose whole point is that its
location carries a permission. Both are refused with a reason rather than hidden.

## Consequences

`files.workspace_id` moving means storage keys do not change: they are content
addresses, and the bytes are not touched. A move is metadata only, however large
the subtree.

The tree cannot be dragged into another workspace — there is nothing to drag onto
— so this lives in the entry menu, which is where "Move up", "Move down" and
"Move to…" already are.

Copy is **not** built here, and the reasoning is recorded so the next person does
not read this as an oversight: every page in the subtree needs a new id, every
internal reference in every document has to be rewritten or the copy points back
at the original, and each file needs a new row. It is a bigger change than the
move, and the thing people usually want it for is templates — which is its own
feature, and should not arrive through the back door of a workspace change.

## Alternatives considered

**Refuse while restrictions or share links exist.** Rejected above: it withholds
the reason at the moment it matters.

**Copy instead of move**, as offered in the question. Rejected as a substitute: it
is more work and it leaves two divergent copies, which is the problem the person
asking has not got yet.

**Translate restrictions by matching group names.** Rejected: a permission decided
by a string match is a permission granted on a guess.

**Keep share links alive.** Rejected: a link that outlives the workspace boundary
it was issued under cannot be reasoned about by either workspace's owners.
