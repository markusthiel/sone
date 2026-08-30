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

**Attribution is pruned.** When nothing of somebody's writing is left in a page,
their entry goes with it — deleted text should not keep a name in the record
([ADR-0022](docs/adr/0022-attribution.md)).

**SONE opens where you left off.** Each workspace remembers the page you were
last on, and you can choose a fixed one instead under Settings → Where you land.
It applies on sign-in, on a workspace switch, and whenever SONE is opened without
a page in the address.

**Fixed: switching workspaces still reported no access.** The connection
reconnects on a switch, and a page opened against the old one is refused —
correctly, about a moment that had already passed. A refusal is only shown once
the connection has settled.

**A workspace can be deleted** from the list, by typing its name. It stops
appearing to everybody in it and can be restored for a month, after which the
maintenance job removes it. `SONE_WORKSPACE_RETENTION_DAYS` changes that.

**Every workspace in one list**, with people, pages and when each was last
edited — and open one to change
what people may do there, remove them, or invite somebody. Personal workspaces are counted and folded away, so a hundred accounts
do not read as a hundred teams.

**Settings are in three named areas** — You, Workspaces, Instance — and every
entry says in one line what is inside it. The two invitations are now told apart
by name: one gives an account, the other puts somebody in a team.

**A right for managing workspaces**, granted per account under Settings →
Accounts, with a way into the workspace list from the workspace switcher: create, edit, invite
to and delete workspaces, and set who is in them. Not accounts, not single
sign-on, not maintenance — and not reading anybody's pages
([ADR-0027](docs/adr/0027-administration-areas.md)).

**Fixed: switching workspaces opened a page from the one you left.** The tree
was still the old one for a moment, and the root redirects to its first page —
so the server refused it, correctly, to somebody who had only pressed a switcher.

**Invite somebody to a workspace** under Settings → Workspace. Works whether or
not they already have an account: with one they are asked to join, without one
they register first and end up in both their own workspace and yours.

**Fixed: accepting an invitation left you in your own workspace** rather than the
one you were invited to — a member of a team, looking at nothing to do with it.

**Fixed: creating an account from an invitation ended on an error.** Registering
uses the invitation, and the page then looked the same token up again, found it
spent, and reported a failure — after everything had worked.

**Protected sections.** Type `/` and choose "Protected section" to put a part of
a page behind its own permissions. It is a separate document, so the server
declines to send it to people who may not read it — the only way a permission on
part of a page can be enforced ([ADR-0026](docs/adr/0026-page-permissions.md)).

**Fixed: a restricted page was hidden from the tree and still synchronised.**
The listing stopped showing it and the protocol went on serving its document to
anybody holding the id. Restrictions are now checked where sync decides.

**Groups.** A group is a list of people, granted access to a page exactly as a
person is. Membership is the thing maintained — leaving a group takes its access
with it. Manage them under Settings → Groups, and give
one access to a page in the sharing dialog.

**Page permissions are enforced in the tree, in search and in favourites.** A restricted page and everything
under it is absent for people who were not granted it; a page kept only as the
path to a granted child appears without its title. Set them in the sharing dialog: give
somebody access to a page, or restrict it so only the people you name reach it
and everything under it
([ADR-0026](docs/adr/0026-page-permissions.md)).

**An invitation followed while signed in now asks whether to join.** It used to
do nothing at all: the sign-up screen only appeared for people without an
account, so somebody who had one landed in their own workspace with no sign the
link had meant anything.

**Invite people to the instance** under Settings → Invite people. They get an
account and a workspace of their own; adding them to a team is a separate step.

**Invitations have an API at all.** They existed in the server's domain layer
since the authentication work and nothing ever exposed them, so in practice the
only way into a workspace was to be there when it was made.

**Invitations are two things now.** An invitation to the instance creates an
account and nothing else — the person lands in their own workspace. An invitation
to a workspace works for people who already have an account, which previously had
no path at all.

**Everybody has a workspace of their own.** Created with the account, always —
including for existing accounts, which get one on upgrade. Somebody invited to a
team now lands in both ([ADR-0025](docs/adr/0025-personal-workspaces.md)).

**Fixed: every account created through sign-up became an instance
administrator.** Only the first one does now.

**Single sign-on.** Set `SONE_OIDC_CLIENT_SECRET` and configure the issuer in the
administration area under Settings → Single sign-on; the sign-in page then offers
a button beside the password form. One OIDC client rather than an integration per provider, so Keycloak,
Authentik, Zitadel, Entra, Google and the rest are a configuration
([ADR-0024](docs/adr/0024-oidc.md)). Password sign-in stays. One OIDC client rather than an integration per
provider, so Keycloak, Authentik, Zitadel, Entra, Google and the rest are a
configuration ([ADR-0024](docs/adr/0024-oidc.md)).

**A workspace decides what its eight colours look like.** Settings → Appearance
defaults → Palette. Everything that stored a name — tags, columns, blocks, folder
icons — follows, which is what names were for.

**Fixed: an icon's colour could not be cleared.** The new icon was assigned onto
the old one, so a request naming no colour left the previous one in place — "no
colour" was the one swatch that did nothing. The swatches also sit in two rows of
five rather than one row that was always one too wide.

**A colour of your own, beside the eight.** Anywhere a colour is chosen there is
now a pipette beside the swatches, carrying whatever colour was picked, and it
opens the platform's own colour picker. The eight names remain the
vocabulary, so changing what a workspace's "blue" means still moves every blue
thing; a custom colour is the escape for what a palette cannot cover.

**Fixed: the icon picker scrolled sideways as well as down.** It fits as many
columns as the menu is wide now. The colour swatches also land in whole rows
rather than a row of seven and a stray pair.

**Every icon in the set is available, with a search box to find one.** Type
"boat" rather than hunting through squares. The curated fifty are gone; a name is
now checked by shape rather than against a list, and an entry whose icon a
version does not know simply draws the default.

**Fixed: every entry icon drew as the same sheet of paper.** A Lucide icon is an
object rather than a function, and the check that resolved a name rejected all of
them — so the picker showed fifty identical icons and choosing one changed
nothing. The set is also much wider now, beyond office work: food, weather,
travel, tools, music, health, study.

**Fixed: a full-width image pushed the page sideways.** "Full page" meant the
window, sidebar included; it means the page's own area now, and the page cannot
scroll horizontally at all. A full-width image runs to both edges with no
corners and no border — a block with no ends does not need them marked.

**Fixed: the ⋮⋮ controls vanished over a full-width image.** They sit beside the
block, which is empty margin beside a paragraph and a photograph beside a
full-width image. They carry their own background now.

**An image can be shown as a card or a link**, not only as a picture — the same
three layouts a file has, because an image is a file with a special way of being
drawn.

**An image is offered two widths instead of three**, and full width now reaches
the edges of the page. "Column", "wide" and "full" all read as the width of the
text give or take — three names for one thing.

**Fixed: the ⋮⋮ handle appeared at the top of the page** for an image or a file
instead of beside the block.

**Fixed: no drag handle on a touch device.** Tapping a file now selects it, so
the ⋮⋮ handle appears — there is no hover on a phone or tablet to fall back on,
and the block was swallowing every tap. The gutter is also fully visible there
rather than half-faded, which had read as disabled.

**A file's actions moved into the ⋮⋮ menu**, where every other block's settings
already are — opening, downloading, and whether to show it as a card, one line
or a viewer. The `···` button on the block is gone.

**Fixed: an image, a file or an embedded table had no drag handle.** A block
that cannot hold a text cursor was invisible to the gutter, so the ⋮⋮ menu — and
with it width, alignment and moving the block — could not be reached for any of
them.

**Fixed: a file card's menu sat below the card** rather than at the end of its
first line, where the other displays put it.

**Files can be dropped onto a page**, several at once, and they land where they
were dropped. An image becomes an image block as it always did; anything else
becomes a file block.

**Fixed: a file block's menu stayed open.** Its stylesheet set `display`, which
beats the browser's own rule for `hidden` — so the element carried `hidden` and
rendered anyway. No event handling could have fixed that, and the first attempt
tried.

**Folders and pages can carry an icon**, with a colour for the icon and a
separate one for the name. A curated set of Lucide line icons, which match the
rest of the interface. Choose one from the ⋮ menu beside any entry.

**Fixed: paragraph spacing was the browser's, not ours.** Six styling rules were
written for a class the editor does not emit, so they matched nothing and
paragraphs fell back to a default margin that sat oddly beside headings with
deliberate ones. That is the uneven spacing that was reported.

**A file block has a menu**: open in a new tab, download, and how to show it —
card, one line, or a viewer. The name itself opens anything a browser can draw
and downloads anything it cannot, so the common case needs no menu at all.

**A workspace can have its own defaults for how elements look** — size, colour
and spacing per element kind. It fills the gaps a block leaves rather than
overriding: a block that carries its own setting keeps it, and one that does not
follows the workspace, including when the workspace changes later.

Stored per workspace and set by owners and admins. Nothing is written into
documents, and a workspace with no theme renders exactly as every workspace did
before. Set it under Settings → Appearance defaults. Every control offers "As designed",
which removes the setting rather than storing the value it currently equals — so
a workspace that has chosen nothing keeps following the design as it changes.

**Fixed: a toggle could not be filled on a phone.** Its content is the blocks
indented under it, and indenting was only possible with Tab — which a phone
keyboard does not have. The ⋮⋮ menu now has In and Out, so nesting works
without a keyboard.

**Fixed: the page zoomed itself on a phone.** Tapping a small search or filter
field made iOS magnify the whole page, and it does not zoom back out — the next
gesture to fix that often landed on pull-to-refresh instead. Form controls are
now large enough on touch that the browser leaves the page alone, and the page
no longer pulls to refresh. Pinch zoom still works: disabling it would fix the
symptom by taking a capability away from people who need it.

**The chosen person in the People tab is cleared when you open another page.**

**Fixed: the maintenance log reported every collection row as a misplaced
entry.** A row lives inside the page holding its collection by design
(ADR-0021), and the check predates that. It was logged every five minutes.

**Fixed: a file with an umlaut in its name could not be opened.** Serving it
threw while writing the `Content-Disposition` header — HTTP headers carry only
ASCII — and the viewer showed an internal error where the document should have
been. Every file with an accent, an umlaut or a CJK character in its name was
affected. The name is now sent both ways RFC 6266 allows: a plain ASCII form
any client understands, and the real name UTF-8 encoded.

**Two corrections in a collection's table.** The title column now says it is
fixed rather than simply lacking the bin every other column has, and the menu
for choosing a new column's type opens towards the empty space beside the table
instead of back across the rows it is about to add to.

**Fixed: a PDF would not display.** The viewer frame was sandboxed, and
Chromium's built-in PDF viewer does not run in a sandboxed frame at all — first
it showed only page one, then Brave refused to show anything. PDF frames carry
no sandbox now. What keeps that safe is unchanged and stricter than it sounds:
the type is decided from the file's bytes rather than from the upload, `nosniff`
stops the browser reconsidering, and the document is served with permission to
load nothing at all.

**Choosing somebody in the People tab marks what they wrote.** Choosing them
again clears it. Only writing recorded since attribution began can be marked —
it is not retroactive.

**A "People" tab lists who has written in a page** — everyone who has, whether
or not they are here now, which is what the circles at the top show instead.
Somebody who has since left the workspace stays in the list: they wrote what
they wrote.

**Attribution is being recorded.** Every editing session by a signed-in member
is now mapped to that person in the document, which is what makes "who wrote
this" answerable later. Nothing displays it yet — recording starts first because
attribution is not retroactive
([ADR-0022](docs/adr/0022-attribution.md)): an edit made before the mapping
exists can never be attributed.

Share-link guests are not recorded: there is no user id to record against, and
attributing to "a guest" would make one contributor out of several people.

**Documents are a content element.** Type `/` and choose "File": a PDF or text
file opens as a viewer with its own scrollbar, and anything else becomes a card
with its name, type and size. Each block switches between card, one line, and —
where a browser can draw it — a viewer.

**Documents can be uploaded, not only images.** Word, Excel, PowerPoint,
OpenDocument, PDFs, text and archives. PDFs and text are shown in place; a Word
or Excel file is offered as a file, because nothing here can render one and a
card that says what it is beats a viewer showing an error.

**Changed: a PDF is now shown in place** rather than downloaded. The earlier
caution was not wrong — a PDF viewer is a large attack surface — but a notes tool
where a PDF cannot be read is one where people keep their PDFs elsewhere. The
hardening that makes it acceptable is unchanged: the type comes from the bytes,
never the upload, and the response carries `nosniff` and a sandbox policy.

**Every block can be configured** from the ⋮⋮ menu: alignment, width and colour,
showing only the settings that mean something for that block. A wide paragraph
is just a harder-to-read paragraph, and an image has no colour to set.

**Blocks carry presentation: alignment, width and colour.** Three attributes
shared by every block type rather than a setting per kind, so a new block type
gains them for free. Width breaks out of the reading column — useful for an
image or a table, and ignored on a narrow screen where there is no margin to
break into.

The controls for these come next; this is the model and the styling.

**Edits survive a reload, not just a dropped connection.** A signed-in member's
browser keeps a copy of each document it opens; when the server comes back, the
two merge with no comparing and no conflicts to resolve — that is what a CRDT is
for.

A share-link guest gets no local copy: they are often on a borrowed machine, and
a link grants a page to read rather than one to keep. Signing out deletes the
copies, and ones untouched for 30 days are swept at startup.

**Fixed: losing the connection broke the layout.** The error banner was a child
of the app's two-column grid, so adding it pushed the sidebar into one row and
the page into another — the layout came apart at the moment something had
already gone wrong. It sits over the layout now, and the connection status
truncates instead of wrapping onto three lines and taking the bar's height with
it.

**A collaborator's name fades from their caret.** The bar stays — somebody else
is still in the document — but the label goes quiet a few seconds after they stop
typing, instead of sitting in the middle of a paragraph indefinitely. Hovering
the caret brings it back.

**A collection can be searched.** The box beside its views matches an entry's
title or anything in its cells, and narrows whatever the view already showed
rather than replacing it. Substring matching, not stemming: typing "plan" finds
"planning" and "unplanned", which is what a table's search box is expected to do.

**Filters and sorting can be set.** The button beside a collection's views opens
them, and says how many rules are active rather than only "Filter" — a table
showing fewer rows than expected is the kind of thing people blame on the
software. The work happens in the database, as it already did; what was missing
was any way to reach it.

**A collection can be placed in the text.** Type `/` and choose "Table of
entries": the collection is created and a block for it appears where the caret
is, between paragraphs, as in Craft and AppFlowy. Several per page.

**A collection is content in a page, not a folder.** 0.2.0 made a folder *be* a
table and put every row in the sidebar; a folder stopped meaning one thing, and a
hundred-row table meant a hundred sidebar entries. A page can now hold
collections — several, as in Craft — and a folder is a folder again.

**Rows are documents that are not in the tree.** Each one is a real page you can
open, with its own writing, and none of them clutter the sidebar. Craft and
AppFlowy both work this way; [ADR-0021](docs/adr/0021-collections-in-pages.md)
records why.

**Operator note:** a folder that carried a collection becomes an ordinary folder
again and keeps its pages. The columns are not converted — the shape existed for
one release, and converting it faithfully would mean rewriting every child
document.

**Fixed: "Add columns" appeared to do nothing.** The collection was created and
nothing displayed it — the folder's row was never marked as one, because that
mark was read from a document field that nothing writes. Every collection made
since the feature shipped was invisible.

## 0.2.0

Collections, and a great many corrections found by running 0.1.0 in earnest.

**Operator action: none.** Two migrations apply on start. Upgrading from 0.1.0
keeps everything; the document schema and sync protocol are both still version
1, so an older client still works against this server.

Share links created before this upgrade keep working but cannot be copied
again — only their hash was stored. Replace one if you want that.

### Collections

A folder can gain columns and becomes a table: text, number, date, checkbox,
link, email, phone, select and multi-select, edited in place. A row is a page,
and its title opens it.

Shown as a board when a select column exists: each option a column, and dragging
a card into one sets that value. A view can filter and sort, and that work
happens in the database rather than the browser.

### Everything else

- Entries are dragged with a finger as well as a mouse, into folders or between
  them to reorder; "Move up" and "Move down" do the same without a pointer
- Tags have colours, derived from the tag's own name unless a workspace chooses
  one
- Share links open the page they were made for, can be copied again, and let a
  guest with edit rights upload images
- A collaborator's caret carries their name
- A server that cannot start says so in the browser instead of leaving a blank
  page

### In detail

**Tags have colours.** Every tag gets one derived from its own name, so the same
tag is the same colour for everybody with nothing stored anywhere. A workspace
can choose a different one.

The overrides live in a table that is **decorative on purpose**: losing it loses
chosen colours and never loses a tag, because every tag still has its derived
colour and the tags themselves live in the page documents.
[ADR-0020](docs/adr/0020-tags.md) explains why that distinction had to be
written down before the table was.

**Fixed: deleting anything from a document did not reach the projection.** A
removed column stayed in every table, because the check for "did this change
anything" compared Yjs state vectors — and a deletion does not advance one. This
affected every delete made through that path.

**Fixed: the typed columns behind sorting and filtering were never filled.** A
row finds its collection by being inside the folder, and the materialiser was
looking for it on the row's own document, where nothing writes it. Values still
read back correctly, which is why nothing looked wrong until something tried to
sort on them.

**Collections can filter and sort**, in the database rather than in the browser.
A view's rules live in its definition; unknown columns are skipped rather than
failing, because a view lives in a document other people edit.

**Fixed: every caret still said "Someone".** Updating presence merged the new
fields and left the editor's copy of the name behind, so somebody who gave their
name after connecting showed correctly in the avatars and as "Someone" beside
their own caret. The copy is now recomputed wherever presence changes.

**A share visitor is asked for their name once per tab**, not on every reload.
Remembered per link, for the browser session only — a display name is not a
credential, and should not outlive the session on a shared machine.

**Fixed: uploading through a share link failed.** Resolving the token is what
sets the share cookie, and the client only did it when the link's path carried no
page — so the newer, self-describing links never got a cookie and every upload was
refused.

**Fixed: every collaborator's caret said "Someone" in the same orange.**
y-prosemirror reads `awareness.user`, which nothing published, so it used its own
fallbacks for both the name and the colour.

**Fixed: a guest editing through a share link could not upload images.** The
upload route read only the member cookie, so the request was refused — and an
image block with no URL renders its filename as a label, which read as a picture
turning into text rather than as a refused upload. Guests with edit rights can
now upload; guests with read rights still cannot.

**Fixed: a collaborator's caret showed a number instead of their name.**
y-prosemirror's default label reads `user.name`, and SONE publishes
`displayName`, so it fell back to the internal client id.

**Fixed: images in a shared page did not load, and one of them took the whole
app down with it.** A share visitor had no HTTP credential — the token
authenticated the sync connection and nothing else — so every image returned 401.
The boot handler then treated that failed load as a failure to start and replaced
the page with "SONE failed to start". A share visitor now carries a cookie, and
the boot handler only reports failures that actually prevent a start.

**A share link can be read, not just copied.** "Show link" reveals the full URL,
wrapped so all of it is visible. The copy button had silently done nothing on
iOS: a clipboard write must happen inside the user's own activation, and awaiting
the request for the URL spends it.

**Share links can be copied again.** Every existing link has a "Copy link"
button; a link is no longer shown once and then lost. Tokens are stored
encrypted under a key derived from `SONE_SECRET_KEY`, so a database dump on its
own still contains nothing usable.

**Operator note:** changing `SONE_SECRET_KEY` leaves existing links working but
no longer copyable. Links created before this cannot be copied either — the
dialog says so and offers to replace them.

**Fixed: share links never opened.** A link was `/s/<token>` and nothing could
turn a token into a page, so a visitor arrived holding a credential with nothing
to open and sat on "Opening…" indefinitely. This affected every link ever
created, at every permission level.

New links carry the page in the path. `GET /api/share/:token` resolves the older
ones, because a share link is a public contract — one sent last month has to keep
working. A password-protected link reports only that a password is wanted; the
page and its title stay hidden until it is unlocked.

**Board views.** A collection with a select column can be shown as a board:
each option is a column, and dragging a card into one sets that value. Entries
with no value get their own column, first — hiding them would mean a board
showing fewer entries than the table with nothing to say so, and the unsorted
ones are the ones most likely to need attention.

Every view shows the same entries, because they are the folder's contents. A
board arranges them; it does not filter them.

**Select and multi-select columns**, with an option editor in the column
heading: name, colour, add, remove. They were held back because a column whose
options nobody can manage is a column nobody can fill.

Renaming an option keeps every entry that uses it — a value points at the
option's identity, not its name. Removing one hides it from those entries rather
than erasing them, and the editor says so plainly instead of implying an undo
that does not exist.

Colours are a fixed palette of names rather than colour values, so a theme
decides what each looks like. That is also the answer
[ADR-0020](docs/adr/0020-tags.md) could not find for tag colours: options are a
registry that already exists on the field. Tags have none, which is why they
still have no colours.

**Fixed: folders and pages in the sidebar stopped opening.** Pointer capture was
taken the moment a row was pressed, and with capture set the browser fires the
click on the row rather than on the link inside it. Capture is now taken when a
drag actually begins, which is the only time it is needed.

**The dragged entry is drawn under the pointer again.** The indicator lines say
where a drop lands; they do not say what is travelling. HTML5 dragging drew this
for free, and replacing it with pointer events lost it.

**Fixed: every tenth build refused to start.** Builds are versioned
`0.1.1-dev.<n>.g<sha>`, and the version fence compared the whole pre-release as
one string — so `dev.10` sorted below `dev.9` and the newer build was rejected as
a downgrade. Pre-release identifiers are now compared the way semantic versioning
defines: one at a time, numbers as numbers.

**A server that cannot start now says so in the browser.** Instead of exiting and
leaving nothing on the port, it serves a page naming both versions and the way
out, and reports 503 on `/health`. A blank page was never the right way to
deliver an accurate explanation.

**Collections work.** "Add columns" on any folder turns it into a table: text,
number, date, checkbox, link, email and phone columns, edited in place. The
first column is each entry's title and opens the page, because a row *is* a
page — a collection is a folder with columns, not a spreadsheet that happens to
live in a notes app.

Columns and values live in the documents, so they sync between people, survive a
rebuild, and travel with an entry when it is moved out of the collection.

Select, relation, formula and rollup are in the data model and deliberately not
offered yet: each needs something that does not exist — option management, a
second collection, an expression language — and a column nobody can fill is
worse than no column.

**Fixed: two drop lines appeared between two entries.** "Before this row" and
"after the one above" are the same place, and each band drew its own line — so a
single gap looked like two places to drop. The row above owns the gap below
itself now, and the gap an entry already occupies is not offered at all, since
dropping there would change nothing.

**Fixed: dragging a row started the browser's own drag instead.** A row's label
is a link, and links are draggable by default — so pressing the obvious place
produced a floating copy with a green plus, and cancelled the app's gesture
underneath it. Dragging now starts from the label, and the click that would
follow a drag is suppressed so moving a page does not also navigate to it.

**The drop indicator says what will happen.** A line between two rows for
"reorder", a filled outline for "put inside", and nothing at all on a row that
would refuse the drop — marking one that will refuse promises something that then
does not happen.

**Fixed: dropping an entry between two rows did nothing.** Reordering targets
the folder the entry is already in, and the move rules refuse that as "already
here" — so every reorder was rejected before it reached the server, silently.
The entry snapped back and a reload showed it unmoved. This affected the mouse
as well: reordering by dragging had never worked.

**A failed tree operation now says so.** The error was recorded and nothing
displayed it, which is why a refused move looked like a move that did not save.

**Dragging works with a finger.** Press and hold a row for a moment, then move
it — into a folder, or between two rows to reorder. A press that moves straight
away scrolls the sidebar as before, which is how the two gestures are told
apart.

**Entries can be reordered without a mouse.** "Move up" and "Move down" in a
row's menu. Dragging is a pointer-device feature — iOS never fires those events
— so shipping reordering as drag-only left a tablet with no way to do it at all.
These also work with a keyboard.

**Fixed: pressing and holding a sidebar row selected its text** instead of doing
nothing. Rows are draggable, and on a touch screen, where the drag never starts,
that left a text selection in the sidebar.

**Fixed: builds after the 0.1.0 tag would not start.** `git describe` on a
commit after `v0.1.0` produces `0.1.0-1-g<sha>`, which semantic versioning reads
as a *pre-release of* 0.1.0 — below the release, and below `0.1.0-rc.1-…` as
well. The version fence correctly refused it as a downgrade, and the page stayed
blank because nothing was running to explain why.

Commits after a stable tag are now versioned as the next patch
(`0.1.1-dev.<n>.g<sha>`), which sorts where it belongs. CI checks the ordering
against the exact versions that caused this.

**Operator note:** an instance stopped by this starts once with
`SONE_ALLOW_DOWNGRADE=true`, or with any build from this commit onwards.

**Entries can be reordered by dragging.** Dropping between two rows places an
entry there; dropping onto the middle of a folder puts it inside. A line means
"between", a filled row means "inside", because a drop that could mean either is
a guess.

Reordering rewrites one row, not the whole folder, so two people rearranging the
same folder do not collide over entries neither of them touched.

## 0.1.0

The first release worth another person's time.

**Operator action: change the image tag.** `docker-compose.yml` now defaults to
`:latest` rather than `:main`. If you set `SONE_IMAGE` yourself, point it at
`forgejo.thiel.tools/thiel/sone:0.1.0` for a version that will never move under
you, or `:latest` to follow stable releases.

Upgrading from `0.1.0-rc.1` applies four migrations (folders, favourites, tags,
administration) and needs nothing else. Whoever created the first workspace
becomes the instance administrator.

The document schema and the sync protocol are both still version 1, so an older
client keeps working against this server.

### What it does

Write and organise notes, together, on your own server.

- Pages in folders, moved by dragging or by a picker, with a tree that
  remembers what you collapsed
- A block editor: headings, lists, to-dos, toggles that collapse, quotes,
  callouts, code with a copy button, dividers, images, tables, and markdown
  shortcuts and paste
- Real-time editing with other people, and edits kept locally when the
  connection drops
- Full-text search across a workspace, in the workspace's language
- Tags, favourites, an outline, and a task panel
- Share links: read, comment or edit, optionally with a password and an expiry
- An administration area: accounts, workspaces, settings that take effect
  without a redeploy, and maintenance that reports what it cannot fix
- Backup and restore, including the files

### What it does not do yet

Collections and database views render a placeholder. There is no mobile layout
(ADR-0009), no end-to-end encryption (ADR-0003), no tag colours
([ADR-0020](docs/adr/0020-tags.md) explains why they need a decision first), and
no reordering by dragging.

**An administration area.** Settings now has a sub-navigation: Account,
Appearance and Workspace for everyone, and — for instance administrators —
Instance, Accounts, Workspaces, Maintenance and About.

Whoever set the instance up administers it. Administrators can promote others,
deactivate accounts, see every workspace's size, read what the maintenance
checks are reporting, and change a few settings without editing a compose file
and restarting: who may sign up, the instance name, whether members may create
workspaces.

Two things it deliberately does not do. It cannot read what is in a workspace —
that needs membership, which is a decision somebody takes rather than a button.
And it cannot delete an account: deactivating keeps the person's work and signs
them out immediately, where deleting would take every page they created with
them.

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
