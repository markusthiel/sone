# ADR-0019: Folders are a distinct kind, and they have documents

- **Status:** Accepted
- **Date:** 2026-08-27
- **Relates to:** ADR-0002 (CRDTs are truth), ADR-0006 (capability-based access)

## Context

Until now a page was both content and container: any page could hold subpages,
as in Notion. Requested instead: real folders, as Craft has them — a folder
organises, a page holds writing, and the two are different things.

The argument for it is structural clarity. When anything can contain anything,
a sidebar becomes a pile in which "where does this go" has no answer, and people
end up with documents nested four deep inside other documents they never open.
Craft's separation removes that question, and the sidebar reads as a filing
system rather than an outline.

The cost is flexibility. A page can no longer become a container later; moving
notes under a document means creating a folder and moving both. That is a real
loss and it is the trade being accepted.

## The problem this exposes

The obvious implementation is a `folders` table. It is the wrong one, for two
reasons.

**Authorisation.** Share links, page permissions and subtree grants all work on
the `pages` tree through `ancestor_ids` (ADR-0006). A second tree would need all
of that duplicated, and a subtly different copy of an access-control rule is how
data leaks. One tree, one containment check.

**Rebuildability.** ADR-0002 says Postgres is a projection that can be
discarded and rebuilt from the CRDTs. A folder existing only as a Postgres row
breaks that: rebuilding would restore every page and lose the structure holding
them. The projection would no longer be derivable, and the guarantee that made
CRDTs worth the complexity would be gone.

## Decision

**A folder is a document, like a page, with `kind: 'folder'` in its meta.**

`pages.kind` is projected from that document, and `parent_page_id` continues to
express containment for both kinds. So:

- one tree, one ordering, one `ancestor_ids`, one permission model;
- folders are rebuildable from the CRDT log like everything else;
- renaming a folder is a CRDT edit, so it syncs live to other clients without
  any new plumbing.

A folder's document simply has no `content` fragment in use. The cost is one
mostly-empty Y.Doc per folder, which is a few hundred bytes.

An absent `kind` reads as `'page'`, so every document written before this
decision is a page without needing migration.

### The containment rule

A folder may contain folders and pages. **A page may contain nothing.**

Enforced in the HTTP API, where a person acts and can be told why. *Not*
enforced as a database constraint, following ADR-0003's migration 0003: CRDT
updates arrive out of order, so a child can materialise before its parent
exists, and a constraint would reject legitimate data. A `pages_inside_pages`
view reports violations for the maintenance job to surface, the same way
`orphaned_pages` already does.

Two enforcement points with different jobs: the API refuses to create the
situation, and the view notices if it exists anyway.

## Consequences

Creating a page requires choosing a folder, or accepting the workspace root.
That is the point — the structure is decided when the thing is made rather than
drifting.

Converting between kinds is possible in principle (a page with no children could
become a folder) but is not offered. A folder that becomes a page would have to
do something with its children, and every answer to that is a surprise.

The sidebar can now show folders and pages differently, and only folders offer
"new inside this". That is the visible benefit and the reason for the change.

`SCHEMA_VERSION` stays at 1. Adding an optional meta key that defaults to the
existing behaviour is not a format change: an older client reading a folder sees
a page with no content, which renders harmlessly rather than breaking.

## Alternatives considered

**A separate `folders` table.** Rejected on the two grounds above: a duplicated
authorisation path, and folders that cannot be rebuilt from the CRDTs.

**Presentation only** — draw a page with subpages as a folder, change nothing
underneath. Cheap and reversible, and it was what I proposed first. Rejected
because it does not deliver what was asked for: a page holding both text and
subpages would still exist, and the structural clarity that motivates folders
comes precisely from that being impossible.

**Folders without documents, accepting the projection is no longer fully
rebuildable.** Rejected. That guarantee is why the CRDT complexity is worth
carrying; spending it on saving a few hundred bytes per folder would be a poor
trade, and the kind of erosion that is only noticed when a rebuild is actually
needed.
