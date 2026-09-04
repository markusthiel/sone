# ADR-0071: A row is what you are dealing with

## Status

Accepted. Stage three of ADR-0069.

## Context

The rail gave the inbox and the trash a menu each, with counts, and gave each a
list beside it. Both lists were correct and neither was usable for the thing it
exists for.

The inbox listed notifications. Three replies in one conversation were three
rows saying nearly the same thing, and the fourth pushed the first out of sight
— so the list could not be read top to bottom, which is the only way anybody
reads an inbox. There was nothing to do with a row but open it: no way to
settle one without going to the page, and no way back from a row opened by
accident, because "read" was a one-way door.

The trash listed deleted entries. Thirty days of deletions with no search, and
one button per row that sometimes failed: an entry whose folder had been deleted
too was refused with `parent_missing`, correctly — a page put back silently
somewhere else is a page lost a second time — but nothing offered anywhere to
put it, so the entries most likely to be in the trash were the ones that could
not leave it. And the decision itself was being asked without the information:
"Notizen", deleted a fortnight ago, restore or destroy?

## Decision

**A row stands for the thing a person is dealing with, and carries what the
decision needs.**

### The inbox: a row is a conversation

Replies sharing a thread are one row — the newest passage, and how many there
were. Opening it settles all of them, because they are one thing to deal with.

Mentions and assignments never fold, even inside a thread. Being named is a
separate act addressed to you, and two of them are two things you were called
into rather than one thing repeated.

Grouping happens *after* filtering, or a thread straddling a read and an unread
notification would appear in the unread view carrying the read one with it. The
menu's counts count rows, not notifications, for the same reason the menu and
the list have always shared one function: a menu saying 7 over a list of 4 is a
menu that looks wrong.

**The keys are `j`, `k`, `e`, `u`**, and Enter opens. Moving is done by moving
the *focus* rather than by drawing a selection of our own — then Enter, scrolling
into view and the screen reader's announcement all come from the browser and
cannot disagree with what is on screen. After acting on a row, the row that
takes its place takes the focus, so working down a list is one key pressed
repeatedly; without that, `e` in the unread view works once and then does
nothing, because the row it acted on left. The keys are printed above the list,
because a shortcut nobody knows about is a shortcut nobody has.

**`u` puts a row back to waiting.** The route grew a `read: false`, by id only:
"mark everything unread" answers no question anybody has and would undo a
bankruptcy somebody declared on purpose.

### The trash: read it, then decide

**A search field**, above the views and narrowing all of them, folding case and
accents — somebody looking for a thing they deleted a fortnight ago
half-remembers its name.

**A preview**, from the projection the materialiser already writes for search:
`blocks.plain_text` in document order, forty blocks, and a line saying when there
is more. Nothing new is stored. Text only, never a rendering — a preview that
tried to be the page would be a second renderer to keep in step with the first,
and this one has one job: enough to recognise the thing. It is the only way to
read an archived entry at all, since it is not in the tree and the editor cannot
reach it.

**"Restore to…"**, which is the answer to `parent_missing` rather than a way
around it. The restore route accepts a target folder; the row whose folder is
gone asks where *before* it acts, because pressing a button and getting an error
is not an answer anybody can do anything with. The refusal stays exactly as it
was when no target is given — the rule has not changed, it has gained a way to
be satisfied.

## Consequences

Three server changes, all small and all additive: `read: false` on
`/api/inbox/read`, a new `GET /api/pages/:id/preview`, and an optional
`parentPageId` on `/api/pages/:id/restore`. The restore route validates a target
the same way every other write does — a live folder, in this workspace, that
this person may write in — and answers 404 for every failure, because a target
somebody may not see must not be distinguishable from one that does not exist.
Its own descendants cannot be offered: they are archived with it, so they are
not in the living tree the dialog lists.

The restore dialog is its own component rather than the move dialog. That one
asks `moveRules` which destinations are refused, and every one of those rules is
about an entry that is *in* the tree. Sharing it would have been sharing a
question with no answer rather than sharing a guarantee.

Found while writing this: the trash screen had four sentences built in code —
"deleted", "with N entries inside", "the folder it was in is gone", "Untitled
folder" — in an interface whose every other line is translated (ADR-0041), and
the workspace switcher wrote the English "Untitled" for a workspace with no
name. Both fixed here; both were only visible by reading the screen in German.

Still not done, and now the whole of what is left:

- **Stage four.** The mobile bar, which takes the panel foot's job; then snooze
  and replying from a notification, which need new endpoints and a place to put
  a reply.
- The inbox's remaining views — later, archive — and the trash's "empty it",
  which is a decision about a destructive bulk action rather than a listing.
