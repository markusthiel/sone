# ADR-0069: One rule for the whole shell

## Status

Accepted. Stages one and two are implemented; the rest is named at the end.

## Context

ADR-0068 added a rail because the mark needed somewhere to live that was not
the top of a column that collapses. It held three destinations and it worked,
but it had no idea behind it: it was a menu that happened to be vertical, and
"what else goes on it?" had no answer except taste. A rail without an answer to
that question collects icons until it is a drawer.

Meanwhile four screens — settings, the workspace list, a workspace's settings,
the administration — return before the shell is even rendered, so going to any
of them takes the whole frame away and brings a different one back.

## Decision

Three columns, and each of them has exactly one job.

**Column one picks the mode.** Where you are in SONE. The mark is the tree's own
mode — where you are when you are not anywhere else — and the named ones follow
it: workspaces first, because it is the largest container and decides what the
tree below it even contains, then what is waiting for you, then what you threw
away. The account sits at the foot, apart, because it is not a mode.

**Column two navigates.** A page tree, a menu of views, a list of sections.
Never the content itself.

**Column three shows** whatever column two selected.

That is the whole rule, and it settles the questions the rail could not answer
before. The notifications do not go in the panel — their *menu* does, and the
notifications are content. A mode that arrives later has to answer two
questions and no others: what navigates, what shows.

### A mode is a place you stay, not an action you take

Four and an account. Anything else has to fit inside one of them or it is not a
mode. The trash is the weakest of the four by this test — it is visited rarely
and costs a permanent slot — and it is here anyway, because it is the only
place that answers "where did that go?", and a rarely-needed place nobody can
find is more expensive than an icon.

Settings deliberately get no icon. A cog would have to mean three things at
once — yours, the workspace's, the instance's — and at that moment the rail
answers "what do I want to do" rather than "where am I".

### The panel's head is not decoration

The rail mixes two scopes. An inbox spans workspaces — ADR-0052 says its route
carries none — and a trash belongs to exactly one. Without a line saying which,
the same column shows two different worlds and looks identical doing it. So
every mode names itself and its scope at the top of the panel.

In the tree's mode that head **is** the workspace switcher. The switcher
therefore stays exactly where it has always been and stops being a special
case: it is this column's title, like every other mode's. The menu that used to
hang above the tree is gone; only the switcher remains, which is what it was
being used for.

### One account menu, drawn in one place

Above 800px it is at the foot of the rail; below, the rail is not drawn and it
sits at the foot of the panel with the modes. The shell builds it once and hands
it to whichever of the two can draw it. Two mounted copies would be two requests
for the same unread count and two answers that can disagree for a moment.

### The menus count what is already here

Every view in the inbox and the trash is computed in the browser from the list
the shell already holds — `kind` and `read` for one, `archivedAt` and `kind` for
the other. Nothing here needed a new endpoint, and that is why the counts can
sit beside the names: a menu that says "Mentions" without saying how many is a
menu you have to click to learn anything from.

It also means the menu and the list cannot disagree. They filter the same array
with the same function.

## Consequences

The sidebar is the panel: same element, same class, same drawer below 800px,
same draggable edge. Only its inside changed — a head that does not scroll, a
body that does, a foot that appears where the rail does not.

A third bug fell out of touching that element. `.sidebar` had no `position`, so
its draggable edge — `position: absolute` — resolved against the initial
containing block: measured at 1440px the sidebar ended at 316 and the handle sat
at 1436, a strip at the right edge of the *window*, eleven hundred pixels from
the edge it moves. It has a test for its markup and has never once been where
anybody would reach for it.

`useInbox` lifts the fetch above both columns. `Trash` and `InboxScreen` no
longer fetch or filter; they are handed what to show. `InboxScreen` lost its
own "unread only" checkbox — a filter drawn twice is a filter that can disagree
with itself, and the one in the panel is the one carrying the counts.

### Stage two: the four screens become content

`settings`, `workspaceList`, `workspaceSettings` and `admin` returned before the
shell rendered. They are content in it now, and three things fell out of that
rather than being designed:

**The area switcher is gone.** It existed because the settings covered the
application: a screen with no rail beside it needs its own way of saying "here
are the other two areas". With the rail always there, the three areas are three
groups in one list — the same information, without a menu you have to open to
discover that the other two exist. The workspace's group is titled with the
workspace's *name*, which also retires the second line under the area name: an
administrator opening somebody else's reads which one on the only line there is.

**The way out is gone**, because there is nothing to get out of. Each screen had
its own "back", at the top of its own navigation, for the same reason each had
its own account menu — it had covered everything. The mark does that job now and
is never not there.

**The phone's two-view mechanism is gone.** The settings screen flipped between
"the list" and "the section" with a `data-showing` attribute, its own state and
two handlers. The list is the panel now, and on a phone the panel is already the
drawer: it slides, it has a scrim, it closes on navigation. One mechanism where
there were two, and the surviving one is the one the rest of the interface uses.

What is left of `SettingsShell` is `SectionNav`: a list of groups, and
`resolveSection`. 274 lines became 69.

The workspace list keeps its table. The panel lists the workspaces to open one;
the table compares them — role, size, the deleted ones and their restore — which
is the distinction ADR-0067 already drew: six workspaces are read down a column,
not one row at a time. The panel navigates, the table shows. They are not two
ways into the same thing.

Deliberately not done here, in order:

- **Stage three.** The rest of what the two modes should be: grouping several
  replies in one thread into one row, a reading view beside a deleted page
  before you restore it, "restore to…" when the folder above is gone (the API
  already reports `parentMissing` and nothing uses it), keyboard handling.
- **Stage four.** The mobile bar, which takes the panel's foot's job; and then
  the things that need new endpoints — snooze, replying from a notification.
