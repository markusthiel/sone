# ADR-0031: The order of the switcher is the person's own

## Status

Accepted and implemented.

## Context

The switcher lists the workspaces somebody belongs to, sorted by name. Requested:
drag them into the order that person wants, and keep it.

Sorting by name is not wrong so much as not anybody's. Somebody who works in one
workspace daily and three occasionally wants the daily one first; the alphabet
has no opinion about that. Five words in a fixed order still have to be read
through every time.

The obvious move is to do what folders do, and that is the decision worth
writing down, because it is the wrong one.

## The distinction this turns on

Folder order lives in the CRDT: `idx` on the page document, projected to
`pages.idx`, ordered by `(idx, id)` (ADR-0002, ADR-0015). It belongs there
because the tree belongs to the workspace — everybody sees one order, and it has
to be rebuildable from the log like everything else in the projection.

A workspace order belongs to one person. There is no shared object it could be a
property of: the list itself does not exist anywhere except per member, since two
members of the same workspace have different lists. Storing my order inside a
workspace document would also mean synchronising it to everybody who reads that
workspace, which is both a privacy leak and an editing conflict over something
nobody else can see the point of.

That argument is already made in this codebase, for favourites: a favourite is a
property of a person's relationship to a page, so it is instance data in Postgres
rather than part of any document, and ADR-0002's guarantee is untouched because
the projection is still derivable — favourites are simply not part of it. The
same reasoning applies here word for word.

So: the same fractional-index machinery as folders, in the same place as
favourites.

## Decisions

### The key lives on the membership row

`workspace_members` gains `idx text`. The membership row is precisely "this
person, this workspace", which is what the order is about. Not a new table,
because a table whose primary key would be `(workspace_id, user_id)` already
exists.

A fractional index rather than an integer position, for the reason it is used
everywhere else here: placing one row touches one row. Two browsers reordering
the same list at once produce keys that both survive, and nobody's list is
renumbered underneath them.

### The column is nullable, and there is no backfill

Six places create a membership today — four in registration, one in workspace
creation, one in migration 0017 — and there will be more. With `NOT NULL`, every
one of them has to generate a key, and the seventh, written a year from now by
somebody who has not read this file, fails at insert. That failure lands on the
signup path.

Nullable inverts it: no insert site changes, and forgetting has no consequence
worth a name. A membership without a key has simply never been placed.

Ordering is therefore: placed ones first, in key order; then the rest by name.

```
ORDER BY (m.idx IS NULL), m.idx, w.name COLLATE "und-x-icu"
```

A workspace joined after somebody has arranged their list appears at the bottom,
which is where a new thing belongs and is also where they will look for it.

### The first drag places the whole list

A list with no keys cannot be reordered one row at a time: there is nothing to
place a key between, and the result would be one workspace with a key and the
rest still alphabetical — an order that reads as the drag having moved the wrong
thing.

So the reorder endpoint, in one transaction, writes keys for every membership
that lacks one in the order the person is currently looking at, and then places
the moved one. After the first drag every row the person can see has a key, and
every later drag is a single-row update.

### One sort expression, not two

`/api/workspaces` and `/api/auth/session` both list a person's workspaces, and
after this they must agree: `useSession` falls back to `workspaces[0]` when no
workspace is remembered, so the order also decides which workspace a fresh
browser opens. Two copies of the clause is one copy drifting later, so it is
exported from one module and both read it.

That the first entry becomes the default workspace is a consequence rather than
a feature, and a welcome one: dragging the workspace you live in to the top makes
it the one you land in.

### The gesture is the one that already exists

`usePointerDrag` holds everything that was hard to get right — hold versus scroll
on touch, when pointer capture is taken, swallowing the click that follows a
drag. `useTreeDrag` sits on it but is the tree's own rules, including a
document-wide `[data-tree-row]` lookup that the switcher would collide with.

A sibling hook, `useListDrag`, for a flat list scoped to one container: before or
after a row, no "into", no nesting boundaries. Written as a second consumer of
the gesture hook rather than a generalisation of the tree's, because a shared
"drag anything" abstraction would have to know about both and would be edited
whenever either changed.

## Consequences

The switcher is now the only place where a person's own ordering is expressed, so
it is the place to look when the same is wanted elsewhere — the favourites list
being the obvious next one, since it has had a `/reorder` endpoint since it was
written and no way to reach it.

Reordering is a drag and nothing else. The tree at least offers "move up" and
"move down" in the entry menu, so somebody on a keyboard can reorder it; the
switcher will have no equivalent. That is a real gap and it is being accepted for
now rather than answered by putting a menu on each row of a panel that is already
tight. If it is answered later, `⌥↑`/`⌥↓` while the panel is open is the shape to
reach for, because it needs no space.

The order is per person and per instance — it is not in the CRDTs, so it does not
travel with an export of a workspace, and restoring a workspace into a different
instance loses it. That is correct: it describes a person's habits, not the
workspace.

## Alternatives considered

**An array of workspace ids on `users`.** One column, one update, no per-insert
bookkeeping, and unknown workspaces fall to the end for free. Rejected on
concurrency and on consistency: two tabs writing the array each overwrite the
other's edit wholesale, where fractional indices merge; and this project has
answered "how is a list ordered" twice already, so a third answer would mean
three mechanisms and a question every time about which applies.

**An integer position, renumbered on every move.** Rejected for the reason
ADR-0015 gives: it makes every reorder a write to every row, and two concurrent
reorders produce a list neither person asked for.

**Sort by most recently used instead.** Genuinely attractive, and it needs no
gesture at all. Rejected because a list that reorders itself cannot be learnt:
the position of a workspace is then a fact about last week rather than a place,
and the switcher stops being somewhere you can aim. Worth revisiting as an
optional sort, never as the only one.

**Pinning instead of ordering** — mark favourites, leave the rest alphabetical.
Cheaper and reversible. Rejected because it answers a smaller question: with five
workspaces the request is an order, not a top group, and a pin would have to be
explained as "a different kind of first".
