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

**Tags.** Add them in the properties panel. `Meeting` and `meeting` are one tag,
and the first spelling used is the one shown. Typing a tag name into search
finds the pages carrying it — no filter syntax to learn.

There is no list to create a tag in and none to tidy up: a tag exists because a
page carries it, so an unused one stops existing. Tag colours are deliberately
not implemented; see [ADR-0020](docs/adr/0020-tags.md) for why they need a
decision rather than a table.

**Favourites.** Star a page or folder from its menu; favourites sit at the top
of the sidebar and can be reordered. They are yours, not the page's — nobody
you share a page with can see that you keep a shortcut to it.

**Entries can be moved between folders.** "Move to…" in a row's menu opens a
folder picker with a filter. Destinations that would not work are listed with
the reason rather than hidden — a folder missing from a list looks like a bug or
a permissions problem.

A folder cannot be moved into itself or into anything inside it. That would
leave the whole branch existing but unreachable from the root, with the ancestor
paths that every share link is computed from recursing forever.

**Choosing a block type is now one edit, not three.** Deleting the typed
command, splitting the block and applying the type were three separate changes,
and each one is written to the document and gives the collaborative layer a
chance to restore the caret from a position measured against the previous state.
The caret could end up several blocks away, so the new heading had to be hunted
for. It is a single change now, and the new block is created as the chosen type
rather than as a paragraph that then becomes one.

**A size scale.** Three control sizes and one spacing run, written down and
used. The unfinished feel was not missing components — it was every control
picking its own height and padding, some of them by accident.

**Fixed: to-do checkboxes and toggle triangles were the wrong size and
position.** A global rule gave every `button` on the page a 44px minimum height,
including a 15px checkbox — and a minimum beats an explicit height, so the box
rendered as a tall rounded rectangle overlapping its own text. Button styling is
opt-in now, which is the right default for an element used for a dozen unrelated
things.

**Enter in a to-do or a list continues with another one.** It produced a
paragraph, because ProseMirror's split creates the parent's default type. A new
to-do also no longer arrives already ticked.

**Fixed: a hidden sidebar came back on its own.** There were two states for one
thing: a drawer flag that meant nothing at widths where the sidebar is a column,
so hiding it and then rotating a tablet brought it back. One state now, with the
layouts differing in their default rather than in what they store, and a toggle
present at every width — previously there was no way at all to reclaim the space
on a wide screen.

**Fixed: a floating menu could disappear permanently.** The slash menu, the block
gutter controls and the formatting toolbar each hid themselves while their
position was unknown, and a single failed measurement was never retried — so the
`+` inserted a slash and no menu ever appeared. They retry now, and the slash
menu shows itself in a fallback position rather than not at all.

**Empty blocks say what they are.** An empty heading looked exactly like an empty
paragraph, so choosing a block type felt as though nothing had happened and the
line that had become a heading had to be hunted for. The empty block holding the
caret now names itself — only that one.

**Fixed: heading levels and checked boxes never reached the projection.** A
block's ProseMirror attributes — a heading's level, a to-do's checked state, a
toggle's collapsed state, an image's URL — were written to the document and then
ignored when reading it back. The outline showed every heading at one size, the
task panel showed every task as open, and ticking a box in the panel changed
nothing on the page. None of it looked broken enough to investigate.

**Toggles collapse.** Click the triangle, or `Mod-.` inside one. A collapsed
toggle shows how many blocks it is hiding, and the content stays in the document
— still synced, still searchable. Collapsing is stored in the page, so it is the
same for everyone looking at it.

**To-do boxes are clickable.** They were drawn with CSS, which cannot take a
click, so the only way to tick one was a keyboard shortcut.

**A + beside every block.** Inserting no longer requires knowing that `/`
exists. The ⋮⋮ handle beside it opens the block menu — it previously rendered
and did nothing useful, which is worse than not being there.

**`/image` opens a file picker**, so an image can be inserted without having one
on the clipboard.

**The page tree has no guide lines.** They were heavy and busy on screen —
several parallel lines competing with the labels they were meant to organise.
Spacing, a muted icon and a clear indentation step do the work instead.

**A Tasks tab** in the right-hand panel: every to-do on the page with a count of
what is open, tickable from the panel, and a jump to the block. Completed tasks
stay listed below rather than disappearing.

**Tables.** `/table` inserts one, Tab moves between cells, columns can be
resized by dragging, and the block menu grows a Table section inside one — add
and delete rows and columns, toggle header row or column, merge and split cells.

Cell contents are ordinary blocks, so a list or a heading inside a cell works.
Table text is searchable, which is the point of putting anything important in
one.

Built on prosemirror-tables rather than by hand: rectangular cell selection,
merging, resizing and repairing a malformed table are each harder than they
look, and a CRDT merge can produce a table with ragged rows that has to be
repaired rather than rendered defensively.

**Images.** Paste or drop one into a page and it uploads. A placeholder appears
straight away and fills in when the upload finishes; a failure leaves the block
in place with the reason on it rather than disappearing.

Storage is content-addressed, so the same screenshot pasted into five pages is
one file on disk. Files are authorised through the page they hang on, so a file
in a page you cannot see is a file you cannot fetch.

The declared content type is ignored — the bytes decide. SVG is deliberately not
an inline type: an SVG is a document that can carry script, and serving one from
the application's own origin would be a cross-site scripting vector. PDFs are
stored and downloaded rather than rendered in place.

**Fixed: the page you just created never finished syncing.** A document opened
while the connection was still authenticating had its open request dropped, and
nothing retried it — so the newest page, which the app navigates to immediately
after creating it, sat at "Opening…" with the header stuck on "Syncing…"
indefinitely. Pending opens are now re-issued on every authentication, including
the first.

**Pasting markdown works.** Text copied from another notes app, a README, a chat
or an LLM arrived as literal characters — `## Heading` stayed a paragraph
reading "## Heading". Headings, lists, checklists, quotes, fenced code, rules,
bold, italic, strikethrough, inline code and links are converted, and
indentation becomes nesting. Only when the text is recognisably markdown:
pasting a code sample or a quotation leaves it exactly as it was.

**Fixed: a slash command after text took over the paragraph instead of adding a
block.** Typing text and then reaching for `/heading` turned the writing into a
heading, so the heading appeared to jump somewhere else. Now an empty block is
converted and a block with text gets a new block after it — which is what the
gesture means in each case.

**Links.** There was no way to make one: the mark existed and rendered, and
nothing could apply it. `Mod-K`, or a selection toolbar with bold, italic,
strikethrough, code and link. Addresses are normalised, so `example.org` becomes
`https://example.org` rather than a path on your own instance, and
`javascript:` and `data:` links are refused rather than sanitised.

**Fixed: editing a page's heading did not rename it in the sidebar.** The title
lives in the document and the sidebar reads the projection over HTTP, so the
change reached the server and the tree went on showing the old name until
something refetched. The sidebar now follows the heading as it is typed, and the
tree is refetched when the tab regains focus so other people's changes arrive
too.

**Clicking a folder opens an overview of what is inside it**, with folders and
pages listed separately, when each page was last edited, and buttons to add to
it. Expanding and collapsing stays on the disclosure triangle. Using the name
to expand wasted the gesture people reach for most and left a folder with
nothing to open.

**The tree shows where things belong.** Nesting is drawn with a guide line down
each branch rather than by indenting rows further; the branch containing the
current page is emphasised. Indentation alone reads as a flat list of rows at
different offsets, because nothing connects a child to its parent.

**The sidebar header carries the collapse button**, not "new folder" — which was
in the wrong place twice over: it is not a navigation action, and it is only
wanted while looking at the tree. It now sits at the bottom of the tree.

**Fixed: a stalled connection waited forever and said "Syncing…".** A proxy that
accepts the connection but never completes the WebSocket upgrade produced no
open, no error and no close, so the client sat in "connecting" indefinitely,
every page showed "Opening…", and nothing on screen suggested why. There is now
a ten-second handshake timeout, and the status line names the cause — "Cannot
reach the sync server", with the likely fix on hover.

**A right-hand panel with tabs.** Outline and properties, toggled from the top
bar. The outline lists the page's headings and scrolls to one when clicked; it
is derived from the document through the same tree walk the server uses, so it
cannot disagree about where a heading is. Properties shows kind, timestamps,
your access and sync state. A column on wide screens, a drawer on narrow ones,
and it remembers whether it was open and which tab you were on.

**Fixed: the server restarted in a loop and served nothing.** The folders
migration applied its changes but never recorded itself, so every start retried
it and failed on a column that already existed. The migration is now idempotent
and recovers an affected instance on the next start, with nothing to do by
hand. The migration runner records a version itself when a file omits it, so
this class of failure can no longer stop an instance booting, and a check now
rejects such a file before it can be deployed.

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
