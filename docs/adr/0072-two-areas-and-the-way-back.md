# ADR-0072: Two areas, and the way back

## Status

Accepted. Amends ADR-0070, which left your settings and the server's as two
groups in one column.

## Context

Three reports, and they turn out to be one shape: a list that has to hold
everything, and a way in that is not a way back.

**The settings column held two subjects.** ADR-0070 took the workspace out of
it, which was right, and stopped there. What was left was "Wo du landest" and
"Mailserver" six rows apart in one column under two headings — and both halves
are going to grow. The account menu had been calling them two things from the
start.

**On a phone there was no way back to your own pages.** The rail is not drawn
below 800px; its contents move to the foot of the panel. But the mark is not in
`useModes()` — it is drawn separately, above the list — so the foot got
workspaces, the inbox and the trash, and nothing for the tree. From settings, or
from a workspace's sections, a phone had no route back at all. One list drawn in
two places, and one of the two drawings was missing an entry.

**The mark did nothing.** It goes to `/`, which resolves "where you land". With
the default — the page you were last on — that is the page you are standing on,
so pressing the mark did nothing at all; with a fixed page it yanked you off
whatever you were reading. One setting was answering two different questions.

## Decision

**Your settings and the server's are two modes.** One column each, one group
each, and no group heading: the panel's own title says which area this is, and a
heading repeating it over the only group in the column says nothing. The scope
line under each title earns its place — "Nur für dich" against "Für alle auf
diesem Server", which is the fact that should be on screen when somebody changes
a mail server.

Neither gets an icon on the rail. Both are reached from the account menu, which
is where you already are when you are thinking about yourself or your server.

**The tree is an entry in `useModes()`, and the rail draws the first entry as
the mark.** Not a filter and not a special case: the rail takes the head of the
list and draws it large, the panel's foot draws the whole list, and a mode
cannot be missing from one drawing without being missing from the code that
feeds both.

**Arriving and pressing the mark are different questions.** Arriving — a fresh
load, a sign-in, a switch of workspace — means the landing setting in full,
including "the page I was last on". Pressing the mark later cannot mean that,
because you are on that page; it goes to the top of the tree instead, so the
mark always moves you somewhere. A fixed landing page is honoured in both cases:
somebody who named a page meant that page.

The state is per workspace rather than per session. Switching *is* an arrival in
the new workspace, and "the page I was last on there" is the reason people
switch back.

## Consequences

`Mode` gains `admin`. `modeOf` maps `settings` and `admin` to their own modes
rather than folding both into one, which is the whole structural change; the two
`SectionNav` columns follow from it.

`SectionGroup.title` is optional now. A column with one group has nothing to
title.

This does not add a mobile bar — that is still stage four of ADR-0069. What it
does is make the existing mobile mechanism complete, which is a different and
smaller claim: the drawer's foot is the rail on a phone, so it has to carry
every mode the rail carries. The bar, when it arrives, replaces that foot and
will take the same list from the same place.
