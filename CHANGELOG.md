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

**Multiple workspaces.** Click the workspace name to switch between them or
create a new one. Everything in the data model already allowed several — the
session has always returned a list — but nothing could create a second, so an
instance was effectively single-workspace. A new workspace starts with a folder
and its creator as owner. No workspace limit and no tier that unlocks a second
one (ADR-0007).

**Appearance settings** under Settings → Appearance: theme, and separate text
sizes for the interface and for the editor. Two scales rather than one, because
a denser sidebar and smaller prose are different wishes. Stored per browser: a
size that suits a phone is wrong on a large monitor. Instance-wide defaults
belong in an admin area and are not built yet.

**Fixed: the app told the workspace owner they had read-only access.** The
notice was derived from "can I edit", which is false whenever the role is not
yet known — including while a document opens and while a reconnect is in
flight, since the role is cleared when a connection drops. It now says
"Opening…" for that state and claims read-only only when the role is known and
actually read-only.

**Rename and delete for folders and pages**, from an unobtrusive ⋯ menu on each
row. Renaming is inline. Deleting a folder says how many items it will take
with it, in the menu and again in the confirmation.

**Line icons throughout**, replacing the emoji folder. A small inline SVG set
rather than an icon library: shipping hundreds of icons to draw a dozen, and
adopting somebody else's drawing conventions, are both decisions worth
deferring. This is also the basis for choosing icons per entry.

**A new workspace starts with a folder**, and pages can only be created inside
folders — the workspace root holds folders only. Without a starting folder a
fresh instance showed a "new page" button that refused.

**Real folders.** A folder organises; a page holds writing. A folder can contain
folders and pages, and a page contains nothing — which is the whole point, since
a tree where anything can hold anything gives "where does this go" no answer.
Folders sort before pages, clicking a folder expands it rather than opening an
empty document, and only folders offer "new inside this".

Existing pages are unaffected: an entry with no recorded kind reads as a page.
See [ADR-0019](docs/adr/0019-folders.md), including why a folder is a document
rather than a row in a `folders` table — one authorisation path instead of two,
and a projection that can still be rebuilt from the CRDT log.

**Fixed: opening the sidebar on a wide screen destroyed the layout.** The
backdrop behind the mobile drawer was only styled inside the narrow-screen
media query, so on a desktop it was an unstyled button sitting in the page
grid — it took the first column and pushed the sidebar and content out of
place. It is now positioned and hidden regardless of width, and the drawer
button is hidden where the sidebar is always visible.

**The page tree collapses.** Disclosure triangles on pages with subpages, with
the state remembered per browser. A collapsed branch still opens itself to
reveal the page you navigate to.

**Fixed: indenting a block detached its children.** Indenting shifted only the
selected block, so blocks nested beneath it became its siblings — quietly, with
nothing throwing and nothing looking wrong. Every operation on a block now
takes its indented children with it.

**Block actions.** A ⋮⋮ button beside every block: move up and down, indent and
outdent, duplicate, delete, and turn into another type. Keyboard shortcuts too —
`Alt-Shift-Up`/`Down` to move, `Mod-D` to duplicate. When a block has nested
children the menu says how many it will affect, because acting on blocks the
person did not see selected is the surprise worth avoiding.

**Fixed: the server refused to start after switching from the release candidate
to a development build.** Development builds were versioned `0.1.0-dev.<commit>`,
which sorts *before* `0.1.0-rc.1` because pre-release identifiers compare
alphabetically — so the version fence read it as a downgrade and refused. The
container exited, nothing answered, and the symptom was a blank page with no
explanation. Development builds are now versioned from `git describe`
(`0.1.0-rc.1-7-g8ff137f`), which sorts after the tag it follows.

`SONE_ALLOW_DOWNGRADE=true` now exists to recover an instance stuck in that
state. It warns on every start and does not bypass the document-format check.

**A white page now explains itself.** If the application bundle fails to load or
throws before React starts, the page says so, names the error, offers a reload,
and states plainly that pages are stored on the server and unaffected. React's
error boundary cannot help in those cases because it never mounts.

**The running version is visible in the app.** Settings → About shows the
server's version and the version of the client bundle in your browser
separately, and says so when they disagree — a browser holding a cached bundle
from an earlier deployment otherwise reports the server's version about code
that is not running. The version also appears at the bottom of the sidebar.

**Fixed: every page rendered blank.** Opening any page threw during editor
construction, React unmounted the tree, and the result was a white screen with
nothing to report. Reported from the first real deployment; nothing in 361
automated tests had touched the path.

**Added: crashes now show something.** An error boundary around the app and
another around the editor, so a future failure leaves the sidebar and
navigation working and shows the error where the person who hit it can copy it.

**A slash menu.** Type `/` at the start of a block or after a space to insert
any block type, filtered as you type — `/h1`, `/todo`, `/ul`, `/hr` all land
where you would expect. Arrow keys, Enter, Tab and Escape do what they should,
and a slash inside a word or inside code does not interrupt you.

**Container images are published automatically.** Built with buildah rather
than Docker, so the CI runner needs no daemon socket — which also means no
workflow gets root-equivalent access to the host's daemon. Images land at
`ghcr.io/markusthiel/sone`.

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
