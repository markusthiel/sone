# ADR-0118: Searching is a place after all

## Status

Accepted. Built. Asked for. Supersedes the "searching is not a place" half of
ADR-0074.

## Context

> Eine globale Suche: Symbol in der schmalen Leiste, Such-Oberfläche mit Filtern
> im linken Panel, Ergebnisse im Inhaltsbereich. Und das Suchfeld im Baum sollte
> ein Eingabefeld sein statt ein Link auf eine Suchseite. Wäre das machbar und
> sinnvoll?

**This project has already decided the opposite, in writing.** ADR-0069 sketched
a phone bar of "Seiten · Suchen · Posteingang · Du"; ADR-0074 rejected that set
and gave a second reason while it was there, which is still quoted in
`ModeBar.tsx`:

> Searching is not a place you are; it stays the labelled row above the tree,
> where it is at both widths.

There is a test asserting it (`assert.doesNotMatch(bar, /paths\.search/)`), and
another asserting that search appears in neither the mode list nor the account
menu. Both went red for this change, which is what they are for.

So the question is not "can this be built" but **what has changed since that was
right**, and something has.

### What changed is that a search became something to come back to

When "searching is not a place" was written, a search was a field and a list of
results. Nothing persisted, nothing was named, and there was nothing to return
to — so a mode for it would have been a room you pass through, which is exactly
what the rule "a mode is a place you stay, never an action you take" excludes.

Then **ADR-0050 added saved searches**: named queries, per person, per
workspace, that exist precisely to be run again. It put them inside the search
screen, under the empty field, with this reasoning:

> Here rather than in the sidebar: this is where somebody is when they want to
> run one again, and a third sidebar section is a decision about the sidebar
> rather than about searches.

That was an honest deferral and it names its own cost. It is a decision about
the sidebar, and it has been sitting there unmade ever since — with the visible
consequence that the list of kept searches **disappeared the moment anybody
typed**, which is the moment somebody comparing two of them wants it.

### And the filters had no controls at all

Six filters exist — `tag:`, `in:`, `author:`, `assigned:`, `after:`, `before:` —
and the only way to use any of them was to know the syntax and type it. The
screen draws chips saying what it *read*, so the vocabulary is discoverable
after the fact and not before it. That is a search that rewards people who have
read the documentation, in an application whose other screens do not.

## Decisions

### Search is a mode, in the one list

`modes.tsx` gains an entry, second, right after the tree. The rail draws it, the
mode bar draws it, `modeOf('search')` returns it instead of falling through to
the tree.

**In the one list, both drawings.** ADR-0072's rule is absolute for the reason
it was written: a mode left out of one drawing is a mode a phone cannot reach.
The cost is a seventh slot on the mode bar, and the labels there get tighter —
they already ellipsise at six, and the icons carry the meaning.

### But you still do not come here to start one

This is what makes it a place rather than an action, and it is the same
distinction the rule was protecting.

**The field above the tree is the entrance.** It was a labelled row that opened a
screen whose first control is a field, so the row was a door in front of a door.
It is the field now, and typing in it lands you in the search mode carrying what
you have typed. Nobody navigates to search in order to search; they type, and
find themselves somewhere with filters and their kept searches beside them.

So the rail's search icon is not "start a search". It is the way back to one.

### The panel navigates, the results show

ADR-0069's rule applied rather than bent. Narrowing a search *is* navigating
within it, and a saved search is a menu entry — which is the shape every other
mode has. The filters and the kept searches are the panel; the field, the chips
and the results stay in the content area.

**Keeping a search moved to the panel too.** The button and the list were in two
different columns for one round of this design, and a button whose result
appears somewhere else is a button whose result somebody misses. It also removes
the only reason the screen and the panel would have had to tell each other
anything.

### The query lives in the URL

One string, three writers: the field above the tree, the field on the screen,
and every control in the panel. A copy in component state would be a second
answer to what is being searched for, and the panel and the field would drift
apart the first time either was used.

In the URL rather than in the shell's state because **a search is a place**: it
can be linked to, and `parseRoute` has read `?q=` since the screen existed.
`replace` while typing and `push` on Enter — a keystroke is not somewhere to go
back to, and pushing one per character would bury whatever came before the
search under forty history entries, while a search somebody *committed* is a
place they should be able to leave and return to.

### `buildSearchQuery` in core, beside the parser

Every control parses what is in the field, changes one thing, and writes it
back. It does not compose `tag:` itself.

This is ADR-0050's own argument for putting the parser in core, with the halves
swapped:

> two parsers would eventually disagree about what somebody typed, which is the
> worst possible thing for a search box to be uncertain about

A writer that disagrees with the reader has a nastier shape than that: pressing
a tag in the panel would silently change something else in the field. The
round trip is tested, including the one case a template string at a call site
gets wrong — a tag whose name has a space in it.

**What could not be read is not written back.** `before:tuesday` is reported as
unreadable and struck through (ADR-0050); re-asserting it on every edit would
carry a filter the search has already refused through the rest of the session,
with no way to be rid of it.

### A workspace chooser in the head

Search is per-workspace — the server's search route takes a workspace id — so it
joins shares and the trash under ADR-0114's rule: a screen about one place must
name the place and offer a way to change it, or a correctly empty list is
indistinguishable from a broken one.

## Consequences

**Five core tests, seven mounted panel tests.** The mounted ones are where the
value is: what a source assertion cannot see is that pressing a tag *kept the
words beside it*, which is the whole of the filters-and-field contract.

**Three existing tests went red and were rewritten, not deleted.** They asserted
the decision this supersedes — search in neither list, no chooser on it, the
kept searches under the field — and each now records what changed and why. That
is the point of having written them down.

**No keyboard shortcut.** `Cmd-K` is the editor's link command and is not
available; picking a second-best chord for the application's most-used way in is
worse than the field being one click away, and the field is now the first thing
in the sidebar. Named here rather than done.

**The search is still one workspace's.** The rail icon reads as global and is
not. The chooser says which workspace, which is the same answer ADR-0114 gave
for the same shape of problem, and a genuinely cross-workspace search is a query
change rather than an interface one.

## Alternatives considered

**Leave search where it was and only make the row a field.** Half the report,
and the cheaper half. It would leave the six filters reachable only by typing
syntax, and the kept searches vanishing as soon as anybody types — which is the
part ADR-0050 had already noticed and postponed.

**A command palette over `Cmd-K`** — one field that searches pages, runs actions
and jumps between modes. It is a different feature with the same first
keystroke, and this one is a *place* while a palette is expressly an action. The
key is also taken.

**Filters as a bar above the results** rather than in the panel. It keeps the
panel free for the tree, and it puts controls in the column the shell reserves
for content — which is the rule ADR-0069 exists to hold, and bending it for the
first screen that finds it inconvenient is how it stops holding.

**Keep saved searches on the screen and put only the filters in the panel.** Two
halves of one subject in two columns. The list is the thing you navigate *to*;
it belongs with the other menus.

**A global search across every workspace.** What the rail icon suggests, and a
larger change than this: the search route, the index and the access filter are
all per workspace, and answering across them means either N queries or a
cross-workspace index with its own permission story. The chooser is the honest
interim, and it is the same one the shares screen carries.
