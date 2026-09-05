# ADR-0026: Permissions live on pages, and only where they can be enforced

## Status

Accepted and implemented.

## Context

ADR-0025 settled where people are: everybody has their own workspace, and
invitations to the instance and to a workspace are separate. It deferred groups
and noted that page-level permissions would be a reason to revisit its shape.

They are now asked for, together with permissions on an individual container of
content within a page.

## The constraint that decides everything here

SONE synchronises a page as a **CRDT document**. A client receives the whole
document because merging changes requires it. A block the interface declines to
draw is still in the browser's memory.

So a permission on part of a document is a **display convention, not access
control**. Anybody with developer tools reads the hidden paragraph. For a notes
application that is worse than not having the feature: it is a lock on a door
that is not a lock, and somebody will put something private behind it.

This is not a reason to refuse container permissions. It is a reason to build
them as the only shape that can enforce them.

## Decisions

### A page is the unit of enforcement

A page is already its own document, and the server either serves it or does not.
That makes page permissions real without changing how synchronisation works —
an extension rather than a rebuild.

Permissions are therefore attached to pages, and the workspace role becomes the
default rather than the whole answer.

### Access is inherited, and inheritance is the common case

A page without its own rules follows its parent, up to the workspace. Setting
rules on one page in a tree of two hundred should not mean setting them on two
hundred.

A page with its own rules stops inheriting for the people it names, and keeps
inheriting for everybody else. The alternative — an explicit rule replacing all
inherited access — makes every restriction an act of removing people nobody
remembers granting.

> **Corrected by ADR-0089 (2026-09-05), in one direction only.** Inheritance
> still runs downwards exactly as described. What changed is what a *restricted*
> page does to it: a restriction stops inherited access at its own edge, so a
> subtree grant made **above** a restricted page no longer reaches it. A grant
> made **on** it, or below it, still does — which is the sentence above,
> unchanged, for the pages the grant was actually made about.
>
> The old rule was read out of this section honestly and turned out to fail
> precisely where restriction is used: against the people who already hold the
> folder above.

### Three levels, and no more for now

**Manage** (change permissions and the page itself), **edit**, **view**.

Comment-only is deliberately absent until comments exist as a first-class thing;
a level that differs from another only in a feature nobody has yet is a level
nobody can explain.

### Groups name who, never what

> **See ADR-0087 (proposed, 2026-09-05).** This heading is the one part of this
> record that a later decision argues with. The reasoning below survives intact —
> a group is still a list of people, and the more permissive of a direct and a
> group grant still wins. What ADR-0087 adds is a **role**, which does name what,
> and which a group can hold. The argument this section did not make is about
> everything that is not a page: who may add people, make groups, change the
> workspace's typography, export it. Those are eight independent questions, and
> today they are all answered by one comparison against `owner` or `admin`.

A group is a list of people. It is granted access exactly as a person is, and it
exists because granting page by page and person by person stops working at
around ten people — which is what both Outline and Docmost say in their own
documentation, and why both added groups after their permission model rather
than as part of it.

Where somebody has access both directly and through a group, **the more
permissive wins**. Both compared systems resolve it that way, and the reason is
that the alternative makes adding somebody to a group able to silently *reduce*
what they could already do.

### A container permission is a separate document, or it is a lie

A protected container within a page is its own CRDT document, embedded by
reference. The server serves it to those allowed and not to anybody else, so the
protection is the same mechanism that protects a page — the only one here that
is real.

This is the pattern SONE already uses for collection rows (ADR-0021), so it is a
known shape rather than a new one.

**Rejected: filtering updates server-side.** Removing protected parts from the
synchronisation stream sounds simpler and is not. The server would have to
inspect every change and accept it partially, which breaks the merge guarantee
Yjs provides — and a CRDT that no longer converges fails quietly, as divergence
between two people who each believe they are looking at the document.

### Order of building

Page permissions first, because they are enforceable today and most of what was
asked for. Groups second, because they multiply the value of the first and
depend on nothing else. Container permissions third, as embedded documents.

Building them together would mean settling how a container is addressed while
the rules that govern it are still moving.

## Consequences

The page tree becomes a filtered view: a page somebody cannot see is absent
rather than shown and refused, and a page they cannot see with children they can
still has to appear as a path to them.

Search, favourites, the tasks panel and every list of pages need the same filter.
That is the part most likely to leak — a title in a search result is a
disclosure, however carefully the page itself is protected.

Sharing links (ADR-0018) are a second grant path and must not become a way round
this: a share link on a page somebody cannot manage should not be creatable.

**ADR-0025 should be re-read in light of this.** Its argument for personal
workspaces partly rested on permissions living at the workspace boundary. With
rules on pages, that boundary matters less, and the case for a personal
workspace is now simply that a notes application owes somebody a place of their
own — which is a better argument than the one it was resting on.

## Alternatives considered

**Permissions only at the workspace, with more workspaces.** What SONE does
today. Rejected as asked: it means a workspace per audience, and people belong
to more audiences than they want workspaces.

**Block-level permissions inside one document.** Rejected above: unenforceable
with a CRDT, and dangerous because it looks like it works.

**Copying Docmost's spaces layer** — workspace → space → page, permissions on
the space. Reasonable, and rejected in ADR-0025 for the cost of adding a level
to every existing concept. Page permissions with inheritance give the same
result for a tree of pages without the extra layer.
