# ADR-0168: The other direction

## Status

Accepted. Built.

## Context

Asked for as the reverse of what the panel already does:

> wenn man bei einem kommentar im Content eingestellt hat dass er farbig
> hinterlegt ist, ist der grundsetzlich anklickbar. Kann man es so bauen dass
> wenn ich drauf klicke, dass dann die Seitenleiste rechts sich öffnet und
> automatisch auf die Kommentare springt und den gewählten kommentar hervorhebt?
> Also gerade umgekehrt auch, was wir schon für Links und co gebaut hatten.

The panel has been able to reveal a thread's words since ADR-0046. Going back
the other way was the half nobody had built — and the connection it needs was
already in the document: the mark carries `data-thread`, put there so the panel
and the writing agree on which thread is which.

## Decisions

### Three components answer, and none can reach the others

Whether the panel is open is the shell's state. Which tab it shows is the
strip's. Which thread is lit is the panel's. Passing a callback from the editor
to all three means threading it through everything in between and rebuilding it
on every render.

So: one named event, `sone:open-thread`, and three listeners — the arrangement
`sone:reveal-comment` has used since ADR-0046 and `sone:reveal-place`,
`sone:pdf-comment` and `sone:found-block` since. **Each listener holds exactly
the state it holds anyway.**

Both shells listen: a shared link has its own, and a comment mark is drawn there
too whenever the link carries comments.

### The click is not taken away from the text

The handler returns `false`, always. The words under a comment mark are ordinary
writing and somebody clicking them is usually about to type — so the caret still
lands where it was aimed, and the panel opens beside it.

**This is the difference from a link** (ADR-0157), where following it *instead
of* placing the caret is the whole point, and where a plain click therefore had
to be answered with a card rather than a jump.

### `closest`, from whatever was clicked

A mark wraps words and words carry their own formatting, so the click usually
lands on an `<em>` or a link inside the mark rather than on the span the
decoration made.

Scoped to `.sone-commented`, because a **PDF mark carries `data-thread` too** —
for the same reason, in the same DOM, inside a node view. It takes no pointer
events today (ADR-0152), so nothing would reach this handler; scoping it means
the day that changes is not the day this starts answering for the wrong marks.

### The callback is optional, so a render with no panel grows no handler

`commentMarks(threads, style)` with two arguments installs no `handleDOMEvents`
at all, rather than one that reports into the void.

### A folded thread is unfolded while it is the found one

Not by changing the fold set: being shown something is not the same as choosing
to keep it open, and the choice belongs to whoever made it. The moment the flash
ends, the thread is as folded as its owner left it.

### The panel scrolls with `nearest`, and the writing with `start`

Deliberately different. The block in the writing is what the eye is following,
so it goes to the top (ADR-0166). The thread is a card in a list beside it, and
one that is already visible should not move at all — shuffling the list under a
reader would be a second thing moving for one click.

### It is the same flash, a third time

`data-found`, the ring that holds, the pulse that goes for somebody who asked
for less motion. One vocabulary for *this is the one*, whichever side of the
page it is on: a PDF mark (ADR-0156), a block (ADR-0166), a thread card.

## Consequences

**Five tests in the editor**, driven through the plugin's own handler with real
elements: what is being decided is `closest()` against a DOM tree, and the tree
is the whole input. Which thread is reported, that it is found from a child of
the mark, that plain writing reports nothing, that the click is left alone, and
that two arguments install no handler.

**Seven in the web suite.** Four mount the panel — the card that lights, the
light moving rather than multiplying, every card carrying its thread id, and an
id no thread carries lighting nothing. Three read the source of the two
components whose whole part is one line of state each.

### Two assertions broke on a stylesheet that was right

Both because a selector list grew a third entry, and both times the pattern had
glued a selector to its `{`. And picking `.comment-thread[data-found]` by its
first match found the **reduced-motion** rule, which sits four thousand lines
earlier and says `animation: none` — so the assertion about the ring was reading
the rule that removes the pulse.

The test now takes the body that contains `outline:`. **A rule found by its
selector is not necessarily the rule that draws it.**

## Alternatives considered

**A callback threaded from the editor to the shell.** Three components deep,
rebuilt per render, for one message.

**Consume the click.** Then marked words cannot be edited by clicking into them,
which is most of what somebody does with writing.

**Open the thread's own view instead of the panel.** There is no such view, and
inventing one would answer *„die Seitenleiste rechts"* with something else.

**Switch the tab for a pending comment too.** Pressing *Kommentieren* opens the
panel without changing the tab, which looks like the same gap — but it was not
reported and I have not reproduced it. Named here rather than fixed blind.
