# ADR-0144: The shell is a frame

## Status

Accepted. Built. Fixes a reported fault — two scrollbars and an account picture
below the fold — and answers the request beside it: thin scrollbars.

## Context

Reported:

> Wenn der Seitenbaum viele Seiten enthält und deshalb sehr lange ist und der
> content ebenfalls viel Inhalt enthält habe ich ganz rechts 2 Scrollbalken. […]
> In dem Fall landet das Profilbild in der schmalen Leiste auch außerhalb des
> Sichtfelds.

Reproduced in Chromium before anything was changed, at 1440×900 with 200 tree
rows and 300 paragraphs, against the real stylesheet:

| | as shipped | fixed |
|---|---|---|
| `.sidebar` height | **6458px** | 900px |
| `.icon-rail` height | 6458px | 900px |
| the avatar's bottom edge | **y = 6452** | y = 894 |
| the tree scrolls | **no** | yes |
| the window scrolls | **yes** | no |

So the description was exact, including the part that sounds like a detail: the
window scrolls *by the length of the tree*, because the tree is what grew it.

### One declaration, written for a popup, decided the height of the shell

`.sidebar` says:

```css
/* Visible, and it has to be: the account menu hangs out of a 56px column, and
   with `hidden` here it was drawn and then cut off at the rail's edge — a menu
   that opens and shows you a slice of itself. */
overflow: visible;
```

A grid item's **automatic minimum size is zero only when its overflow is not
`visible`.** So that line, whose subject is a popup, also told the sidebar it
may never be shorter than its own tree. The row grew, the rail grew with it, and
the window took the scrollbar the tree should have had.

Confirmed four ways rather than argued: as shipped the window scrolls;
`overflow: hidden` on the sidebar stops it (and would cut the menu off, which is
the fault the comment records fixing); `min-block-size: 0` stops it and keeps
`overflow: visible`; and giving `.main` an `overflow-y: visible` makes *it* grow
to 11874px the same way.

### Two of the four columns were bounded by accident

`.right-panel` says `min-block-size: 0` out loud. `.main` never grew — but only
because it declares `overflow-y: auto` for its own sake, which zeroes the same
minimum as a side effect. **The page was held up by a line about scrolling**,
and would have stopped being held up the day somebody had a reason to change it.

### And the browser's own furniture was following the wrong theme

`:root { color-scheme: light dark }` means *the system decides*. That is right
for somebody who has not decided, and wrong for everybody who has: a dark
interface on a light laptop drew **light scrollbars**, a light select popup and
a light date picker. Nobody had reason to look at a scrollbar until this round.

The same shape as the three dark blocks (ADR-0135): a value set where the system
is asked and forgotten where the person is.

## Decisions

### Every column of the shell may be shorter than its contents

`min-block-size: 0` on `.icon-rail`, `.sidebar` and `.main`, matching the panel
that already had it. One line each, and the sidebar's carries the reason,
because the line above it is the one that took the property away.

The rail needs nothing today — nothing in it is tall. It is written down anyway:
it was 6458px tall because the column *beside* it could not shrink, and a column
that cannot say no to a row is one bad neighbour away from the same fault.

### `overflow: visible` stays, and is now asserted

Two questions were being answered by one declaration: *may a popup leave this
box* and *may this box be short*. They are separate now, and a test holds the
first one down — because "bound the sidebar" has an easy wrong answer that
would silently re-break the account menu.

### Thin scrollbars, and no colour

`scrollbar-width: thin` at the root. It inherits, so that is the only place it
has to be said.

**No `scrollbar-color` beside it, deliberately.** Naming a colour turns a
platform's overlay scrollbar into a permanent one, which takes a strip of width
from every scrolling box on the machines that have them — a layout change nobody
asked for, in exchange for a hue. A thumb colour that would satisfy this
project's own 3:1 rule for a control (ADR-0137) exists in the ramp — `--ink-500`
measures 3.59:1 on the worst light ground and `--ink-350` 3.99:1 on the worst
dark one — so this is a decision, not a limitation.

### A chosen theme tells the browser which one it is

`:root[data-theme='light']` and `:root[data-theme='dark']` set `color-scheme`,
beside the default rather than in the theme blocks three hundred lines above.

**With `:root` in front of the attribute, and that matters.**
`[data-theme='dark']` and `:root` have the same specificity, so the later one
wins — and the root's declaration is later in the file. The first attempt at
this fix put the line in the theme block, and measured `color-scheme: light
dark` on a page whose theme was dark. Two rules that disagree only by source
order are two rules the next edit will move apart.

## Consequences

**Four tests, three red.** Every column may shrink; the scrollbars are thin; a
chosen theme names its scheme. The fourth is the guard: the sidebar still lets a
popup out.

**They read the stylesheet, and say so.** A layout is only really testable in a
browser and there is none in CI, so the measurements above are what these tests
stand in for — they are written into the file that holds them, so the next
person reads the numbers rather than the rule alone.

**One thing could not be measured here.** This headless Chromium uses overlay
scrollbars, so a scroller's width is 0px with `thin` and without it. The
declaration is standard and inherited; how much narrower it looks is a thing to
see on the running instance, and this record does not claim to have seen it.

**Not done:** Safari does not implement `scrollbar-width`, and reaching it means
`::-webkit-scrollbar`, which is not a width but a whole second scrollbar to
draw — track, thumb, corner, hover — in parallel with the first. One mechanism,
and the platforms that lack it keep their own.

## Alternatives considered

**`overflow: hidden` on the sidebar.** Bounds it, and cuts the account menu off
at the rail's edge — undoing a fix whose reason is written where it happened.

**`overflow: hidden` on `.app`.** Hides the symptom and leaves the columns
6458px tall, so the avatar is still off-screen, just clipped rather than
scrolled to.

**Fix `.sidebar` alone.** It is the one column that was actually broken, and
measurement says the fault disappears with that single line. It also leaves
`.main` held up by a declaration about scrolling and the rail held up by its
neighbour — three columns whose height is somebody else's business.

**`scrollbar-color` with a token.** The thumb would follow the workspace's own
ramp, and every scroller on macOS would grow a permanent gutter. The colours are
worked out above if that trade is ever wanted.

**`color-scheme` inside the two theme blocks.** Where it belongs by subject, and
where it loses to source order. Correctness first; the comment says why it is
not filed with its relatives.
