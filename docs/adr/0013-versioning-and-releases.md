# ADR-0013: Versioning and releases

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Tags are needed before anything is released, because a tag on a released
artefact can never be moved without breaking the people who pulled it.

Ordinary semantic versioning fits a library, where the contract is an API. SONE
has four contracts, and they break independently:

| Contract | Version | Breaking means |
|---|---|---|
| Persisted documents | `SCHEMA_VERSION` in `@sone/core` | An older SONE cannot read a document a newer one wrote |
| Sync wire format | `PROTOCOL_VERSION` in `sync/protocol.ts` | A client and server cannot talk |
| Database schema | highest applied migration | The database must be migrated before the new code runs |
| HTTP API | none yet | A client's requests stop working |

A single MAJOR.MINOR.PATCH cannot express four independent axes, and pretending
otherwise produces version numbers nobody can act on.

## Decision

### The application version answers one question

**What does an operator have to do to upgrade?**

- **PATCH** — `docker compose pull && docker compose up -d`. Nothing else.
- **MINOR** — the same, plus new features may appear. Migrations may run, but
  automatically and without intervention.
- **MAJOR** — the operator must read the release notes and do something.

  MAJOR is meant to be rare, and [ADR-0014](0014-automatic-upgrades.md) is the
  machinery that keeps it that way: database migrations, document format
  migrations, configuration renames and protocol changes are all handled
  automatically. The target is **at most one manual step per major release**,
  named first in the changelog. Anything needing more is split across releases
  with automatic steps in between.

That is a narrower promise than library SemVer and a more useful one for a
self-hosted product. A user asking "can I just upgrade?" gets the answer from
the version number alone.

The four contract versions stay separate and are reported by `/api/version`
and `/api/ready`, so an operator can see them without reading a changelog.

### Pre-1.0 means the data format may still move

Until 1.0, `SCHEMA_VERSION` may change in a MINOR release, and a document
migration may be required. Stated in the README rather than implied, because
"0.x" is not a warning most people read as one.

After 1.0, a `SCHEMA_VERSION` bump requires a MAJOR release.

### Upgrades are forward-only

Migrations have no `down`. A rollback means restoring a backup — a real path,
implemented and tested end to end, not a sentence in a README. The version
fence in `instance_meta` refuses a downgrade at startup rather than letting
old code write old-format data into a new-format database.

This is deliberate: reversible migrations are a fiction as soon as one drops a
column, and maintaining the pretence costs real effort for a path nobody can
safely take. What replaces it is the discipline that a migration must be
applied only after a backup — which is why `ha_manage_backup`-style tooling is
part of the product rather than a nicety, and why the release notes for a
MAJOR name the backup step explicitly.

A newer database will not be served by older code: `main.ts` refuses to start
if migrations are missing, and a future version check will refuse the reverse.

### What gets tagged, and when

No tags yet. The bar for the first one, **v0.1.0**, is deliberately concrete:

- a fresh `docker compose up -d` reaches a working instance
- first-run setup creates a workspace and an owner
- a user can sign in, create a page, edit it, and see the edit survive a restart
- two browsers editing the same page see each other's changes
- a share link with edit rights works for someone without an account
- full-text search finds a page by its content

That is the smallest thing worth another person's time. Anything less is a
demo, and tagging a demo teaches people that SONE's tags do not mean much.

### Tag and image conventions

- Git tags are `vMAJOR.MINOR.PATCH`, annotated, signed once a signing key
  exists.
- A released tag is never moved or deleted. If a release is broken, the next
  patch fixes it.
- Container tags: `:0.1.0` (immutable), `:0.1` (moves within the minor line),
  `:latest` (moves to the newest stable release), `:main` (the development
  branch, explicitly not for production).
- No `:stable` alias. Two names for the same thing means one of them will
  eventually be wrong.
- Pre-releases are `v0.2.0-rc.1`, and `:latest` never points at one.

### CHANGELOG is written by hand

Entries describe what an operator or user experiences, not what changed in the
code. `git log` already records the code.

Conventional-commit tooling was considered and rejected: it produces a list of
commit subjects, which is a worse document than three sentences written on
purpose, and it makes the commit message format load-bearing for something it
should not control.

Every release entry names any required operator action first. If there is none,
it says so.

## Consequences

`main` always carries the next version with a `-dev` suffix, so a build from a
working tree is never mistaken for a release. The image reports `SONE_VERSION`
from the environment, baked in at build time, because running code has no other
way to know which tag produced it.

MAJOR releases will be rarer than library SemVer would produce, since a purely
internal breaking change does not affect an operator and therefore is not
MAJOR. This is intended, and means the version number is not a measure of how
much changed.

The four contract versions must actually be bumped when they change. Nothing
enforces that today; a test comparing `SCHEMA_VERSION` against a golden fixture
of the persisted layout would, and belongs with the first document migration.

## Alternatives considered

**Strict library SemVer.** Rejected: MAJOR would fire on internal changes that
cost an operator nothing, which trains people to ignore it.

**CalVer (`2026.8.1`).** Honest about the fact that a self-hosted product's
version is mostly a date, and used by several projects in this space. Rejected
because it cannot answer "can I just upgrade?", which is the one question the
number should answer.

**A single version covering all four contracts.** Rejected as impossible; see
the table above.
