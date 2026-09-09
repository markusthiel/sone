# ADR-0177: One shape in the document

## Status

Accepted. Built. The gap ADR-0173 named and left.

## Context

ADR-0173 closed with this among its alternatives:

> **Normalise a pasted absolute address to a relative one.** It would make every
> internal link in a document one shape, including the ones pasted from the
> handle menu's clipboard. Worth doing and not here: it changes what is stored
> for every link anybody pastes, which is a round of its own.

The two shapes are not equally good, and `normaliseHref` has said why since
ADR-0157 — in a comment that was true of half the links it handled:

> A relative link within this instance is legitimate and should stay relative,
> so a shared page keeps working behind a different host.

It said that about an address somebody typed without a scheme, and then took an
absolute one exactly as it arrived. **The handle menu's address is absolute on
purpose** — it goes to the clipboard, where a bare path is not an address
(ADR-0170) — so the most likely way to make an internal link was also the one way
to write this instance's hostname into a document.

## Decisions

### `hrefs.ts`, for the third time and the same reason

That file exists because the schema needs an answer `links.ts` holds and cannot
import it: *"two copies of a security rule is one copy that stops being
updated."* This is the third rule to live there for exactly that reason, after
`isFollowable` (ADR-0157) and `isSameOrigin` (ADR-0171).

### Two doors, not three

A link arrives by typing, by markdown paste, and by HTML paste. The first two are
one door in practice — `markdownPaste` already routes through `normaliseHref` —
so the rule is called twice, and every door is covered. ADR-0157 records what
happens otherwise: *"the refusal has to be at every door, and it was at one."*

### The environment is read in one place

`homeRelative(href, origin)` is a function of an origin passed in, so every rule
is statable in a test without a browser. One line reads `globalThis.location`,
and off a page it answers with the empty string — nothing is same-origin with
that, so the normalisation does not happen rather than half-happening somewhere
nobody can see it.

`isSameOrigin` is asked rather than the string compared, which is what keeps
`//evil.example/p/x` and `https://sone.example.evil/p/x` out: both read like ours
and resolve elsewhere.

### And the reverse, where a link leaves for the clipboard

This is the consequence that had to be caught before it shipped. Both copy
buttons — the link card's *Adresse kopieren* and the links panel's — copied the
stored href. With the stored href now relative, they would have handed somebody
a bare path, **which is precisely what `blockAddress` exists to avoid**.

So `forClipboard` puts the host back on at the moment a link leaves. Making the
document uniform must not make copying worse, and the two functions are each
other's reverse on purpose: one runs where a link arrives, the other where one
leaves.

## Consequences

Ten tests in the editor over the rule, four more on the web side over its
reverse and the two buttons that use it.

**Nothing migrates.** A document keeps whatever ever reached it, so absolute
internal links written before this round stay absolute — and go on working,
because they always did. They become relative the next time somebody edits that
link, and never otherwise. The alternative was a pass over every document to
rewrite what is not broken.

**A link card now shows a path where it showed an address.** That is the honest
display of what is stored, and the links panel already says *In diesem
Arbeitsbereich* rather than a host for such a row (ADR-0170).

## Alternatives considered

**Store absolute everywhere instead.** One shape too, and the wrong one: an
address with a host in it is an address that stops working when the host
changes, which is the case ADR-0157's comment was written about.

**Normalise on read rather than on write.** Every reader would need the rule —
the panel, the editor, the export, the backlink extractor — and the extractor is
in a package with no notion of an origin at all.

**Migrate the existing documents.** A pass over every CRDT in the instance to
change addresses that work into addresses that work slightly better, with the
undo history of every page as collateral. The next edit does it for free.

**Leave it.** Two shapes for one thing, and the comment in `normaliseHref` going
on describing only one of them.
