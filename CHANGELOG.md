# Changelog

Entries describe what an operator or user experiences, not what changed in the
code — `git log` already records that. Any required operator action is named
first; if there is none, the entry says so.

Versioning follows [ADR-0013](docs/adr/0013-versioning-and-releases.md): the
version answers "what must I do to upgrade?", not "how much changed?".

- **PATCH** — pull and restart, nothing else.
- **MINOR** — pull and restart; migrations run automatically.
- **MAJOR** — read this file first, there is something to do.

## Unreleased

**Container images are published automatically.** Built with buildah rather
than Docker, so the CI runner needs no daemon socket — which also means no
workflow gets root-equivalent access to the host's daemon. Images land at
`forgejo.thiel.tools/thiel/sone`.

Known issue: the image carries about 26 MB of build tooling it does not need,
because neither `pnpm prune --prod` nor `pnpm install --prod` removes the
devDependencies of workspace packages. Not a correctness problem; the fix
changes the runtime layout and is scheduled before 1.0.

## 0.1.0-rc.1

**No operator action required.** First tagged release, so there is nothing to
upgrade from.

A pre-release, deliberately. The bar for 0.1.0 in
[ADR-0013](docs/adr/0013-versioning-and-releases.md) includes two things nobody
has actually confirmed yet: that a fresh `docker compose up` reaches a working
instance on someone else's machine, and that two browsers editing the same page
behave. Both are covered by automated tests as far as they can be without a
browser, and neither has been seen by a person. Calling this 0.1.0 would claim
otherwise.

What the tag is for: deploying a fixed, reproducible commit instead of a moving
branch. A Portainer repository stack pointed at `refs/tags/v0.1.0-rc.1` with
compose path `docker-compose.build.yml` builds exactly this code, with no
container image and no CI runner needed.

**The server runs.** `docker compose up -d` starts an instance that applies its
migrations, serves `/api/health`, `/api/ready` and `/api/version`, accepts
WebSocket sync connections, and shuts down cleanly on SIGTERM without losing
unflushed edits.

Working so far:

- Documents as Yjs CRDTs with a rebuildable Postgres projection
- Real-time collaborative editing over a multiplexed WebSocket, with presence
- Accounts, sessions, invitations (single-use and multi-use links)
- Share links with view/comment/edit rights, subtree scope, optional password,
  and anonymous editing
- Revocation that takes effect on live connections, not just on reconnect
- Full-text search, indexed under both the workspace's language and a
  language-neutral configuration
- A maintenance job that prunes expired sessions, compacts document histories
  and revalidates open connections
- Backup and restore, verified end to end: dump, destroy the database, restore,
  and the documents still open
- Automatic upgrades — document formats migrate lazily when a page is opened,
  and the server refuses a downgrade instead of corrupting data

The document format was corrected before any data existed: the block tree now
lives in one ProseMirror fragment per page rather than one per block, which is
what makes multi-block selection possible at all
([ADR-0015](docs/adr/0015-one-fragment-per-page.md)).

The client library is in: sync connection with jittered reconnect, a
refcounted document store that survives disconnection, presence, and offline
edits that reconcile on reconnect without an explicit queue. Proven by an
end-to-end suite running a real client against a real server against a real
Postgres.

A web client exists. Setup, sign-in, invitations, a page tree, live-synced page
titles, presence, search and share links all work in the browser. Two windows
on the same page see each other's changes and each other's cursors.

**Pages are editable.** Paragraphs, headings, bullet and numbered lists, todos,
quotes, callouts, code blocks and dividers, with markdown shortcuts (`# `, `- `,
`1. `, `[] `, `> `, ``` ), bold and italic, Tab and Shift-Tab to indent, and
remote cursors showing where other people are typing.

Not working yet: a slash menu, drag handles, images, and database views — the
last of these renders a placeholder rather than pretending to work. Everything above is reachable only
over the API and the sync protocol.

**Upgrades.** The intended experience for every release, major or not, is
`docker compose pull && docker compose up -d`. Database migrations and document
format migrations both run automatically; see
[ADR-0014](docs/adr/0014-automatic-upgrades.md) for what remains manual and why
it should be rare.

**Pre-1.0 warning.** Until 1.0, the persisted document format may change in a
minor release and a document migration may be required. Do not put anything you
care about into a pre-1.0 instance without a backup you have tested restoring.
