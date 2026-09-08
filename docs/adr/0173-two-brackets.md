# ADR-0173: Two brackets

## Status

Accepted. Built. Round two of three on cross-references (ADR-0170).

## Context

The round ADR-0170 named and left:

> `[[` statt kopieren — Seitentitel tippen, Enter, Link fertig

ADR-0170 gave a way to link *this block*: open the handle menu, copy the
address, go back, paste. Precise, and it makes somebody leave the sentence they
are writing. Typing `[[` is the other half — coarser, because a list of titles
cannot offer a paragraph, and the two do not replace each other. *„Siehe die
Satzung"* wants `[[`; *„siehe diesen Absatz der Satzung"* wants the button.

## Decisions

### The third menu of one shape

A trigger, a query built from what follows it, and a plugin state the interface
renders. The slash menu (ADR-0016) and the mentions (ADR-0085) are the first
two, and `mentionMenu.ts` already says why there is a shape at all: *"the same
shape as the slash menu, and deliberately so."*

The division is the same as the mentions', and for the same reason: the pages of
a workspace are no more `@sone/editor`'s business than the people in one. The
plugin holds a position and a query and **never a list**.

### Why the trigger is two characters

`/` is rare in prose. `@` is not, and needed a word-boundary rule so
`markus@example.org` opens nothing. `[` sits between: it begins a markdown link,
a footnote marker, a citation — things somebody writes in a paragraph, and a
menu over any of them captures the Enter that ends the line.

`[[` is the wiki convention for exactly this, it is what somebody arriving from
another notes application will try first, and two characters is rare enough to
need no cleverness beyond the boundary rule the mentions already have.

The query cap is **forty** where the mentions use thirty. Same reason — a title
contains spaces, so a space cannot close the menu the way it closes the slash
menu, and length is what is left — and a different number, because a title is
longer than a name: *Protokoll der Mitgliederversammlung* is already
thirty-four.

### Words wearing a link, not an atom

A mention is a node carrying an id and a cached label. A page link is ordinary
words with a `link` mark, which is ADR-0170's decision unchanged: a relative
address survives an export, a copy into an email and being read behind another
host, and the page uuid inside it is what round three will read.

**No trailing space**, where `insertMention` adds one. That space is right
there: a mention is an atom and a caret directly after one has nowhere ordinary
to be. The link mark is `inclusive: false`, so the caret after these words is
already outside the link — a space here would be a word the person did not type,
and the sentence may want a comma.

### Relative, where the copied address is absolute

Two callers, two shapes, and the split is now stated in the module:

| | shape | why |
|---|---|---|
| `blockAddress` → the clipboard | absolute | a bare path is not an address to paste into an email |
| `documentAddress` → the document | relative | it is followed from wherever the document is read |

Neither carries a share token. `usePageLink()` would put one in — correct for a
link being followed, a credential travelling with the content for one being
stored (ADR-0170).

### A share-link visitor is offered nothing

The share session already states the rule about its own list: *"a visitor
holding a link is not a member and must not learn what else the workspace
contains"* (ADR-0026). So the picker gets the empty list there, following
`members={[]}` on the same path — what a visitor may see is the server's answer
to give, not this view's to assemble.

The menu still opens and says so, rather than not opening: a menu that vanishes
mid-typing looks like a bug.

### The path under the title

A workspace has a *Protokoll* in every folder, and a list of identical words is
not a choice. Each row carries the folders above it — the same thing the
breadcrumb says on the page itself — truncated rather than wrapped, so a deep
path costs one line and not four.

Three kinds of row are refused before anything is matched, each being one nobody
could choose on purpose: a page with no title, a page here only as a path
(ADR-0026), and a page in the archive. And **the page being written on**, whose
link would land where the reader already is.

## Consequences

**Sixteen tests in the editor**, driven through real transactions because what
is under test is when a menu opens and closes as somebody types, and that is a
sequence of transactions. The one worth naming: *one bracket opens nothing*.

**Fourteen on the web side**, over two exported functions — which pages match,
and where a page sits. The path walk is bounded at twelve steps: nothing should
be able to write a cycle into the tree, and a walk over data read from a server
is exactly the place not to assume that.

### A census that had to be told

`chooseWithKeys.test.tsx` names the exact files that use `useChoiceList`, and
failed on a seventh. That is the assertion working: a new list has to be added
to it on purpose, which is the moment to notice whether it went through the hook
or grew its own eleven lines. It went through the hook.

### Measured before it was described

The menu rendered in a real browser at 320px, four rows of 49px, the long title
and the long path both clipped with an ellipsis, and two rows reading *Protokoll*
told apart by the line underneath. The rule that made that work is three
declarations of `text-overflow` — cheap, and the reason for the round's width
being different from the other two menus'.

## Alternatives considered

**`]]` completes the link.** The wiki convention has a closing pair, and
somebody typing `[[Satzung]]` would expect it. Left out: Enter and a click are
the two ways every other menu here is answered, and a third way that only works
for this one is a rule to remember rather than a shortcut.

**A single `[`.** One character less to type, and a menu over every markdown
link, footnote and citation somebody writes.

**Offer blocks as well as pages, as `[[Seite#Absatz`.** The search endpoint
already returns a `blockId` per hit, so the machinery exists. Not this round:
the picker would need a second stage and a second list, and the handle menu
already answers *this exact block* precisely.

**Normalise a pasted absolute address to a relative one.** It would make every
internal link in a document one shape, including the ones pasted from the handle
menu's clipboard. Worth doing and not here: it changes what is stored for every
link anybody pastes, which is a round of its own.
