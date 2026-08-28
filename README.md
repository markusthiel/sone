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

No image is published yet, so build from source:

```sh
cp .env.example .env
# set SONE_SECRET_KEY and POSTGRES_PASSWORD
docker compose -f docker-compose.build.yml up -d --build
```

Once there is a release, `docker compose up -d` pulls the published image
instead.

One application container plus Postgres, serving both the API and the web
client. Migrations run on start.

Read [docs/deployment.md](docs/deployment.md) before putting it behind a reverse
proxy — the WebSocket upgrade and the database locale both have to be right, and
both fail in ways that look like application bugs.

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
2. The sidebar is folders and pages, not pages within pages. A folder holds
   both kinds; a page holds nothing (ADR-0019). A folder is a document like a
   page, so it syncs and rebuilds the same way.
3. Within a page, block order is position in the page's single ProseMirror
   fragment, and parent-child nesting of text blocks is an `indent` attribute
   rather than XML nesting — ProseMirror forbids a node holding both inline
   text and block children (ADR-0015, ADR-0018). Elsewhere
   (page tree, collection rows, fields, views) order is a fractional index
   string, and every such sort is `(idx, id)`, never `idx` alone: the midpoint
   algorithm is deterministic, so two clients inserting into the same gap
   while offline generate the *identical* key, and without the id as
   tie-breaker they render the same list in different orders.
3. Relations are stored on one side only; the inverse is a query.
4. The projection is rewritten in full per page, never diffed (ADR-0008).

Multilingual from the start, and it shows up in the schema rather than only in
the UI: search indexes under both the workspace's dictionary and `simple` so
that stemming works without breaking mixed-language content, locale is stored
per user so invitations arrive in the recipient's language, and user-visible
text sorts under an ICU collation while fractional indices stay byte-wise.
See [ADR-0011](docs/adr/0011-internationalisation.md).

The projection can be rebuilt at any time:

```sh
docker compose exec app node packages/server/scripts/rematerialize.mjs
docker compose exec app node packages/server/scripts/rematerialize.mjs --pending
```

This is the recovery path for every materialiser bug, and it is meant to be
used rather than admired.

## Layout

```
packages/core      data model, block tree, schema and document migrations
packages/client    sync connection, document store, presence — no React
packages/editor    block layer on ProseMirror: schema, keymap, input rules
packages/server    sync server, HTTP API, auth, materialisation
packages/web       React client — no WebSocket, no Y.Doc
db/migrations      Postgres schema
docs/adr           architecture decision records
docker             image, entrypoint, healthcheck
```

The `client` / `web` split is not stylistic: a store reachable only through
React hooks cannot be tested without a renderer, and in a local-first client
every interesting bug is in the store. See
[ADR-0016](docs/adr/0016-web-client-architecture.md).

## Roadmap

Months are elapsed calendar time for one part-time developer, not effort
estimates.

1. **Server core** (1–4) — schema, auth, Yjs sync server, materialisation,
   Docker setup. *Substantially complete: schema, document store,
   materialiser, rebuild command, auth, sessions, invitations, share links and
   the WebSocket sync server, the HTTP API and the maintenance job are in.*
2. **Editor and web client** (5–9) — *Largely working: shell, auth, page tree,
   collaborative block editing with markdown shortcuts, a slash menu, block
   actions, indentation, presence, search, folders, multiple workspaces, and a
   right-hand outline, tasks and properties panel, images, tables, markdown
   paste, moving entries between folders (by drag or by picker), tags,
   favourites, sharing and an administration area. Remaining: tag colours,
   collections.*
3. **Collections** (10–14) — fields, table and board views, filters, sorting.
4. **Sharing** (15–17) — share tokens, guests, editable links, granular
   permissions.
5. **Depth** (18–26) — relations, rollups, formula engine, calendar and
   gallery views, importers for Notion, AppFlowy and Markdown.
6. **Desktop and mobile** (26+) — Tauri shell, offline sync.

Web before everything else, deliberately: the browser is the primary client,
and its first mobile form is a PWA. Native mobile is deferred with its
reasoning recorded in [ADR-0009](docs/adr/0009-web-first-pwa-native-deferred.md)
rather than left as an empty repository.

Three things are known to sink projects of this shape, and each gets its own
stage rather than being folded into another: mobile (effectively a second
application), the formula engine (a compiler project), and sync correctness
under poor network conditions.

## Versions and upgrades

Not yet released; no tags exist. The bar for the first one is in
[ADR-0013](docs/adr/0013-versioning-and-releases.md).

The version number answers one question — *what do I have to do to upgrade?*

- **PATCH** — pull and restart.
- **MINOR** — pull and restart; migrations run automatically.
- **MAJOR** — read the [changelog](CHANGELOG.md) first, there is something to do.

That is narrower than library SemVer and more useful for a self-hosted product.
Four contracts version independently — the persisted document format, the sync
wire protocol, the database schema, and the HTTP API — and `/api/version`
reports them, because one number cannot express four axes.

Migrations are forward-only, and the server refuses to start on a downgrade
rather than corrupting data. A rollback is a backup restore:

```sh
docker compose exec app node packages/server/scripts/backup.mjs
docker compose exec app node packages/server/scripts/restore.mjs --archive <dir>
```

Document formats migrate automatically when a page is opened, so an upgrade is
a restart rather than a maintenance window. What remains manual, and why it
should be rare, is in [ADR-0014](docs/adr/0014-automatic-upgrades.md).

**Pre-1.0, the persisted document format may change in a minor release** and a
document migration may be required. Do not put anything you care about into a
pre-1.0 instance without a backup you have tested restoring.

## Testing

```sh
pnpm test                     # no database required
```

```sh
docker compose -f docker-compose.test.yml up -d
export SONE_TEST_DATABASE_URL=postgres://sone:sone@localhost:5433/sone_test
pnpm --filter @sone/server test:db
```

The database suites run against a real Postgres rather than a mocked client.
See [docs/testing.md](docs/testing.md) for why, and for what the first run of
that suite found.

Requires pnpm — the workspace uses `workspace:*` dependencies, which npm does
not understand.

## Licence

[AGPL-3.0-only](LICENSE). If you run a modified SONE as a network service, the
modified source must be available to its users. That is the intended effect.
