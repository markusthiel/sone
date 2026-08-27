# ADR-0001: Monorepo with pnpm workspaces, Node 22 LTS

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

SONE splits into `core` (data model), `editor` (block layer), `server` (sync,
API, auth, materialisation) and `web` (client), with `desktop` to follow.

These boundaries are real, but they are crossed constantly. Adding one block
type touches the type in `core`, rendering in `editor`, materialisation in
`server` and UI in `web` — in the same change.

The project is developed by one person over a multi-year horizon.

## Decision

One repository, pnpm workspaces, packages referencing each other locally with
no publishing step. Node 22 LTS on the server.

The vendored ProseMirror fork lives at `vendor/prosemirror` as a **git
subtree**, not a copied directory, so upstream fixes remain mergeable.

## Consequences

A cross-cutting change is one atomic commit, one CI run, one version. There is
no version matrix and no question of which `core` the server is running.

Package boundaries are enforced only by discipline and lint rules, not by
publishing. `core` must not import from `server` or `web`; a lint rule
enforces the direction.

Choosing Node over Bun costs measurable request throughput. It buys tested
Yjs and Postgres drivers, stable Docker base images, and error messages that
are searchable. For a project intended to run for years, boredom is a feature.
The server avoids Node-only APIs where convenient so a later move stays open.

## Alternatives considered

**Separate repositories per package.** Rejected: every cross-cutting change
becomes four commits and four releases. For a solo developer this is the
fastest route to paralysis.

**Bun.** Rejected for now. Faster, but the ecosystem risk lands on the one
part of the system that must never lose data.

**npm or yarn workspaces.** Workable. pnpm chosen for strict dependency
isolation, which catches accidental cross-package imports early.
