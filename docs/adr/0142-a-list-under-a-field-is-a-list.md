# ADR-0142: A list under a field is a list

## Status

Accepted. Built. Closes *„die Personensuche hat keine Tastaturnavigation"*, and
fixes a live fault on the members screen that the same question found.

## Context

Six places in this application put a list of choices under something somebody is
typing into: the person picker on the members screen, the two fields in the
search panel, the tag field in the properties panel, and the `@` menu in a
comment and in the editor.

They had **three different answers to one question, and four of them had none.**

### The two mention menus had the keys and none of the words

Eleven lines, twice, near enough identical: an index in component state, arrows
that wrap, Enter and Tab to take the highlight, back to the top when the query
changes. Working, in both — and saying nothing to a screen reader. The list
declares `role="listbox"` and its items are buttons: not options, no
`aria-selected`, no `aria-activedescendant`. **A listbox whose children are not
options is a count that is wrong and a position nothing can announce.**

### The person picker had all the words and none of the keys

`role="combobox"`, `aria-expanded`, `aria-controls`, a `role="listbox"` of
`role="option"` with `aria-selected` — the whole contract, written out. And no
arrow keys, no active option, and this:

```tsx
onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
```

**Enter submitted the form.** In a contract where Enter takes the current
option — and `add()` sends whatever is in the address box, which while somebody
is searching by name is *the name*. So: type "an", see Anna Weber on screen,
press Enter, and the screen answers that "an" is not a valid address. Measured,
not read: the request carries `email: 'an'`.

This is the failure this codebase keeps finding, in its newest costume — **a
declaration that nothing computes.** ADR-0135 found it as a comment promising a
contrast ratio; ADR-0137 as a comment promising a focus ring "at least as
visible"; here it is markup promising a keyboard.

### And the only key that reached any of the four was the wrong one

The suggestions are buttons, so Tab reached them. Tab means *leave this field* —
and in the tag editor the field adds whatever it is holding when it loses focus,
deliberately, so that a field left holding a word does not look like a tag that
failed. Tabbing to a suggestion therefore added the half-typed word **and then**
the suggestion: `meet` and `Meeting`, two chips, from one intention.

### The answer was already written, in the other package, first

The slash menu has all of it: `role="option"`, `aria-selected`,
`aria-activedescendant`, arrows and Enter and Tab and Escape, the highlight
scrolled into view when the keyboard moves past the edge of the box, and a
`:hover` rule turned **off** with the reason beside it —

> Driven by data-selected rather than :hover, so the keyboard and the mouse
> highlight the same thing. **A :hover rule would light up a second row while
> the keyboard selection sits elsewhere.**

— and the sentence this whole record is about:

> The selected index lives in plugin state rather than in the renderer, so the
> keyboard handler and the menu cannot disagree about what is selected — **which
> is the classic bug in this kind of component.**

Six lists were written afterwards. None of them read it.

## Decisions

### One hook, `useChoiceList`, and it owns exactly the highlight

The index, the wrapping, the reset, the ARIA ids, the scroll-into-view, and the
keys. Nothing else.

**It does not own whether the list is open.** Every caller decides that
differently — two characters typed, an `@` under the caret, a request that has
come back — and a hook that owned it would have to be told all of that anyway.

**It does not own what a key means when the list did not want it.**
`handleKey` answers *"was that mine?"* and returns. So Enter with nothing
highlighted still submits the person picker's typed address (ADR-0119), still
sends a comment, and Escape still belongs to whoever knows what closing means
here. That one boolean is what let five very different callers share eleven
lines.

### The slash menu keeps its own, and that is not an exception

Its index is in plugin state because `@sone/editor` must work without React
(ADR-0016). That reason is better than any this hook could offer, so it stays —
and the test that says "an active option must be movable" names `setSlashIndex`
alongside the hook, because the renderer holding *the name of who moves it* is
the same guarantee.

### Enter takes the person; the next Enter adds them

Two keystrokes, on purpose. The members form exists to confirm **who** before
granting anything, and the sentence naming them appears between the two —
which is exactly what ADR-0119 built the picker for.

### And choosing somebody closes the list for good

Choosing writes their name into the field. That is a change to the query, so the
lookup ran again, the person matched their own name, and **the list reopened
under a field that had already been answered.** Invisible with a mouse, because
the pointer is on its way to the button. With the keyboard it is the difference
between Enter adding somebody and Enter choosing them a second time.

### The highlight follows the selection, not the pointer

Four lists highlighted on `:hover`. Pointing at one row while the keyboard sits
on another lights up both, and neither of them says which one Enter takes. So
`data-selected` paints and `:hover` is turned off — the pointer still
highlights, by *moving the selection*, which is the slash menu's rule adopted
whole.

### The options leave the tab order

`tabIndex={-1}`, so the field is one tab stop and the list hangs under it. That
is the combobox pattern, and it is also what removes the tag editor's double-add
— Tab now takes the highlight when there is one, and otherwise means what it
always meant.

## Consequences

**Nine tests, seven of which failed on the old code.** Four are source rules
stated as implications — a listbox has options, a combobox names its current
option, an active option can be moved, and every list under a field goes through
the one hook. Read off the roles rather than off the prose, so a seventh list
cannot arrive with half a contract.

**Two could not fail before and stay:** Enter still adds a typed address with
nothing highlighted, and Tab out of an empty list still leaves the field. Both
are the things the change could plausibly have broken.

**A fixture got fixed for being too generous.** The person lookup answered with
two people whatever was typed, which cannot tell "Enter took the highlight" from
"Enter submitted the form". It matches now, the way the route matches.

**Not done:** an already-a-member option can be highlighted and then refuses
Enter, the way a disabled button refuses a click. Skipping it in the arrow order
would mean teaching the hook which options are refusable, and ADR-0119's rule is
that such a person is *shown and refused* rather than hidden.

## Alternatives considered

**Leave the mention menus alone and give the other four a hook.** Two
implementations of the same eleven lines is how the two working ones came to be
the only two that worked. A third copy would have been the answer to the wrong
question.

**Move the slash menu onto the hook too.** It would take the index out of plugin
state and put it back in the renderer, undoing the sentence that names the bug
this whole record is about.

**Give the person picker arrow keys and stop.** The reported gap, and it would
have left the same hole in three other fields and the declaration still
uncomputed in two.

**`role="combobox"` on the comment composer and the editor.** A composer that
happens to be showing a mention list is not a chooser, and saying so tells a
screen reader the whole box is one. Those two name the active option on the list
itself — which is, again, what the slash menu already did.

**Keep `:hover` and add `data-selected` beside it.** Two highlights on screen at
once, and the one that matters is whichever the person is not looking at.
