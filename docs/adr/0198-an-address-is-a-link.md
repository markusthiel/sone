# ADR-0198: An address is a link, without being asked

## Status

Accepted. Built.

## Context

> Links sollten im editor automatisch als links erkannt werden, momentan ist es
> reiner text, der eingesetzt wird.

Everything around this existed. The `link` mark renders (ADR-0016), a command
applies it, `normaliseHref` turns what people write into something a browser can
follow, and a click follows it (ADR-0157). The missing piece was the moment in
between: typing or pasting an address produced characters, and the person had to
go back, select them exactly, and reach for the shortcut — for the one case in
the whole feature where there is nothing to decide.

The interesting half of this is not when to link. It is when *not* to.

`normaliseHref` is generous on purpose: `example.org` becomes
`https://example.org`, because somebody who typed that into a link field meant a
link. Applied to prose with nobody asking, the same generosity turns `z.B.`,
`Abs.2`, `1.5x` and every full stop not followed by a space into links. That is
somebody's writing rewritten by the editor — and in a CRDT it reaches everyone
else before the author notices.

## Decision

**Two moments, because an address arrives in exactly two ways.**

*Typing*, settled by the space that ends the word, or by the caret leaving the
block. Nothing is decided while somebody is still in the middle of typing.

*Pasting* a single address. It **replaces the selection** and is linked. Asked
for that way in so many words, and it is the one place where this differs from
editors that keep the selected words and hang the address on them.

**A stricter test than `normaliseHref`.** Only three shapes count as
unmistakable: a scheme (`https://…`), a leading `www.`, or something shaped
exactly like a mail address. A bare host does not, however much it looks like
one. `normaliseHref` still decides what the href *is* — including refusing the
schemes that execute — so there is one answer to that question and not two.

**Trailing punctuation is trimmed**, with brackets balanced, so
`Siehe https://example.org.` links the host and leaves the sentence its full
stop.

**Leaving the block is noticed, not intercepted.** ProseMirror asks plugins for
a key in order and stops at the first that takes it, so an Enter handler would
work or not depending on where this plugin sits among twenty others — and would
keep working until somebody reordered them for an unrelated reason. Instead
`appendTransaction` asks afterwards whether the caret left a block, which needs
no such luck and also covers the ways out that are not Enter.

**The mark is not left in the stored set**, so the rest of the sentence does not
join the link. That is the failure everybody knows from mail clients, and the
reason some people distrust autolinking altogether.

## Consequences

- `example.org` typed into prose stays prose. Somebody who wants it linked
  selects it and uses the command, where the generous reading applies. This
  will occasionally be asked about; the alternative is occasionally destroying
  text, which is worse and quieter.
- Pasting over a selection loses the selected words. That is what was asked
  for, and undo restores them.
- Code blocks are left alone: there an address is being shown, not offered.
- One keystroke stays one transaction — the space is inserted by the same
  transaction that adds the mark, so undo takes one press.
