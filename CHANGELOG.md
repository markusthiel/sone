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

**A page keeps versions** ([ADR-0047](docs/adr/0047-page-history.md)). One is taken
when a sitting ends, and always before compaction — which is where a page's past
used to be discarded. Older ones are thinned: everything from the last day, hourly
for a week, daily for ninety days (`SONE_VERSION_RETENTION_DAYS`). Looking at one
in the interface comes next, and restoring after that.

**A reply has a Reply button.** Enter still sends it; the button is for everybody
who did not know that.

**Fixed: deleting a comment left its highlight in the text** until the page was
reloaded.

**Commented passages are marked**, and how much is up to the reader:
highlighted, underlined, or not at all, with a switch in the comments panel to
turn them off for the page you are reading. **Threads fold**, one at a time or all
at once, so you can concentrate on one part of a page.

**Fixed: a filled button turned pale on hover** — near-white text on pale grey,
which read as an empty box. **Fixed: comment threads had a bullet** and an indent
to make room for it.

**Comments are searchable, and a workspace can list what is still waiting.** A
page's threads are projected into the database, so "what has somebody asked that
nobody has answered" is a query rather than a hunt — and the text of a discussion
is now found by search, which is often where a decision is actually explained.

**Pages can be commented on** ([ADR-0046](docs/adr/0046-comments.md)). Select some
words, press Comment, and write. Commented passages are underlined, replies and
resolving live in the panel beside the page, and a thread whose text somebody
later deletes keeps the words it was about instead of disappearing.

**The document format is version 4**, for comments. A browser holding an older
build is asked to reload.

**Pages can be started from a template** ([ADR-0045](docs/adr/0045-templates.md)).
Mark any page — or any canvas — with "Use as a template" in its ⋮ menu, and it is
offered under the `+` beside every folder. The copy keeps everything the editor
can hold: collections, tables, boards, drawings.

**Fixed: somebody could appear in the People panel and then vanish.** Writing
inside a canvas note or a collection's properties was invisible to the tidying
that removes names whose words are gone, so it removed names whose words were
still there.

**Fixed: two confirmation questions were still in English**, and the one for
trashing an entry said "delete" when the entry is recoverable for thirty days.

**An entry's ⋮ menu is reordered**: what you can make inside it near the top, then
where it can go, then how it looks, with the trash on its own past a line.

**A canvas has a hand tool**, so the board can be moved on a phone or tablet.
**Fixed: the ink colours were squashed into ovals** on a narrow screen.

**Fixed: a canvas showed a sheet on its own heading**, and did not appear in its
folder's list at all. Both were the same line of code written out in five places;
it is one function now.

**A picture placed on a canvas now appears in the page's Pictures panel.** It has
no block to scroll to, so pressing it opens the file.

**Fixed: drawing over a note or a picture put the stroke behind it**, and "bring
to front" could not help — the board was two layers with all the ink underneath.
It is one stack now, in one order, and a drawing tool reaches the board through
whatever is on it.

**Fixed: the buttons on a canvas item's handle did nothing.** The press reached
the board underneath, which cleared the selection before the click arrived.

**Fixed: the + menu in the tree was cut off** by the content area. It is the same
panel as the ⋮ menu now — same width, same alignment, opening the same way.

**A visitor using a share link now appears by the name they gave**, marked as a
guest. **A read-only link no longer asks for a name** — it is only needed so
others can see who is editing. Writing that still cannot be attributed — from before the page began
keeping track, or by somebody who gave no name — is stated rather than left
silent.

**The pen draws in the workspace's own palette**, plus any colour you pick.

**Fixed: the People panel was always empty.** Attribution was switched off by a
single hardcoded `null` — nobody's edits were ever recorded, on any page, since
the panel was built. Writing done from now on is attributed; anything typed before
this cannot be, because the information was never captured.

**The canvas tools are icons**, and a line is now visible while it is being
drawn.

**Anything on a canvas can be picked up** — strokes and shapes included — and
whatever is selected carries a small handle: duplicate, lock in place, bring to
front, remove. **Fixed: a picture could not be dragged**, only copied.

**A canvas has shapes, pictures and a ruling.** Rectangles, ellipses and lines are
dragged out like a selection; a picture can be inserted from the toolbar as well as
dropped; and the board can be dotted, squared, lined or plain.

**Fixed: nothing could be drawn on a canvas** after the last release — everything
was being placed thousands of pixels off screen. A note placed with the text tool
also has the caret straight away now.

**Fixed: the icon picker offered a sheet as a canvas's default.** The first
swatch — the one that means "no icon of its own" — now shows the brush, and is
selected until another is chosen.

**Fixed: a canvas was drawn as a document in the tree.** It has a brush of its
own now, and the three things you can add are shown with the marks the tree draws
them with.

**A canvas has no scrollbars and no edges.** It fills the window below the
heading, the wheel moves the board, ⌘ or Ctrl with the wheel zooms about the
pointer, and the percentage takes you back to where you started.

**An entry's ⋮ menu is shorter and wider.** Rename, favourite, share and the two
reorderings are one row of marks; what can be added inside a folder is another,
under "New". Everything still says what it is when you rest on it.

**The document format is version 3.** A browser holding an older build is asked to
reload rather than being shown a canvas it cannot draw.

**A page can be a canvas** ([ADR-0043](docs/adr/0043-canvas.md)). The `+` beside a
folder now asks what to add — a page, a canvas or a folder — and a canvas is
offered in a folder's own view and its ⋮ menu as well. a pen in five colours and any thickness, text notes you can place
and drag anywhere, pictures dropped straight onto the board, and a corner to
resize what is selected. It zooms from a quarter to three times, drags a band across the
board to catch several things and move them together, pans with the middle button
or a held space, has an eraser, and undoes with ⌘Z — your own changes only, never
somebody else's. Everything on it merges
properly when two people work at once. Connectors between items are not built.

**A page can be set to the full width of the window**, under Width in the panel
beside it. The reading column stays the default; this is for the pages that are
not prose — a wide table, a board, a page of pictures. The setting travels with
the page, so it looks the same on every device and for everybody.

**The block menu's six actions are one row of icons** — move up and down, out and
in, duplicate, delete — instead of six rows of text, and the duplicate "Nesting"
section is gone. **The block menu has marks too**, the same ones the `/` menu uses, and alignment is
four icons instead of four words. **Fixed: the block menu could scroll sideways** —
a row of choices that did not fit made the whole menu overflow.

**The interface moves a little** ([ADR-0042](docs/adr/0042-motion.md)): a button
gives under a press, a tree branch fades its children in, and switching a panel
fades its body. All of it is off for anybody who has asked for less motion.

**The bar at the top is no longer a tinted band** — it sits on the same surface as
the page, and a line appears under it only once something has scrolled behind it.
**Both panel toggles are the same shape now**, mirrored, instead of a sidebar icon
on one side and an arrow on the other — and both are rounded like every other
button.

**Fixed: the block controls could sit where the text used to be** — after opening
or closing the page panel, which changes the editor's width without the window
noticing.

**Fixed: the panel beside a page had English headings**, and so did a good deal
else that a screenshot does not show — the filter conditions, the column types,
the whole block menu, the table toolbar, the undo tooltips, the roles and access
levels. A label held in a table of options is not markup, and the check for
untranslated text had only ever looked at markup.

**Fixed: notes ran into the tables and buttons above them** in the accounts and
maintenance panels. **A checkbox now has space between its box and its words**, and
the explanation under it lines up with the label. **The maintenance report is
stacked** rather than squeezed into two columns. The remaining English in the
administration area is translated: the accounts note, the storage advice and the
four counters.

**Fixed: the administration area showed key names instead of its headings**, and
**every longer explanation is translated too.** The guard that was supposed to
catch untranslated text could not see a sentence written across more than one
line, which is what all the long explanations are — so it had been reporting those
files clean.

**The interface is translated.** Every screen, dialog, menu and panel — the page
title, the formatting toolbar, the workspace switcher, the invitation screen, the
admin lists. Switch the language under Appearance; whether it says "du" or "Sie" is
the instance's setting.

**Invitations, groups, page permissions, single sign-on and the member list speak
German.** Thirty files are translated, and about eighteen lines of English are left
across the smaller panels.

**Six more areas speak German**: sharing a page, a workspace's typography and its
mark, where a workspace opens, a folder's own view, and moving an entry inside a
workspace. Twenty-two files are translated; what is left is mostly the panels for
invitations, groups, page permissions and single sign-on.

**The language can be chosen**, under Appearance: match the browser, English or
Deutsch. It applies at once, without a reload, and it follows your account rather
than the browser — unlike the text sizes beside it, which stay per device.

**The whole interface speaks German** — the sign-in and setup screens included,
which now take their language from the same `Accept-Language` negotiation the
server has always done. Fifteen files, and the guard's list is the record of them.

**The table of entries and the block menu speak German.** Fourteen files are
translated; only the sign-in and setup screens are still English, and they are
waiting on a decision about where the language is resolved.

**The administration area speaks German.** Twelve files are translated; what is
left in English is the collection table, the block menus and the sign-in screens.

**The `/` menu speaks German**, and searching it does too: typing "übersch" finds
"Überschrift 1", while "h1" keeps working as it always did.

**The panel beside a page and a view's filter and sort rules speak German.** Ten
files are translated; the admin area, the editor's own menus and the collection
table are still English.

**The workspace settings, the trash and search speak German too.** Eight files are
translated now; the admin area, the editor's menus and the collection table are
still English.

**The settings speak German**: the three areas and their switcher, the way back to
your notes, and every section of your own settings — profile, signing in,
appearance, where you land, about. Five files are translated now.

**The sidebar and an entry's menu speak German too** — the tree, the favourites,
search, and every entry in the ⋮ menu including the icon and colour picker. Four
files are translated now; the rest of the interface is still English.

**Every error message is translated.** All twenty-two of them, in German as well —
the table moved out of the sign-in screen and into the catalogue, which is where a
second language can reach it. The messages that diagnose a deployment keep their
technical terms in both languages, because an operator has to find them again in
their own configuration.

**The account menu has a mark beside every entry.** The three settings areas carry
the same symbols there as in the switcher at the top of a settings column.

**Whether the interface says "du" or "Sie" is an instance setting**, under
Administration → Settings. It applies to German and any other language that
distinguishes the two; English is unaffected. New instances say "du".

**The interface can speak German** ([ADR-0041](docs/adr/0041-interface-language.md)).
The machinery is in place — a catalogue, plural rules per language, and a language
chosen from your own setting, then the workspace's, then the browser's — and two
screens use it so far. The rest of the interface is still English and will be
translated a file at a time.

**A browser running an older build than the server now says so**, in a strip under
the topbar with a Reload button, instead of only in Settings → About.

**Entries in a table can be selected** ([ADR-0040](docs/adr/0040-row-selection.md)),
with a checkbox per row and one in the heading for everything the view is showing.
A selection can be **copied** — as the same tab-separated grid a paste reads, so
copy-and-paste duplicates entries anywhere — **exported as a CSV file** of exactly
the rows on screen, or **moved to the trash**, where they can be brought back.
Selecting works without edit rights, since reading a table is when a copy is most
wanted.

**A table in the text can be made wide or full page**, like an image, and scrolls
sideways when it is wider than the room it has. **Its cells also read a step
smaller** than the prose around them — at the body size a narrow column wrapped
every second word.

**Fixed: a full-width table looked a few pixels too wide.** It was not the block —
the selection outline is drawn two pixels outside it, which is right inside the
column and wrong for a block that already reaches both edges. It is drawn inside
now, and the table's frame loses its side borders there for the same reason.

**Fixed: Column, Wide and Full page did nothing for a video, a table or a file.**
The setting only ever reached an image. A player or an embedded frame now runs to
the page's edges the way a picture does, capped so a wide video still fits on
screen.

**Fixed: changing a table's row height did nothing.** The height comes from the
padding inside a cell's controls, not from their minimum height, so the setting had
been adjusting a number that never decided anything.

**Fixed: a select column's option editor was cut off** at the edge of the table,
the same way the column menu used to be — a scrolling container clips both axes.

**A collection can be shown as a gallery** ([ADR-0039](docs/adr/0039-gallery-view.md)):
cards with a cover, switched to like the board. The cover is the first image in a
files column, and an entry without one gets a blank panel rather than a
placeholder. The offer to add one appears once the table has a files column. No
migration.

**A table's row height can be set**, under "Filter and sort" beside the rules it
belongs with: compact, normal or tall. It is the view's setting rather than the
table's, since the same entries can be a list in one view and an overview in
another — and compact still leaves a tap target on a touch device.

**Fixed: a table block had no handle.** Clicking the frame around a table now
selects the block, which is what brings up the ⋮⋮. It appeared for a moment after
inserting one and never again, because inserting is the only thing that had been
selecting it. Clicks inside the table — cells, views, buttons — are still the
table's own.

**A video block can be reached by its handle.** Clicking beside the player selects
it, which is what brings up the ⋮⋮ — and with it the width and the card and link
forms. Clicking the player itself still plays it.

**Fixed: favourites from other workspaces appeared in the sidebar**, where they
could not be opened — and the refusal said "you no longer have access to this
page", which was not what had happened. The sidebar now asks for the favourites of
the workspace you are in.

**Fixed: a video block was deleted moments after being added — by another open
tab** ([ADR-0039](docs/adr/0039-client-schema-refusal.md)). A page open in a
browser that predates a block type does not ignore that block: it removes it from
the shared document, for everybody. Such a client is now refused with an
instruction to reload, instead of being allowed to delete writing it cannot draw.

**Operator note: after this upgrade, every open tab must be reloaded** before it can
edit again. That is the fix working.

**Fixed: a video disappeared moments after being added.** Its block was the one
piece of content that did not take itself out of the editor's editable region, so
the browser treated the player as text it could edit — and removed it.

**An upload in progress says so.** A video is the first thing SONE sends whole — a
photograph is shrunk in the browser first — so eight megabytes was seconds of
silence, which is indistinguishable from nothing happening. The picker also offers
every format the server will actually store, rather than a shorter list.

**An entry can be moved to another workspace** ([ADR-0038](docs/adr/0038-move-between-workspaces.md)),
with everything under it: "Move to a workspace…" in an entry's menu. It offers the
workspaces you own or administer, then says what the move will cost before it does
anything — how many entries and files move, how many will arrive without the
restriction they have now, how many share links stop working, how many links to
entries left behind are severed.

**The `/` menu has a mark beside every block**, and **fixed: its highlight
sometimes ignored the mouse.** Moving the pointer inside a row now moves the
highlight to it — before, only arriving in a row did, so pressing the arrow keys
or scrolling left the highlight elsewhere with the mouse sitting on an entry that
would not light up.

**Video** ([ADR-0037](docs/adr/0037-video.md)). Type `/` and choose Video: upload
one, paste a link from YouTube, Vimeo or PeerTube, or point at a live HLS or DASH
stream. Content width by default, and the ⋮⋮ menu offers full width, a card or a
single line — a stream is a player only.

**An embedded video loads nothing from its provider until you press play.**
Opening a page that contains one tells YouTube nothing.

Nothing is converted: a video is stored as you sent it, and the upload says at the
moment you choose the file whether this browser could play it — an iPhone `.mov` is
usually HEVC, which Safari plays and other browsers do not. A live stream plays in
Safari and iOS; other browsers say so and offer the address.

**Downloads are resumable, and no longer read into memory whole.** A file is
streamed and byte ranges are answered, which is what makes seeking in a large file
possible at all — the groundwork for video ([ADR-0037](docs/adr/0037-video.md)) and
an improvement to every large download on the way.

**Fixed: the mark on the settings switcher was drawn the width of the column.**
Two icons in the set had no size of their own and filled whatever they were put
in; a stylesheet happened to size them in the sidebar.

**The settings columns carry your account menu too**, so the trash, the other
settings areas and signing out are one click away from anywhere rather than back
through the notes. **Fixed on the way: that menu did not close when you clicked
outside it.**

**The workspace settings say which workspace**, under the area name in the
switcher. "This workspace" is true of all of them.

**The settings screens have a switcher at the top of the column**, in the place
the workspace switcher occupies in the application and looking exactly like it —
holding the three areas rather than workspaces. Getting from the instance's
administration to your own profile no longer means leaving the settings and coming
back in.

**The settings screens look like the rest of the application**: the section is
white paper, the list beside it carries the same faint tint the sidebar does, and
the cards and framed tables are set off from the page again. They had kept the old
arrangement — tinted page, white list — after everything else was turned over.

**A misspelled search offers names that are close** ([ADR-0036](docs/adr/0036-search-typo-tolerance.md)).
"Testordnr" found nothing at all before. Suggestions appear under their own
heading, only when the search itself found little, and only for names — a typo in
the middle of a page's text still finds nothing. No operator action; one migration
enables `pg_trgm` and indexes titles.

**Your profile and your password are two settings sections** rather than one long
one. Signing in is where single sign-on and a second factor will go.

**Workspaces can be reordered from the keyboard**: `⌥↑` and `⌥↓` on a row in the
switcher. Dragging was the only way before, which left anybody not using a pointer
with no way at all.

**Pasting more than fifty entries says how many were left over**, and says it as a
note rather than an error — fifty went in, and the rest is still on the clipboard.

Nothing else an operator or a reader would notice: `pnpm lint` runs for the first time
(it was in the scripts and had never had eslint installed or configured), and the
architecture records now say which decisions are actually implemented — nine of
them still said "not yet" long after they were.

## 0.3.0

Everything a workspace needs to be shared with somebody: accounts, invitations,
groups and per-page permissions — and a great deal of work on how the thing looks
and reads while using it.

**Operator action: none.** Sixteen migrations apply on start. The document schema
and the sync protocol are both still version 1, so an older client keeps working
against this server and a client from this release keeps working against an older
one.

Two settings are worth knowing about, both optional and both with sensible
defaults: `SONE_WORKSPACE_RETENTION_DAYS` decides how long a deleted workspace can
be restored, and `SONE_OIDC_CLIENT_SECRET` is what turns single sign-on on. Both
are documented in `docs/deployment.md`.

**Operator note:** a folder that carried a collection becomes an ordinary folder
again and keeps its pages. The columns are not converted — the shape existed for
one release, and converting it faithfully would mean rewriting every child
document.

### Collections in a page

**A collection is content in a page, not a folder.** 0.2.0 made a folder *be* a
table and put every row in the sidebar; a folder stopped meaning one thing, and a
hundred-row table meant a hundred sidebar entries. A page can now hold
collections — several, as in Craft — and a folder is a folder again.

**Rows are documents that are not in the tree.** Each one is a real page you can
open, with its own writing, and none of them clutter the sidebar. Craft and
AppFlowy both work this way; [ADR-0021](docs/adr/0021-collections-in-pages.md)
records why.

**A collection can be placed in the text.** Type `/` and choose "Table of
entries": the collection is created and a block for it appears where the caret
is, between paragraphs, as in Craft and AppFlowy. Several per page.

**Fixed: "Add columns" appeared to do nothing.** The collection was created and
nothing displayed it — the folder's row was never marked as one, because that
mark was read from a document field that nothing writes. Every collection made
since the feature shipped was invisible.

**Filters and sorting can be set.** The button beside a collection's views opens
them, and says how many rules are active rather than only "Filter" — a table
showing fewer rows than expected is the kind of thing people blame on the
software. The work happens in the database, as it already did; what was missing
was any way to reach it.

**A collection can be searched.** The box beside its views matches an entry's
title or anything in its cells, and narrows whatever the view already showed
rather than replacing it. Substring matching, not stemming: typing "plan" finds
"planning" and "unplanned", which is what a table's search box is expected to do.

**Two corrections in a collection's table.** The title column now says it is
fixed rather than simply lacking the bin every other column has, and the menu
for choosing a new column's type opens towards the empty space beside the table
instead of back across the rows it is about to add to.

**Fixed: the maintenance log reported every collection row as a misplaced
entry.** A row lives inside the page holding its collection by design
(ADR-0021), and the check predates that. It was logged every five minutes.

**A table can be filled by pasting** ([ADR-0034](docs/adr/0034-collection-table-editing.md)).
Copy a selection out of a spreadsheet, click an entry's name and paste: each line
becomes an entry and each column fills the column you pasted into and the ones to
its right. Up to fifty at a time — and a second paste is **added below** rather
than replacing what is there, so more than fifty is two pastes. Add the columns
first; a paste fills columns that exist and never invents one, because guessing a
column's type from data is how a PIN loses its leading zero.

**An entry's name is edited in the table**, with a small control at the end of the
cell to open its page. Filling the first column no longer means leaving the table.

**Undo and redo for a table**, and a button that moves every entry to the trash —
where "to the trash" is literal: an entry is a page, so nothing is destroyed and
everything can be restored.

**The menu for adding a column looks like the rest of the menus**, and names each
column type with an icon as well as a word. It had a frame and a type scale of its
own, and after being moved out of the table it inherited the page's font — so it
read as belonging to a different application.

**Fixed: the menu for adding a column to a table was cut off.** It opened inside
the table's own scroll area, which clips, so the column types below the fold could
neither be read nor chosen.

**A table column can hold files** ([ADR-0035](docs/adr/0035-files-column.md)) —
one column type for every kind, not one for images and another for PDFs. An image
shows as a thumbnail, anything else as its name; up to eight per cell, and each
one opens in a new tab. A file added here belongs to the entry's own page, so it
is reachable exactly as far as the entry is. No migration.

**Fixed: a table disappeared and a new one could not be added.** Introduced while
the paste work above was being built, and visible only once a page had loaded —
which is why the tests did not see it.

### Files, images and documents

**Documents can be uploaded, not only images.** Word, Excel, PowerPoint,
OpenDocument, PDFs, text and archives. PDFs and text are shown in place; a Word
or Excel file is offered as a file, because nothing here can render one and a
card that says what it is beats a viewer showing an error.

**Documents are a content element.** Type `/` and choose "File": a PDF or text
file opens as a viewer with its own scrollbar, and anything else becomes a card
with its name, type and size. Each block switches between card, one line, and —
where a browser can draw it — a viewer.

**Changed: a PDF is now shown in place** rather than downloaded. The earlier
caution was not wrong — a PDF viewer is a large attack surface — but a notes tool
where a PDF cannot be read is one where people keep their PDFs elsewhere. The
hardening that makes it acceptable is unchanged: the type comes from the bytes,
never the upload, and the response carries `nosniff` and a sandbox policy.

**Fixed: a PDF would not display.** The viewer frame was sandboxed, and
Chromium's built-in PDF viewer does not run in a sandboxed frame at all — first
it showed only page one, then Brave refused to show anything. PDF frames carry
no sandbox now. What keeps that safe is unchanged and stricter than it sounds:
the type is decided from the file's bytes rather than from the upload, `nosniff`
stops the browser reconsidering, and the document is served with permission to
load nothing at all.

**Fixed: a file with an umlaut in its name could not be opened.** Serving it
threw while writing the `Content-Disposition` header — HTTP headers carry only
ASCII — and the viewer showed an internal error where the document should have
been. Every file with an accent, an umlaut or a CJK character in its name was
affected. The name is now sent both ways RFC 6266 allows: a plain ASCII form
any client understands, and the real name UTF-8 encoded.

**A file block has a menu**: open in a new tab, download, and how to show it —
card, one line, or a viewer. The name itself opens anything a browser can draw
and downloads anything it cannot, so the common case needs no menu at all.

**Fixed: a file block's menu stayed open.** Its stylesheet set `display`, which
beats the browser's own rule for `hidden` — so the element carried `hidden` and
rendered anyway. No event handling could have fixed that, and the first attempt
tried.

**Files can be dropped onto a page**, several at once, and they land where they
were dropped. An image becomes an image block as it always did; anything else
becomes a file block.

**Fixed: a file card's menu sat below the card** rather than at the end of its
first line, where the other displays put it.

**Fixed: an image, a file or an embedded table had no drag handle.** A block
that cannot hold a text cursor was invisible to the gutter, so the ⋮⋮ menu — and
with it width, alignment and moving the block — could not be reached for any of
them.

**A file's actions moved into the ⋮⋮ menu**, where every other block's settings
already are — opening, downloading, and whether to show it as a card, one line
or a viewer. The `···` button on the block is gone.

**Fixed: no drag handle on a touch device.** Tapping a file now selects it, so
the ⋮⋮ handle appears — there is no hover on a phone or tablet to fall back on,
and the block was swallowing every tap. The gutter is also fully visible there
rather than half-faded, which had read as disabled.

**Fixed: the ⋮⋮ handle appeared at the top of the page** for an image or a file
instead of beside the block.

**An image is offered two widths instead of three**, and full width now reaches
the edges of the page. "Column", "wide" and "full" all read as the width of the
text give or take — three names for one thing.

**An image can be shown as a card or a link**, not only as a picture — the same
three layouts a file has, because an image is a file with a special way of being
drawn.

**Fixed: the ⋮⋮ controls vanished over a full-width image.** They sit beside the
block, which is empty margin beside a paragraph and a photograph beside a
full-width image. They carry their own background now.

**Fixed: a full-width image pushed the page sideways.** "Full page" meant the
window, sidebar included; it means the page's own area now, and the page cannot
scroll horizontally at all. A full-width image runs to both edges with no
corners and no border — a block with no ends does not need them marked.

**Large images are shrunk for display.** An uploaded photograph is stored as you
sent it and shown at a size a page can use; the ⋮⋮ menu offers "Download the
original" beside "Download" ([ADR-0029](docs/adr/0029-image-variants.md)).

### Who wrote what

**Attribution is being recorded.** Every editing session by a signed-in member
is now mapped to that person in the document, which is what makes "who wrote
this" answerable later. Nothing displays it yet — recording starts first because
attribution is not retroactive
([ADR-0022](docs/adr/0022-attribution.md)): an edit made before the mapping
exists can never be attributed.

Share-link guests are not recorded: there is no user id to record against, and
attributing to "a guest" would make one contributor out of several people.

**A "People" tab lists who has written in a page** — everyone who has, whether
or not they are here now, which is what the circles at the top show instead.
Somebody who has since left the workspace stays in the list: they wrote what
they wrote.

**Choosing somebody in the People tab marks what they wrote.** Choosing them
again clears it. Only writing recorded since attribution began can be marked —
it is not retroactive.

**The chosen person in the People tab is cleared when you open another page.**

**Attribution is pruned.** When nothing of somebody's writing is left in a page,
their entry goes with it — deleted text should not keep a name in the record
([ADR-0022](docs/adr/0022-attribution.md)).

### Access: permissions, groups and protected sections

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

### Accounts, invitations and single sign-on

**Everybody has a workspace of their own.** Created with the account, always —
including for existing accounts, which get one on upgrade. Somebody invited to a
team now lands in both ([ADR-0025](docs/adr/0025-personal-workspaces.md)).

**Fixed: every account created through sign-up became an instance
administrator.** Only the first one does now.

**Invitations are two things now.** An invitation to the instance creates an
account and nothing else — the person lands in their own workspace. An invitation
to a workspace works for people who already have an account, which previously had
no path at all.

**Invitations have an API at all.** They existed in the server's domain layer
since the authentication work and nothing ever exposed them, so in practice the
only way into a workspace was to be there when it was made.

**Invite people to the instance** under Settings → Invite people. They get an
account and a workspace of their own; adding them to a team is a separate step.

**An invitation followed while signed in now asks whether to join.** It used to
do nothing at all: the sign-up screen only appeared for people without an
account, so somebody who had one landed in their own workspace with no sign the
link had meant anything.

**Invite somebody to a workspace** under Settings → Workspace. Works whether or
not they already have an account: with one they are asked to join, without one
they register first and end up in both their own workspace and yours.

**Fixed: accepting an invitation left you in your own workspace** rather than the
one you were invited to — a member of a team, looking at nothing to do with it.

**Fixed: creating an account from an invitation ended on an error.** Registering
uses the invitation, and the page then looked the same token up again, found it
spent, and reported a failure — after everything had worked.

**Single sign-on.** Set `SONE_OIDC_CLIENT_SECRET` and configure the issuer in the
administration area under Settings → Single sign-on; the sign-in page then offers
a button beside the password form. One OIDC client rather than an integration per provider, so Keycloak,
Authentik, Zitadel, Entra, Google and the rest are a configuration
([ADR-0024](docs/adr/0024-oidc.md)). Password sign-in stays. One OIDC client rather than an integration per
provider, so Keycloak, Authentik, Zitadel, Entra, Google and the rest are a
configuration ([ADR-0024](docs/adr/0024-oidc.md)).

**Invitations you have sent can be seen and withdrawn.** Both invitation forms
produced a link and then forgot it, so one sent to the wrong address stayed valid
until it expired and nothing said it existed. The list sits under the form it
belongs to — This workspace → People, and Administration → Invitations — and shows
who each is for, how often it has been used and when it expires. The link itself
is never shown again: only a hash of it is stored, and a list that reprinted them
would turn "who can open this screen" into "who can join".

**A workspace's owners and administrators can manage their own members**, under
This workspace → People: roles, removing somebody, and inviting. It needed the
instance-wide right before — not because the server asked for it, but because the
table only existed inside the administration screen. Every member sees the list;
those who may not change it read it.

### Settings, your account and administration

**Settings are in three named areas** — You, Workspaces, Instance — and every
entry says in one line what is inside it. The two invitations are now told apart
by name: one gives an account, the other puts somebody in a team.

**A right for managing workspaces**, granted per account under Settings →
Accounts, with a way into the workspace list from the workspace switcher: create, edit, invite
to and delete workspaces, and set who is in them. Not accounts, not single
sign-on, not maintenance — and not reading anybody's pages
([ADR-0027](docs/adr/0027-administration-areas.md)).

**Every workspace in one list**, with people, pages and when each was last
edited — and open one to change
what people may do there, remove them, or invite somebody. Personal workspaces are counted and folded away, so a hundred accounts
do not read as a hundred teams.

**A workspace can be deleted** from the list, by typing its name. It stops
appearing to everybody in it and can be restored for a month, after which the
maintenance job removes it. `SONE_WORKSPACE_RETENTION_DAYS` changes that.

**Settings is a screen of its own**, with its own navigation and a way back to
your notes — not a page inside the workspace with a sidebar of pages beside it.
The entries are names now; the explanation is on each entry rather than under it.

**Your account is editable.** Change your name, and change your password without
signing out. Settings → Account.

**Settings pages have structure.** Controls that belong together sit in a card,
each row says what it is and why, and space between cards separates one topic
from the next.

**Every settings panel got the same rhythm** — field names read as names, the
sentence under one is quieter than both, and consecutive fields are a list
rather than a paragraph.

**Appearance and Where you land are in cards too**, and each choice now says
what it does rather than only what it is called.

**Every settings panel now shares one shape** — cards of labelled rows for
settings, and the same frame around the tables that list workspaces and groups, each row saying what its
setting is for and where its value came from.

**Fixed: settings labels wrapped one word per line** and the page was cropped to
a narrow strip.

**Settings work on a phone.** The list and the section are two views rather than
one stacked on the other, so a section gets the whole screen instead of scrolling
in whatever the menu left over.

**Profile pictures.** Choose one under Settings → Account; it is shrunk in your
browser before it is sent, and shows in the sidebar and beside your name.

**Your picture opens an account menu** — edit your profile, settings, trash,
sign out — instead of a row of icons.

**The foot of the sidebar is a row of tools** — your account, trash, settings,
sign out — instead of three lines of text competing with the pages above them.

**Settings are three places instead of one list** ([ADR-0032](docs/adr/0032-three-settings-areas.md)):
your own settings, this workspace, and — only if you administer the instance —
the instance. The account menu had two entries that landed on the same page; it
now has one per area. **Two sections come back with this: a workspace's
typography and its groups had fallen out of the navigation and could not be
opened at all**, which is where the per-workspace font sizes went. Old
`/settings/…` links are redirected to wherever their section now lives. No
operator action.

**SONE opens where you left off.** Each workspace remembers the page you were
last on, and you can choose a fixed one instead under Settings → Where you land.
It applies on sign-in, on a workspace switch, and whenever SONE is opened without
a page in the address.

**Fixed: switching workspaces opened a page from the one you left.** The tree
was still the old one for a moment, and the root redirects to its first page —
so the server refused it, correctly, to somebody who had only pressed a switcher.

**Fixed: switching workspaces still reported no access.** The connection
reconnects on a switch, and a page opened against the old one is refused —
correctly, about a moment that had already passed. A refusal is only shown once
the connection has settled.

### Workspaces

**Drag your workspaces into the order you want.** The switcher was alphabetical,
which is nobody's order; now you arrange it and it stays that way
([ADR-0031](docs/adr/0031-workspace-order.md)). Press and hold a row on a touch
device, or just drag it with a mouse. The order is yours alone — arranging your
list does not change anybody else's — and the first workspace is the one a
browser with nothing remembered opens, so dragging the one you live in to the top
makes it the one you land in. No operator action: the migration runs on start,
and a list nobody has arranged stays alphabetical until somebody does. Reordering
is a drag only; there is no keyboard equivalent yet.

**Fixed: a workspace marked for deletion still appeared in the switcher**, so it
offered somewhere to write that the rest of the interface had already taken away.

**Fixed: the switcher panel was wider than the sidebar** — it sat hard against
the page on one side, kept a gap on the other, and its rows stepped to the right
of the button that opened them. Both of its edges are now the sidebar's edges,
and the marks stay on one line.

**Dragging a workspace now shows which workspace you are dragging**, the way the
page tree does — the two lines said where it would land and nothing said what was
moving.

**Fixed: the workspace button was 8px narrower than the menu that drops out of
it.** The sidebar's collapse button is hidden on a wide screen and its container
still took up a gap.

### Search

**Search finds a part of a word, and a result says what it found**
([ADR-0033](docs/adr/0033-search-results.md)). Typing "testordn" now finds
"Testordner"; the last word you type matches as a prefix while the earlier ones
stay exact. Each result is a card with its own icon, whether it is a page or a
folder, the path to where it lives, and the passage that matched with the match
marked — and clicking it lands on that passage rather than at the top of the
page. Typos still find nothing; that is a separate change. No operator action and
no reindex.

### The right panel

**The right panel lists the files, images and links in the page.** Files and
links open from the list, with a control on each row that goes to where it sits in
the page; images are thumbnails, and clicking one takes you to it. **The tabs are
icons now** rather than words, so there is room for the three new ones — each
still says its name when you hover it, and the chosen one is named above the
panel.

### How it looks

**The interface is built on design tokens.** Colours are named for what they are
for rather than what they are, and a theme is a list of values rather than a set
of overriding rules — so a third one becomes a block to fill in
([ADR-0028](docs/adr/0028-design-tokens.md)). Light and dark look as before; this
is the layer everything after it stands on.

**Headings are thin and larger.** The same emphasis by other means: size carries
the weight rather than stroke width, so a heading reads as a change of level
rather than an announcement.

**Fields, buttons and menus share one treatment.** A field is a surface that
gains a border when focused; buttons come in three weights; everything that
floats has the same surface, border and lift.

**Fixed: checkboxes and radio buttons rendered as full-width blue lozenges**, and
the settings navigation was centred down the middle of its column.

**The areas are separated by surface rather than by lines.** The rule between
sidebar and content is the faintest one available.

**Fixed: the page heading was drawn as a text field**, and the four marks at the
foot of the sidebar stacked instead of sitting in a row.

**Fixed: the ⋮⋮ handle covered the menu it had just opened**, on a tablet — and
swallowed the tap meant for the first entry.

**Fixed: paragraph spacing was the browser's, not ours.** Six styling rules were
written for a class the editor does not emit, so they matched nothing and
paragraphs fell back to a default margin that sat oddly beside headings with
deliberate ones. That is the uneven spacing that was reported.

**A workspace can have its own defaults for how elements look** — size, colour
and spacing per element kind. It fills the gaps a block leaves rather than
overriding: a block that carries its own setting keeps it, and one that does not
follows the workspace, including when the workspace changes later.

Stored per workspace and set by owners and admins. Nothing is written into
documents, and a workspace with no theme renders exactly as every workspace did
before. Set it under Settings → Appearance defaults. Every control offers "As designed",
which removes the setting rather than storing the value it currently equals — so
a workspace that has chosen nothing keeps following the design as it changes.

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

**Folders and pages can carry an icon**, with a colour for the icon and a
separate one for the name. A curated set of Lucide line icons, which match the
rest of the interface. Choose one from the ⋮ menu beside any entry.

**A workspace can have an icon and colours of its own**, chosen under
Settings → All workspaces with the same controls entries use ([ADR-0030](docs/adr/0030-workspace-appearance.md)). The switcher is
one line per workspace: a mark, a name, and the number of people only where there
is more than one.

**Fixed: the workspace switcher stacked its icons above the names** and centred
both. Its rows are now cards with the mark first, and the button lines up with
the search field below it.

**Fixed: choosing a workspace icon reloaded the page and looked as if nothing had
been saved.** It had been; the panel was thrown away and the list showed no
marks. The panel stays now, and the list shows the mark.

**Fixed: a workspace's name colour was saved and never shown**, and a colour
picked from the palette did nothing at all while a custom one worked.

**The writing is on white and the furniture is tinted**, where it used to be the
other way round. The sidebar, the top bar and the right panel now carry a very
slight warm tint — about two per cent — and the page itself is the brightest
thing on screen, which is the way round every tool people already use has it, and
the way round paper has it. Nothing changes in the dark theme: it already had
this relationship, and now both themes say so in the same words.

**A folder and a page are titled the same way**, and both show the icon and
colours you chose for them. A folder's name was bold and smaller than a page's,
and both drew the default icon for their kind — so decorating a folder changed
the sidebar and left its own page looking undecorated. The icon sits above the
name rather than in front of it, so the name stays on the column the text below
it lines up on. The entries listed inside a folder show their own icons too.

**Fixed: the ⋮ button on a sidebar row did not light up under the pointer**,
while the + beside it did, which made it look like nothing would happen.

**Editing a title is a line under the words rather than a box around them.**
Clicking a page or folder name turned it into a filled input the width of the
page, which read as a dialog opening instead of a caret being placed. The line
also appears faintly under the pointer, so a title says it can be edited before
you click it.

**The icon sits in front of a page or folder name again**, not above it, and the
heading no longer moves when you click it. A folder's name was a button that
became an input, and the swap changed the heading's height enough to nudge
everything below it down. It is the same input a page's title is now, so there is
nothing to swap.

### Writing and blocks

**Every block can be configured** from the ⋮⋮ menu: alignment, width and colour,
showing only the settings that mean something for that block. A wide paragraph
is just a harder-to-read paragraph, and an image has no colour to set.

**Blocks carry presentation: alignment, width and colour.** Three attributes
shared by every block type rather than a setting per kind, so a new block type
gains them for free. Width breaks out of the reading column — useful for an
image or a table, and ignored on a narrow screen where there is no margin to
break into.

The controls for these come next; this is the model and the styling.

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

**Fixed: empty lines appeared on a page every time it was opened.** A document is
empty until the server's copy arrives, and the editor was writing an empty
paragraph into that emptiness on every visit — one per open, appearing anywhere in
the page depending on how the two edits merged. Existing stray lines are ordinary
empty paragraphs and can be deleted; no new ones will appear.

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
