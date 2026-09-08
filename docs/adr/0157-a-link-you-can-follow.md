# ADR-0157: A link you can follow

## Status

Accepted. Built.

## Context

Reported:

> Wenn man im Text einen Link setzt dann kann man den nicht öffnen. Eine
> Funktion den Link in neuem Fenster zu öffnen, zu kopieren usw wäre super.

Links have been makeable since the selection toolbar gained `Mod-K`, and
followable never. Nothing was refusing it on purpose — ProseMirror simply does
not follow links itself, and nothing here had told it to.

Going to add that turned up something else first.

## Decisions

### The refusal was at one door, and there are two

`normaliseHref` has always refused `javascript:`, `data:` and `vbscript:` —
*"refused rather than sanitised, because sanitising a URL scheme correctly is not
something to attempt by hand"*. It guards a link somebody **types**.

The schema's `parseDOM` took a pasted `href` exactly as it arrived. Measured
before anything was changed:

```
HREF: "javascript:alert(1)"
HREF: "https://example.org/x"
HREF: "data:text/html,<script>"
```

All three survived a paste into a page, rendered as real anchors. A notes
application is full of pasted text, and this one is shared: the page carries
whatever somebody pasted to everyone who opens it. Making links followable would
have put that one click away.

So the rule moved into `hrefs.ts`, a module with no imports, and `parseDOM`
refuses at its own door by returning `false`. **The words stay and the link is
dropped** — a paste that loses its formatting is an annoyance, and a paste that
carries a script is not.

Its own module because `normaliseHref` lives in `links.ts`, which imports the
schema; the schema cannot ask it back without a cycle, and a second copy of a
security rule is the copy that stops being updated.

### A reader clicks; a writer holds the modifier

A page somebody may not edit is a document, and a link in a document is followed
by clicking it.

Inside an editable view a plain click has to keep putting the caret in the word,
because **a link nobody can correct is worse than one nobody can follow**. So
`Cmd`-click on a Mac and `Ctrl`-click elsewhere — the pair every other shortcut
in this editor is built from — and the plain click is answered differently
(below).

### `handleDOMEvents.click`, not `handleClick`

`handleClick` is called from ProseMirror's own mouse state machine: mousedown,
then mouseup, then a resolved document position. The position is the part this
does not need — the answer is on the anchor the click landed in. Going at the DOM
event directly also keeps the behaviour identical in a read-only view, where that
state machine has rather less to do.

### `getAttribute('href')`, not `anchor.href`

The property is resolved against the page's own origin. A relative link — the
kind written so a shared page keeps working behind another host — comes back
absolute, and a refused scheme comes back looking like something else. The
attribute is what the document says.

### The plain click is answered by a card over the caret

Four things, and none of them new vocabulary — they are what a browser's own
context menu offers: **open, copy the address, change, remove**. Change and
remove only for somebody who may edit the page; open and copy are things a reader
does.

The address is shown rather than summarised, because a link's words rarely say
where it goes — and because clipboard access can be refused, or absent over plain
http, which leaves reading it off the screen as the way to copy it. Monospaced: an
address is not prose.

### It is the same overlay, not a second card

The hard half is the positioning: a range that may wrap a line, a coordinate that
is stale for a frame after a document change, and a reading column that
re-centres when a panel opens without any window event (ADR-0083). A second card
is a second copy of all of that to get wrong. So `SelectionToolbar` gains a
second face, shown when the selection is empty and the caret is in a link, and
measured against the **link's** extent rather than the caret's — over the words
rather than over the one character somebody's cursor happens to be in.

### And the scheme is asked again at the moment of following

Nothing can put a refused address into a document any more. But a CRDT keeps
whatever ever reached it, and documents written before that door existed are
still out there. The question costs one comparison at the moment it would matter.

## Consequences

**Sixteen tests.** Five mount a real editor and dispatch real clicks, because
every interesting answer here is about a click: which view it landed in, whether
a modifier was held, and what the anchor's attribute says. A test that called the
handler directly would be a test that a wire exists (ADR-0091).

### The test that passed for the wrong reason

The first version built a read-only editor and then wrote the link into it —
which `editGuard` filters, because that is its job (ADR-0049). So the editor was
empty, there was no anchor, nothing opened, and *"a reader clicks it and it
opens"* went green on a document with no link in it.

The fixture writes while editable and locks afterwards.

### Measured in Chromium

Two editors on one page, one editable and one not:

| | opened | note |
|---|---|---|
| reader, plain click | `https://example.org/satzung` | the page itself did not navigate — `preventDefault` holds |
| writer, plain click | — | caret lands **inside the anchor, collapsed** |
| writer, `Ctrl`-click | `https://example.org/satzung` | |

The middle row is the one that matters twice: it is the behaviour a writer needs,
and it is exactly the state the card keys on — so the measurement proves the
precondition the card's own tests assume.

## Alternatives considered

**Sanitise the pasted address instead of refusing it.** `normaliseHref`'s own
comment says why not, and it was right.

**Let a plain click open it while editing too.** Then a link is a phrase nobody
can put the caret in, and correcting a typo inside one means selecting around it.

**A hover card instead of a caret card.** Hover has no answer on a touch screen,
and this application is used on one.

**A second component for the card.** A second copy of the positioning.

**`window.open` from the toolbar.** It would be the one path that does not ask
whether the address is followable. `openLink` asks, once, for everybody.
