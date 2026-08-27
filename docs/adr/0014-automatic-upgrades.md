# ADR-0014: Upgrades are automatic by default

- **Status:** Accepted
- **Date:** 2026-08-27
- **Refines:** ADR-0013

## Context

ADR-0013 defined MAJOR as "the operator must do something", which raised a fair
question: does that mean a growing list of manual chores, one per release?

It should not, and the difference is whether the machinery for automatic
upgrades exists *before* the first breaking change. Built afterwards, every
early breaking change becomes a manual step that stays manual forever, because
the upgrade path from that version can no longer be automated retroactively.

So this is built now, while the migration chain is still empty.

## Decision

Four mechanisms, each covering one category of change that would otherwise be
manual.

### 1. Database schema — already automatic

Migrations run in the container entrypoint on every start. No operator action,
ever. Established in ADR-0001.

### 2. Document format — lazy migration on open

Every document records its `SCHEMA_VERSION`. `migrateDocument` runs when a room
opens, applies the chain, and persists the result as one ordinary CRDT update.

Lazy rather than as a batch, because a batch over every document turns an
upgrade into a maintenance window whose length scales with the instance. This
way the upgrade is a restart, and documents update as people visit them.

Three properties are enforced by tests rather than by convention:

- **Deterministic.** Two clients opening the same unmigrated document must
  produce identical results. CRDTs converge on concurrent *edits*, but two
  different migrations of the same document merge into nonsense. No timestamps,
  no random ids, no unordered iteration.
- **Idempotent.** A crash between migrating and persisting is normal; the retry
  must not double-apply.
- **Gapless.** A test walks 1..`SCHEMA_VERSION` and fails if a step is missing,
  so bumping the constant without writing the migration cannot ship.

`document_schema_census` and `pendingDocumentMigrations` report how many
documents are still on an old version, because an unopened document stays there
indefinitely and an operator retiring an old version needs to know.

### 3. Configuration — deprecation shims, not breaking renames

A renamed or removed environment variable is accepted under its old name for at
least two minor releases, with a warning naming the replacement, and is only
removed in a MAJOR.

This is the mechanism that keeps most would-be MAJOR releases at MINOR. A
config rename is the single most common "breaking change" in self-hosted
software, and it is entirely avoidable.

### 4. Sync protocol — the previous version stays supported

A protocol change keeps the previous version working for one release cycle, so
a browser holding a cached client keeps functioning until it reloads. The
version is negotiated at auth and a mismatch is refused with a clear code
rather than a confusing failure.

### The version fence

`instance_meta` records the version that last ran. On start the server refuses:

- a **downgrade** — older code against a newer database would write old-format
  data into a new-format schema, from which the only recovery is a restore
- a **document schema regression** — a build that cannot read documents already
  in the database
- a **version skip** below `min_app_version`, which a migration raises when it
  makes older versions unsafe

Each refusal names what to do instead. This is the enforcement behind
ADR-0013's forward-only claim: nobody can accidentally go backwards.

### What remains genuinely manual

The honest list. These are the only cases that should ever make a release
MAJOR, and each is rare:

1. **A new required secret or setting** whose value only the operator knows.
   Cannot be defaulted or guessed.
2. **An infrastructure requirement** — a newer Postgres major version, a new
   volume, a reverse-proxy change.
3. **A multi-version jump** where an intermediate migration needs data a later
   one removes. `min_app_version` turns this into "upgrade to X first" rather
   than a crash.
4. **A decision only a human can make** — for example choosing a workspace
   language when the derived default would be wrong.

Target, stated so it can be held to: **at most one manual step per major
release, named first in the changelog.** If a change would need more, it is
split across releases with automatic steps in between.

### Backup and restore is part of the product

Forward-only migrations are only defensible if a restore is a real, tested
path. `scripts/backup.mjs` and `scripts/restore.mjs`, with `pg_dump`/
`pg_restore` present in the image — without which the backup command would fail
at the moment it is needed most.

Two details that are not arbitrary:

- **Files are archived before the database.** A file uploaded mid-backup then
  lands in the archive without a row: an orphan, wasting kilobytes. The reverse
  order gives a row without a file: a page referencing an attachment that does
  not exist, which is user-visible corruption. The cheap failure is chosen
  deliberately.
- **Restore verifies checksums before touching anything.** A truncated archive
  discovered halfway through a restore is worse than one refused up front,
  because by then the previous state is gone. Tested: a corrupted archive is
  refused and the existing data is intact.

The round trip is tested end to end — dump, `DROP SCHEMA public CASCADE`,
restore, and assert the CRDT documents still open. A restored projection is
worthless if the documents behind it did not come back.

## Consequences

An operator's normal experience of any upgrade, major or not, is
`docker compose pull && docker compose up -d`. MAJOR means "read the changelog
first", not "block out an afternoon".

Lazy document migration means a database may hold several schema versions at
once. Correct and intended, but it means the code must handle every version in
the chain for as long as unopened documents exist — which is potentially
forever. A future release that wants to drop support for version 1 needs a
one-off command to migrate the remainder, and `min_app_version` to fence it.

The determinism requirement is easy to violate by accident. The test compares
two independent migrations byte for byte, which catches it, but only for
migrations that exist — a migration added without a fixture is untested forever
after, because the old format stops being producible. The checklist in
`migrations.ts` says so at the point where someone would write one.

## Alternatives considered

**Batch-migrate every document on upgrade.** Simpler to reason about and gives
a clean cutover. Rejected: upgrade downtime would scale with instance size, and
the operator would experience exactly the "manual afternoon" this ADR exists to
avoid.

**Migrate on read without persisting.** Avoids write amplification after an
upgrade. Rejected: every open would re-migrate, and any client that wrote would
mix formats.

**Version documents by content sniffing instead of a stored number.** Rejected:
it makes every migration guesswork and makes a newer-than-supported document
undetectable, which is precisely the case that must fail loudly.
