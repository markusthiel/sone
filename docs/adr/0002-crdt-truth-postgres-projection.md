# ADR-0002: CRDTs are the truth, Postgres is a rebuildable projection

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

SONE needs real-time multi-user editing, offline editing, and server-side
querying for database views and search. These pull in opposite directions:
collaborative editing wants CRDTs, querying wants relational tables.

Getting this boundary wrong is not recoverable. Once users have documents in
the field, a CRDT format migration is brutal.

## Decision

Each page is a Yjs document. Its update stream in `doc_updates`, compacted
into `doc_snapshots`, is the only authoritative representation.

Everything else in Postgres — `pages`, `blocks`, `collections`,
`page_properties`, `page_relations`, `page_search` — is materialised by the
sync server after each commit and is fully reconstructible from the CRDTs.

Three rules follow, and they are not negotiable:

1. **Nothing derived is ever written into a CRDT.** Formula results, rollups,
   lookups, filter outcomes, audit timestamps: computed during
   materialisation, never persisted in the document. Storing a derived value
   lets two clients disagree about something deterministically implied by its
   inputs.
2. **Sibling order is a fractional index**, a lexicographically sortable
   string, never an array position. Two offline clients inserting between the
   same pair of siblings produce different keys that both survive the merge.
   An array produces a conflict.
3. **Relations are stored on one side only.** The inverse direction is a query
   against `page_relations`. Maintaining both directions inside CRDTs does not
   converge cleanly.

## Consequences

A new view type, a new filter operator, or a new index needs a materialiser
change and a rebuild — no user-data migration. This is the main payoff.

Materialisation is on the write path, so it must be fast and idempotent. A
full rebuild must exist as an operational command from day one, and must be
tested, because it is the recovery path for every materialiser bug.

Writing to a materialised table from anywhere other than the materialiser
breaks the model silently. Enforce it in review.

## Alternatives considered

**Postgres as sole store, operational transforms over it.** Rejected: no
offline editing, and conflict handling becomes bespoke per block type.

**CRDT only, query in the client.** Rejected: kills the web portal, server-side
search and cross-workspace queries. See ADR-0003.

**SQLite index per client, no server projection.** This was the earlier
design, appropriate under end-to-end encryption. Superseded by ADR-0003.
