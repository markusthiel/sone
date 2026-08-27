# SONE

**S**elfhosted **O**pensource **N**otes for **E**veryone.

A self-hosted workspace: block-based documents, databases with table, board,
calendar and gallery views, real-time collaborative editing, guest access and
shareable links with edit rights.

> **Status: pre-alpha.** Not usable yet. This repository currently contains
> the data model, the database schema, the architecture decisions and the
> deployment scaffolding. Nothing runs. See the roadmap below.

## Why this exists

There are good open-source Notion alternatives. Several of them place limits
on self-hosters that the licence text does not lead you to expect — the
sharpest example being a self-hosted server that accepts exactly one user
while shipping under AGPL-3.0.

SONE takes the opposite position, written down as a binding decision record
rather than a marketing promise:

- **No seat limits.** No user counting, no licence key, no gated features, no
  enterprise edition of the codebase. See
  [ADR-0007](docs/adr/0007-no-seat-limits.md); pull requests introducing any of
  those are rejected on principle.
- **No dependency that can be taken away.** The editor is built on vendored
  MIT foundations rather than a framework with a commercial tier above it. See
  [ADR-0004](docs/adr/0004-vendored-editor-no-upstream-dependency.md).
- **Two containers.** App plus Postgres. No Redis, no search cluster, no
  object storage required. See [ADR-0005](docs/adr/0005-no-redis.md).

## Deployment

```sh
cp .env.example .env
# set SONE_SECRET_KEY and POSTGRES_PASSWORD
docker compose up -d
```

Migrations run on start. Data lives in two named volumes, `sone_db` and
`sone_files`.

**SONE does not encrypt document content from the server operator.** Search,
the web client and link sharing all require server-side access to content.
This was a deliberate trade — see
[ADR-0003](docs/adr/0003-no-e2e-encryption.md). Use disk or volume encryption
if you need protection at rest.

## Architecture in one paragraph

Each page is a Yjs CRDT document; its update stream is the only authoritative
data. Everything else in Postgres — pages, blocks, collections, properties,
relations, the search index — is materialised from those CRDTs after each
commit and can be rebuilt from scratch at any time. That split is what lets
new view types, filter operators and indexes ship without migrating user data.
Read [ADR-0002](docs/adr/0002-crdt-truth-postgres-projection.md) before
touching the schema.

Four invariants, each with a specific failure mode behind it:

1. Derived values (formulas, rollups, lookups, audit timestamps) are never
   written into a CRDT.
2. Sibling order is a fractional index string, never an array position — and
   every sibling sort is `(idx, id)`, never `idx` alone. The midpoint
   algorithm is deterministic, so two clients inserting into the same gap
   while offline generate the *identical* key; without the id as tie-breaker
   they render the same document in different orders.
3. Relations are stored on one side only; the inverse is a query.
4. The projection is rewritten in full per page, never diffed (ADR-0008).

The projection can be rebuilt at any time:

```sh
docker compose exec app node packages/server/scripts/rematerialize.mjs
docker compose exec app node packages/server/scripts/rematerialize.mjs --pending
```

This is the recovery path for every materialiser bug, and it is meant to be
used rather than admired.

## Layout

```
packages/core      data model, types, schema versioning
packages/editor    block layer on the vendored ProseMirror
packages/server    sync server, REST API, auth, materialisation
packages/web       React client
vendor/prosemirror git subtree, not an npm dependency
db/migrations      Postgres schema
docs/adr           architecture decision records
docker             image, entrypoint, healthcheck
```

## Roadmap

Months are elapsed calendar time for one part-time developer, not effort
estimates.

1. **Server core** (1–4) — schema, auth, Yjs sync server, materialisation,
   Docker setup. *In progress: schema, document store, materialiser and
   rebuild command are in; auth and the WebSocket sync server are next.*
2. **Editor and web client** (5–9) — block layer, live editing, presence.
3. **Collections** (10–14) — fields, table and board views, filters, sorting.
4. **Sharing** (15–17) — share tokens, guests, editable links, granular
   permissions.
5. **Depth** (18–26) — relations, rollups, formula engine, calendar and
   gallery views, importers for Notion, AppFlowy and Markdown.
6. **Desktop and mobile** (26+) — Tauri shell, offline sync.

Web before desktop, deliberately: the browser is the primary client.

Three things are known to sink projects of this shape, and each gets its own
stage rather than being folded into another: mobile (effectively a second
application), the formula engine (a compiler project), and sync correctness
under poor network conditions.

## Licence

[AGPL-3.0-only](LICENSE). If you run a modified SONE as a network service, the
modified source must be available to its users. That is the intended effect.
