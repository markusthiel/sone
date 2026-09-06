# ADR-0116: Who wrote this

## Status

Accepted. Built. Reported from use.

## Context

> Die Leute Spalte ist auch nicht konsistent, mal ist die leer, mal steht da
> eine Person, mal zwei.

It was perfectly consistent. It was answering a different question than its
heading, and the answer to that other question happens to look erratic.

`recordAttribution` runs when a document **opens**, and it has to:

> Attribution is not retroactive (ADR-0022). A document written before it was
> recording carries no mapping and never will.

So the mapping must be in place before the first keystroke rather than after it,
and what it therefore holds is *everybody who has had the page open* — everybody
who **might** have written. The panel read it directly, under the heading
"Leute", beside a note inviting somebody to choose a person and see their
writing marked in the page. Choose the colleague who glanced at it and nothing
lights up, because they wrote nothing.

Empty, one, two: a page nobody has opened since attribution was switched on, a
page one person opened, a page two people opened.

**The document already held the other half.** `liveClientIds` says which client
ids still have live content, and pruning has used it since ADR-0022 for exactly
this rule — an entry may go when nothing of that person's writing is left. The
panel's own neighbour function, `hasUnattributedWriting`, applied it. The list
above it did not.

### And the note above the list was on nearly every page

> Ein Teil davon entstand, bevor diese Seite mitgeschrieben hat — oder von
> jemandem, der gar keinen Namen angegeben hat.

Two causes, and on most pages neither of them was the one.

`applyToDocument` loads its own `Y.Doc` with its own client id. A rename, a move,
an icon, a lock, an import, a comment posted over HTTP — every one of those is
live content from a client the mapping has never heard of. One rename is enough.

A note that is always there says nothing, and this one sat above a list it was
contradicting: *nobody the page can name has written here*, over two names.

### The same fault, in a second place

`readDocument` projects `authorKeys` for the `author:` search filter, and it read
the same map the same way:

```ts
authorKeys: [...doc.getMap(USERS_KEY).keys()],
```

So `author:anna` matched every page Anna had ever opened. Nothing tested it —
the projection had no test at all — and nobody had reported it, presumably
because a filter that returns too much reads as a filter that is not very good.

That is the fifth time in this project that one question had two implementations
and the wrong one had the callers.

## Decisions

### `writersIn`, in core, is the answer to "who wrote this"

The mapping intersected with `liveClientIds`, returning the client ids as well as
the names — the panel marks a person's writing in the editor with them, and a
name with no ids is a name nobody can click.

**In core, not in the client**, because the server asks the same question for
the search projection. Two implementations of "whose writing is still here"
would disagree the first time either was touched, which is the argument
ADR-0022 already made when `liveClientIds` moved.

**Asked at the moment of reading**, not swept. Pruning applies the same rule but
only runs inside `applyToDocument`, so how recently a page had been renamed
decided whether its list had been swept — which is where "mal so, mal so" came
from even between two pages with the same history. Pruning stays: bounding the
document's growth is its other job.

**A person with no live ids is absent, not present and empty.** A caller that
has to remember to check the length is a caller that will forget once.

### A structural root is not somebody's writing

`hasUnattributedWriting` now ignores `meta` and `page` — the two roots a route
writes and the editor does not.

The exemption is for those roots, not for "anything a server does". An import
writes blocks, and blocks are somebody's words: writing in the body still counts
whoever put it there, and there is a test for that specifically, because an
exemption drawn one step wider would silence the case the note exists for.

`writersIn` does **not** take the exemption. Somebody whose only mark on a page
is its title did write the title, and the mapping only ever contains people, so
there is nothing to exclude.

### The two sentences under the list are in the catalogue

They were English string literals in the source, in a German interface
(ADR-0041). So was "Somebody who has left". The one about presence has been
rewritten while it moved — it said "everyone who has written here, whether or
not they are here now", which was the claim being made and was not true.

## Consequences

**Eight document tests, six mounted panel tests, two projection tests.** Three
of the mounted six and both projection tests fail before the change.

**The source test moved.** `contributors.test.ts` asserted that the component
called `attributionUsers` — and calling `attributionUsers` was the bug. A test
that asserts a wire exists is not a test; this one passed hardest while the wire
went to the wrong place. What it asserts now is which names are on the screen.
Seventh such move.

**ADR-0022 said pruning ran during materialisation**, which was never true — it
runs in `applyToDocument`. Corrected there rather than here, because that
sentence is where somebody would look, and its wrongness is exactly what made
the panel's answer depend on when a page was last renamed.

**A page written before attribution was switched on still lists nobody**, and
says so. That is unchanged and unfixable: the information was never captured.

## Alternatives considered

**Prune on read** — run `pruneAttribution` when the panel opens, so the mapping
itself becomes the answer. It makes a read into a write of the document, from
every reader, and the mapping would then be lossy in a way that cannot be undone
if the rule is ever wrong. Deriving the answer and leaving the record alone is
the same choice ADR-0002 makes everywhere else.

**List openers, and mark who wrote.** Two states in one list, one of which the
heading does not describe. "Leute" on a page panel means the people who worked
on this page; somebody who opened it is not one of them, and the presence
avatars at the top already answer "who is here".

**Record attribution on first edit rather than on open**, which makes the mapping
the true answer with no filtering. Attractive, and wrong in the way ADR-0022
already recorded: the mapping has to exist before the keystroke it is meant to
attribute, and a client that maps itself mid-transaction attributes the
transaction to nobody.

**Exempt the server's client id rather than the structural roots.** There is no
stable id to exempt — `applyToDocument` gets a fresh one every load — and a list
of ids to trust is a list somebody must maintain. The roots are a property of the
schema, which is where a rule about what routes write belongs.
