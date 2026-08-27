# ADR-0008: Full-replace materialisation, not incremental diffing

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

ADR-0002 makes the CRDTs authoritative and every other table a projection.
The materialiser is what maintains that projection. It runs on the write path,
so its cost matters — but its correctness matters considerably more, because a
projection bug produces wrong views and wrong search results while the
underlying documents remain fine.

The obvious optimisation is to diff the document against the stored rows and
write only what changed.

## Decision

Full replace per page, per commit. `DELETE FROM blocks WHERE page_id = $1`
followed by a single multi-row insert, and the same for `page_properties` and
`page_relations`. No diffing.

The whole projection for one page lands in one transaction supplied by the
caller, so a crash mid-run leaves the previous projection intact rather than a
page with new blocks and stale properties.

Two contract properties, in this order of priority:

- **Idempotent.** Running twice on unchanged input produces identical rows.
- **Total.** A malformed block, an unknown field type or a stale option id
  degrades that one thing. It never aborts the page and never aborts a batch.
  Problems are collected as warnings and recorded, not thrown.

## Consequences

A page is rewritten in full on every commit. This is acceptable because a page
is bounded — a document with ten thousand blocks is already a usability
problem — and because commits are debounced by the sync server rather than
being per keystroke.

Diffing has failure modes that full replace cannot have: missed deletions,
stale rows, rows orphaned by a rename. Those are invisible until a user
notices a ghost entry in a view, and then they are very hard to reproduce.
Full replace trades measurable throughput for a class of bug that cannot
occur.

`materialization_state` records which sequence each projection reflects, so a
crash is detectable and `rematerialize --pending` can resume rather than
restart.

The rebuild command must stay tested and exercised. It is the recovery path for
every materialiser bug, and an untested recovery path is not one.

If profiling later shows the write path is genuinely bound by this, the place
to optimise is batching commits per page over a short window — not diffing.

## Alternatives considered

**Incremental diff against stored rows.** Rejected on the failure modes above.

**Postgres triggers deriving blocks from a jsonb document column.** Would move
the projection into the database and lose access to block-type plugins, which
need to run application code for `toPlainText`.

**Materialise asynchronously in a worker queue.** Attractive for write latency,
rejected for now: a user who edits a database row and immediately re-sorts the
view would see stale data, and explaining that is worse than the latency. The
cascade queue inside the rebuild command already provides the async path for
the cases that genuinely need it, such as re-projecting every row of a
collection after a field type changes.
