# ADR-0162: A cover that fits the page

## Status

Accepted. Built.

## Context

Asked for after living with ADR-0117 for two days:

> Könnte man für das Titelbild noch Einstellungen einbauen? Ich könnte mir zb
> vorstellen dass das Titelbild auch über die ganze breite geht. Und vielleicht
> noch 3 Möglichkeiten was die Höhe angeht, schmal mittel und hoch oder so?

The band has been one size since it was built: `clamp(120px, 20vh, 210px)`,
inside the reading column, with a rounded corner and a hairline ring. Both
numbers were a guess that has now been looked at every day for two days, which
is the only way to find out that a guess wants to be a setting.

## Decisions

### Two fields beside `kind`, not more kinds

```ts
export type EntryCover = ({ kind: 'image'; … } | { kind: 'color'; … } | …) & {
  width?: CoverWidth;
  height?: CoverHeight;
};
```

How tall a band is and how far it runs are true of a picture, a colour and a
gradient alike. Folding them into the union would make nine members that say
three things, and every reader of it would have to answer "what colour is this"
and "how tall is it" in the same `switch`.

No migration and no `SCHEMA_VERSION` bump: this is two optional keys inside a
`jsonb` value that already exists. An older client reads a cover it does not
fully understand and draws the band it has always drawn — which is exactly what
this value's reader was written to do (ADR-0117).

### Two widths, because the block menu already argued this out for pictures

A block offers three — column, wide, full — and the block menu **refuses the
middle one for an image**, in its own words:

> "Wide" is a step between the reading column and the page, and for an image it
> is a distinction without a difference: all three read as "the width of the
> text, or a bit more". An image is either in the column with the writing or
> across the page.

A cover is that picture, one line further up. So `'column' | 'full'`, which is
also the page's own pair of words for its own width — and the two labels are the
existing `block.width.column` and `block.width.full` rather than two new ones
that would have to be translated to the same two German words.

### Three heights, as steps rather than a number

*„schmal mittel und hoch oder so"*, taken literally. A number somebody types is
a number that can be three pixels, and every value between the three is a
decision nobody needs to make.

Each is a clamp, for the reason the original one was: a band is a proportion of
the window as much as a size, and a fixed 210px is half of a short laptop screen
and a stripe on a tall monitor.

| | | measured at 1400 × 900 |
|---|---|---|
| slim | `clamp(72px, 11vh, 120px)` | 99px |
| medium | `clamp(120px, 20vh, 210px)` | 180px |
| tall | `clamp(200px, 38vh, 400px)` | 342px |

Medium is the existing clamp, unchanged and untouched.

### The default has one spelling, and it is silence

`readEntryCover` **drops** `width: 'column'` and `height: 'medium'` rather than
storing them. Two spellings for one state is a control that has to decide which
of them counts as chosen, and a cover that reads as adjusted while looking
exactly like every cover nobody has ever touched.

It is the distinction `template` and `locked` already make by being absent
rather than false — and it is what keeps *„wenn nichts gesetzt ist, soll alles so
aussehen wie bisher"* (ADR-0117) true across a round that gives the band
settings. Every cover on the instance today is one of these.

The same rule holds for the stylesheet, where it is one declaration for two
selectors rather than two rules that agree:

```css
.entry-cover,
.entry-cover[data-height='medium'] { block-size: clamp(120px, 20vh, 210px); }
```

A value nobody offers — `height: 'huge'`, `width: 'wide'` — is dropped without
taking the cover with it. One level up, a malformed cover loses its cover and
not its place in the tree; here, a cover with an unknown height loses the height
and not the picture.

### `100cqw`, and not the block's half-indent

Full width is the arithmetic a full-width block already uses: `50% - 50cqw`
against `.main`, the element that carries `container-type: inline-size`. `100vw`
is the *window*, sidebar included, which is how a full-width block once pushed
the whole page sideways.

**Without** the block's `--sone-text-indent / 2` correction, which is the part
worth writing down. That offset exists because the editor pads its left side
only, to make room for list markers, so a block's containing box sits half an
indent right of centre. A cover sits in a page body padded evenly on both sides.
Copying the correction would have introduced the very fault it was written to
fix, arriving from the other direction.

And a band that reaches both edges drops its rounded corner and its ring, for
the reason the blocks state: a corner is what tells you where a thing ends, and
this one ends where the page does.

## Consequences

### Measured in Chromium, against the real stylesheet and the real chain

`.app` → `.main` → `.page-body` → `.entry-head` → `.entry-cover`, because
`50% - 50cqw` is only true against that chain — a flattened probe would agree
with itself (the lesson PR #103 left).

At 1400 × 900, with the sidebar shown, `.main` runs 316 → 1400 and the reading
column 490 → 1226:

| | band | radius | ring | page scrolled sideways |
|---|---|---|---|---|
| nothing set | 510 → 1206, 180 tall | 4px | yes | 0 |
| `height=slim` | 510 → 1206, 99 tall | 4px | yes | 0 |
| `height=tall` | 510 → 1206, 342 tall | 4px | yes | 0 |
| `width=full` | **316 → 1400**, 180 tall | 0 | none | 0 |
| `width=full height=tall` | 316 → 1400, 342 tall | 0 | none | 0 |

The full-width band's edges are `.main`'s edges exactly, and nothing overflows.
At 600px wide the full-width band measures 36 → 580 — the same as an unset one,
which is the media query holding.

### Sixteen tests

Four in `@sone/core` for what a cover may say about its shape, six mounted in
the web suite for what reaches the document, five reading the stylesheet for
what the attributes draw, and one against the route.

The route one exists because the **folder** half goes through HTTP, and it only
carries the two new fields because the route stores whatever `readEntryCover`
returns rather than picking fields out by name. A validator that listed `kind`,
`url`, `color`, `from` and `to` would have passed every other test in the file
while dropping the shape on folders alone.

### The picker does not close on a shape choice

Choosing a picture is one act and then you are done. Trying a height is three
clicks in a row, and a panel that shut after each one would have to be reopened
twice to answer one question.

## Alternatives considered

**A number for the height.** Then a cover can be three pixels tall, and the
picker is a text field where a choice belongs.

**A block's three widths.** The block menu's own comment refuses the middle one
for a picture, and this is a picture.

**`width: 'column'` stored explicitly.** Every cover on the instance would then
differ from every cover written before this round while looking identical, and
the width row would have two values meaning "column" and have to treat them as
one.

**A drag handle on the band's bottom edge.** A cover height nobody can name is a
cover height nobody can give a colleague, and it is one more thing to get wrong
on a touch screen — where this application is read.

**Per-workspace defaults.** Nobody asked, and the setting is one click away on
the entry that wants it.
