# ADR-0120: Two screens and a field

## Status

Accepted. Built. Asked for. The first step of the concept in
`claude/konzept-mail-und-gestaltung.md`, and deliberately the small one: it
prepares the screen the rest of that work lands on.

## Context

Two reports, both about arrangement rather than behaviour.

> Der Aufbau könnte noch ein wenig mehr Struktur haben, also Abstand, gleich
> große Input Felder, bei Leute ein Drop Down mit Suchfunktion anstatt einer
> Liste, die wird sonst irgendwann zu groß.

> Dazu sollte zunächst einmal der Bereich Typografie aufgeteilt werden. Ja,
> Schrift Design kann gerne alleine stehen, aber die Oberfläche, Tönung,
> Akzent-Farbe gehört da nicht hin.

Both are right, and the second is the one worth arguing about, because it is a
statement about what a theme *is*.

## Decisions

### A theme says two unrelated things, so it gets two screens

`Typografie` held three groups: the tint and accent of the whole interface, what
the eight colour names mean, and a table of size and spacing steps per element.
Only the third is typography. The first two decide what the application looks
like, which is a different question asked by a different person on a different
day.

**`typography` keeps its id.** `/workspace/typography` is a URL somebody may
have bookmarked, and a URL is a public contract (ADR-0016) — so the existing
section becomes the *type* half and the colours are the new `colours` section.
Nothing redirects, nothing breaks.

**One component, two views.** `ThemeSettings` takes `show: 'type' | 'colour'`
rather than being split in two. It is one theme with one fetch and one save;
two components would be two copies of the state, and a workspace whose surfaces
saved without its type is two requests racing to write one row.

This is the step the rest of the theming work needs: there is now a screen
called "colours and surfaces" for surface roles, density and the rest to arrive
on, instead of a fourth group under a heading that does not describe them.

### The people filter is a field, not a list

Every member was a row. Fine at four, unusable at forty, and the report says so
before it happens.

**Filtered in the browser, not fetched.** The members are already in hand for
this workspace; a request per keystroke would be a request for something already
loaded. Two characters before anything is offered and eight at most — the same
shape the picker on the members screen has (ADR-0119), because one letter
matching half a workspace is a list again.

**Whoever is chosen stays visible above the field.** A filter you cannot see is
a filter you cannot take off, and the field that chose them is empty by then.

**And they are called what they are called.** The filter is stored lowercased —
`author:` is a case-insensitive prefix match (ADR-0050) — so reading it straight
back put "By anna weber" on screen. The member list knows the name; when it
does, that is the one to show.

### One gutter per section, one width per field

Every control in a facet carried its own `padding-inline` or `margin-inline`, so
each new one arrived without it: a select, two date fields and a row of chips on
four different left edges. The gutter is on the section now, and the fields are
`inline-size: 100%` inside it — a margin repeated per control is a margin that
will be forgotten by the fourth one.

The date rows became label-above-field. Side by side, "Ab" took a fifth of the
row and the two fields ended up different widths, and on a narrow panel the
field shrank to where a German date no longer fits.

## Consequences

**Three new panel tests, one rewritten.** The rewritten one asserted that every
member had a row, which is the arrangement this replaces; it now asserts that
nothing is offered before two characters and that a chosen person can be taken
off again.

**`type.note` became two sentences**, because one screen's note cannot describe
two screens.

**Nothing about what a theme may contain changed.** This is the arrangement
only — the surface roles, density and instance branding from the concept are
still ahead, and this is the screen they go on.

## Alternatives considered

**Two components for the two screens.** Simpler to read and it splits the state:
two fetches of one row, two saves, and a race between them the first time
somebody has both open.

**Give the colours their own URL and redirect `typography` to it.** More honest
about the rename and it breaks a bookmark for the sake of tidiness. The id is
not shown to anybody.

**A `<select>` for the people filter** rather than a field with matches under
it. It is the control the report names — and a native select cannot filter as
you type, which is the half that solves the problem. What is built is the
picker pattern already in the codebase, so there is one of them rather than two.

**Fetch matching people from the server** as the members screen does. Right when
the list is the instance and wrong here: this list is one workspace's members,
it is already loaded, and it is bounded by how many people are in the workspace.
