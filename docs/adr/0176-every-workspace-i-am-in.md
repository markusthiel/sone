# ADR-0176: Every workspace I am in

## Status

Accepted. Built. Widens ADR-0173 and ADR-0174; needs ADR-0175 underneath it.

## Context

> Das [[ Menü sucht allerdings nur im selben Workspace richtig? Kann man das
> ausweiten auf alle in denen ich bin?

It did, and only because that is the list the sidebar already had — not because
a page elsewhere is any less linkable. An address names a uuid and nothing else
(ADR-0016).

**ADR-0175 had to come first.** A link to a page in another workspace did not
open at all, so widening the picker without it would have been a picker offering
broken links.

## Decisions

### One list, fetched once

`/api/link-targets` returns every page this person may open across every
workspace they are in, and the picker filters it in memory.

What makes the picker feel like part of typing is that there is nothing between
`[[` and the list. A request per keystroke would put a network in the middle of
it and a debounce would put a pause there. So the list is fetched when a picker
first opens — not on every page — and kept for the session, in a module-level
cache rather than component state: what is being cached is an answer about the
*person*, not about the page they happen to be reading.

Nothing invalidates it. A page created in another workspace during this session
will not appear until a reload — the same trade the members list already makes
for the assignee picker, and the price of never pausing while somebody types.

**The cap is stated rather than hidden.** Two thousand rows, most recently
edited first, because that is what a cap should keep. Past it the list simply
ends; somebody with more pages than that would need the picker to become a
search, and pretending otherwise in the interface would be worse than the limit.

### This workspace first, and it needs no heading

The ordinary reference is to a page next door, so a list sorted purely by match
would let a page from a workspace nobody has opened in a month sit above the one
they meant.

The first group carries no name: *here* is where somebody already is, and a
heading over it states the obvious and pushes the first row down. The others are
named, because without the name three pages called *Protokoll* from three
workspaces are a list nobody can choose from — the problem the folder path
already solved inside one workspace and does not solve across them.

Other workspaces are ordered by name, so the list does not rearrange itself
between two keystrokes that matched the same rows.

### A row with no workspace on it is one of ours

`groupPages` takes no current-workspace id. The list this shell already held
**is** the current workspace, by construction — so nothing has to hand the
editor a workspace, and the share view does not have to invent one. `App.tsx`
already warns about that shape: *"passing a placeholder would be a lie the next
tab believes."*

### The backlinks widen with it

ADR-0174 scoped the projection to the source page's own workspace, on the
argument that the panel is about a workspace's own structure. **That argument
stopped holding the moment such links became ordinary**: a reference that exists
is one the target's readers should be able to see.

Nothing is disclosed by writing the row. What a reader is *told* is decided
where the list is read, by `visiblePagesCondition` — which asks about membership
first, so a source in a workspace somebody is not in is refused there. Two tests
hold exactly that: the row exists across the boundary, and the answer does not
cross it for an outsider.

Each row says which workspace it is in, **only when it is not this one**. Naming
the current workspace on every row would be noise; leaving it off the others
would make a click that changes which workspace you are in look like one that
does not.

## Consequences

**Nine tests on the picker's side**, over two exported functions — which pages
match, and how they are grouped. **Two more against the database**, and they are
the pair that matters: the row crossing the boundary, and the answer refusing to.

**One test changed rather than added.** `backlinks.db.test.ts` asserted that a
page in another workspace is *not* a backlink, and was right about the world it
was written in. Its replacement says the opposite and says why, next to the two
that hold the line that actually matters.

A share-link visitor is unaffected: the route needs a session, and the shell
passes the empty list on that path anyway (ADR-0173).

## Alternatives considered

**A search route, queried as somebody types.** It is what a workspace with a
hundred thousand pages needs, and it is a network round trip inside the gesture
of typing. Worth revisiting when the cap starts being hit; the shape of the
answer would not change.

**Fetch the other workspaces' pages eagerly at sign-in.** A request on every
load for a feature most pages never use.

**One flat list ranked purely by match.** Shorter, and it lets a page from
somewhere else displace the one next door — which is the common case losing to
the rare one.

**Leave the backlinks scoped to one workspace.** Then a reference made by the
new picker would be invisible from the page it refers to, which is a feature
disagreeing with itself.
