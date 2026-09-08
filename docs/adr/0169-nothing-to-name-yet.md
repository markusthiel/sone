# ADR-0169: Nothing to name yet

## Status

Accepted. Built. Finishes what ADR-0168 named and left.

## Context

ADR-0168 closed with a gap it would not fix blind:

> **Switch the tab for a pending comment too.** Pressing *Kommentieren* opens
> the panel without changing the tab, which looks like the same gap — but it was
> not reported and I have not reproduced it. Named here rather than fixed blind.

Asked for the next morning:

> Ja, das mit dem Reiterwechsel solltest du auch gleich machen, danke fürs
> finden!

So it was reproduced first, in the source rather than by guess. Both shells:

```tsx
setPendingComment(anchor);
setRightOpen(true);
```

and the strip renders its body as `tab === 'comments' && …`.

**It is worse than a tab that does not change.** With a remembered tab of
`outline` — the stored default — pressing *Kommentieren* holds the anchor in
state and draws the outline. `CommentsPanel` is not mounted at all, so the
composer for that selection exists nowhere on screen. The selection is taken and
nothing asks for the sentence.

## Decisions

### The same event, with nobody named

`sone:open-thread` already has three listeners doing exactly the three things
this needs: the shells open the panel, the strip switches to `comments`, the
panel lights a thread. Two of the three are the same answer whether or not there
is a thread to name — and the third already refuses a detail that is not a
string, because a thread deleted between click and render was an ordinary race
worth guarding.

So `showComments()` dispatches the event with `null`, and **not one listener
changed**. The guard written for a race turned out to be the whole mechanism for
a second caller.

The event's name still reads as *bring the comments forward*; naming a thread is
the optional part. That is now what its comment says.

### The shells stop opening the panel by hand

`setRightOpen(true)` beside a dispatch that also opens the panel would be two
paths into one piece of state, differing only in which one somebody remembers to
update next time. The shells listen already — that listener is how a comment
mark opens the panel — so pressing *Kommentieren* goes down the same wire as
clicking a mark, and the two directions differ in exactly one thing: whether a
thread is named.

### A shared link answers too

`shareTabs` adds `comments` when the link may comment, and `onComment` is only
reachable on such a link. On a viewer link the strip has no comments tab, the
listener's own guard returns early, and nothing dispatches in the first place —
two independent reasons, which is the right number for a tab a visitor must
not be shown.

## Consequences

**Four tests on the web side.** One mounts the panel and asks with no id, which
is the assertion that the new caller does not light a card for a comment nobody
has written yet. One holds that `showComments()` names nobody. Two read the
source of the shells and the strip, for the reason ADR-0168 gives: each is one
line of state that a mounted `App` would take a hundred lines of scaffolding to
reach.

**One test changed rather than added.** `scale.test.ts` pinned
`setPendingComment(anchor);\n setRightOpen(true);` as *"holds the anchor and
opens the panel"*. Its subject is unchanged and its shape is not, so the pattern
moved and the note above it now says why — including the thing the old
assertion could not have caught, since opening the panel was all it ever
checked.

**No new state anywhere.** The change is one exported function, two call sites,
and an import.

## Alternatives considered

**Lift the tab into the shell.** Then the shell decides what the strip draws,
and the stored-tab clamp — which exists because a shared link offers fewer tabs
— would have to be applied in both. A rule that has to be applied twice gets
applied once.

**A second event, `sone:show-comments`.** Three listeners would grow to six for
a difference of one nullable field, and the two events would have to be kept
saying the same thing about opening the panel.

**Keep `setRightOpen(true)` and add the dispatch.** Works, and leaves the next
reader asking which of the two opens the panel.
