# ADR-0172: A class is not an element

## Status

Accepted. Built. Fixes what ADR-0171 shipped.

## Context

Reported with a screenshot, one round after the change that caused it:

> Ja ok, das öffnen ist verschoben. Auch bei normalen Links. Das war vorher ok

ADR-0171 turned the link card's *Öffnen* from a `<button>` into an `<a>`, so
that a link home would be followed in this window rather than in a second tab.
It kept the class. It did not keep the element, and `.toolbar-button` had been
written for one.

## Decisions

### The rule states what it needs

`.toolbar-button` set a size, a radius, a background and a colour, and inherited
the rest from `<button>`: content centred in its box, no underline, no link
colour. An anchor gets the box and none of that. Beside it, `a { color }` and
`a:hover { text-decoration: underline }` from the top of the stylesheet apply —
the class wins on specificity for `background`, and the underline is a
*different property*, so both rules apply and the underline stays.

So the rule now says `display: inline-flex`, `align-items: center`,
`justify-content: center` and `text-decoration: none`, and a
`.toolbar-button:hover` that puts the underline back down.

`align-items` rather than a vertical padding, because the height is a minimum
and the label may wrap the day somebody translates it into a longer word.

### `aria-disabled` beside `:disabled`

The refused address is drawn as a `<span aria-disabled="true">` — the shape the
links panel uses for an address that must not be followed. `:disabled` matches
neither a span nor an anchor, so it was dimmed by nothing and lit up under the
pointer like something to click. Both the dimming and the hover suppression name
the attribute now.

## Consequences

### I measured the thing that was already right

The first measurement compared `getBoundingClientRect()` on all four controls:

```
open  top 65  height 34  centre 82
copy  top 65  height 34  centre 82
```

Identical — and the screenshot plainly disagreed. The **boxes** were aligned;
`min-block-size` gave the anchor its 34 pixels. What sat wrong was the text
inside the box, and a rectangle around the element says nothing about that.

Measuring a `Range` over the contents instead:

```
              boxCentre   textCentre
open              82         72.0
copy              82         81.8
```

Nine point eight pixels, and the underline appears on hover. Both reproduced,
both then measured back to 81.8 with no underline.

**A measurement covers what it names** — written down in this repository before,
about a stylesheet assertion that found the wrong rule (ADR-0168). Here it is
about a rectangle that named the element when the question was about its
contents. The fixture was faithful — the whole stylesheet, the real markup, a
real browser — and still answered a question I had not asked.

### The assertion is in the stylesheet, the finding was in the browser

There is no browser-rendering harness in this repository, and this is not the
round to add one. The committed test reads the rule and holds the four
declarations that make the class element-agnostic, plus the two that cover
`aria-disabled`. The measurement is how the fault was found and how the fix was
confirmed; the test is what stops it coming back.

## Alternatives considered

**Give the anchor its own class.** Then two classes describe one appearance and
drift apart — and the next element that borrows `.toolbar-button` meets the same
surprise.

**Put it back to a `<button>` and navigate from an `onClick`.** That is where
ADR-0171 came from: the button had to reach the router, and every other link in
the application is answered at one door.

**`vertical-align: middle` on the anchor.** Works for an inline box and not for
the label wrapping, and it leaves the underline.
