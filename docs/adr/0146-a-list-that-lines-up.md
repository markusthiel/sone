# ADR-0146: A list that lines up

## Status

Accepted. Built. Closes the first half of a report from an iPad; the second half
(Einladungen) is its own record.

## Context

> Bei Konten ist noch ein bisschen durcheinander, da könntest du die checkboxen
> und Inputs noch strukturieren und überhaupt ordentlich aufbauen. Auf den
> anderen Seiten sind die Felder zb rechts.

An account's row put four controls in one wrapping flex strip with
`justify-content: space-between`: two checkboxes that say what the account *is*,
and two buttons that *do* something to it — one of them red. Three things follow
from that, and all three were in the screenshot.

A state and an action sat side by side at the same weight, so the row does not
say which of its controls change something the moment you touch them. The strip
wrapped wherever the width ran out, so a row with two buttons arranged itself
differently from the row above it. And nothing was a column: the switches of one
account were nowhere near the switches of the next.

The screen is also on the migration list from ADR-0041, and half of this row was
English — `Administrator`, `Manages workspaces`, `Deactivate`, `no address`,
`share-link guest`, `N workspaces`. The guard that is supposed to catch exactly
that reads text that follows a `>`; these labels follow a `{' '}`, and the
button's two words are a ternary. So the file has been on the list, and clean,
with eight English strings in it. **The hole is real and is not fixed here** —
it is 33 strings across 13 files, which is its own round.

## Decisions

### The grid is the list, not the row

A grid per row is the obvious spelling and it aligns nothing: every row sizes its
own tracks, so an account with one button puts its switches three hundred pixels
from the switches of the account below. That is tidier than a wrapping strip and
still not a column, which is what was asked for.

Tracks are shared by being one grid. So the list is the grid, the rows are
`display: contents`, and every account's three cells are cells of the same grid.
The row has no box any more, so its padding and the rule under it are drawn by
its cells.

### Three columns, and the middle one has a width of its own

Who they are, what they are, what can be done to them.

The switch track is a fixed `12rem` rather than content-sized, so translating a
catalogue or lengthening a name does not move the column. The name track has a
floor and may take the rest; the button track may shrink below its content, so
buttons wrap rather than push the list past its frame.

That order matters and was got wrong first: with a name track that may shrink to
nothing beside a button track that may not shrink at all, the name came out
93px wide at 810px while „Zwei-Schritt-Anmeldung entfernen" kept all 435 of its
pixels. The columns have to give in the other order.

### The empty column is drawn

A guest has no rights to grant, and its row still draws the group. Leaving it out
would let that row's buttons slide into the column where every other row's
switches are — ragged exactly where raggedness was reported. Stacked, where there
are no columns to align, the empty group is hidden instead.

### Below 60rem it is a stack

Measured, in German, which is the language that decides it: 14rem of name, 12rem
of switches, 435px of buttons and six paddings want about 900px, and the settings
body is that wide at roughly 950px of window. 60rem is the nearest width already
in the file — a twentieth breakpoint for one list is worse than eight pixels.

## Consequences

**Seven tests, all red first.** Five on the mounted row — the two groups, the
empty column, the German labels, the form of address, the plural — and two on the
stylesheet.

**Four faults were found by measuring in a browser, not by reasoning**, and each
one passed every test in the tree at the time:

1. The narrow layout never applied. The override was written in the settings
   area's own `620px` block, five thousand lines before the rule it overrides,
   and a media query adds no specificity — at 560px the row was still in three
   columns. **This is ADR-0144 exactly**, with `grid-template-columns` instead of
   `color-scheme`. The block now sits directly after what it overrides, and the
   test asserts that order rather than the rule alone.
2. The tracks did not align between rows — the per-row grid described above.
3. `column-gap` broke the rule under each account into three pieces with two
   holes in it. The space between columns is cell padding now.
4. `align-items: center` on the list gave each cell a box the height of its own
   content, so those three pieces sat at three heights and the line had steps in
   it. Cells stretch; their contents are centred.

**Nine messages, in both catalogues.** The counted one is a plural rather than
`workspace${n === 1 ? '' : 's'}`, and „du"/„Sie" reaches the row through the same
`select` every other German message uses.

**The line of facts under a name is joined, not concatenated.** It was four
fragments with a leading „ · " baked into three of them — a sentence a translator
cannot reorder.

**`.admin-row` is untouched**, and still draws the trash list and the maintenance
failures. This record is about accounts; the other two lists are two buttons and
a name, and the fault reported here is not in them.

## Alternatives considered

**A header row and bare checkboxes.** A real table, and twenty rows of repeated
labels become two. It breaks at exactly the width the report came from: stacked,
a checkbox with no label beside it is a checkbox with no label.

**The rare actions behind a row menu.** The row becomes a name, two switches and
a `…`, and every column is narrow and stable. It is a change to what is clickable
rather than to what is drawn, it hides a destructive action one level deep, and
the report was about arrangement. Worth keeping in mind if a third button ever
arrives.

**A fixed width for the button column too.** Then rows align without
`max-content`, and every English instance pays for the longest German label in
empty space.

**Keep one flex strip and only reorder it.** The switches and the buttons would
still be one line of four things at one weight, and one line is what wraps.
