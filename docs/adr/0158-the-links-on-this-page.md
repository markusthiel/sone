# ADR-0158: The links on this page

## Status

Accepted. Built.

## Context

Asked for after ADR-0157 made a link in the text followable:

> Vielleicht wäre auch ein neues content Element gut, eine Link Liste. Also eine
> Aufzählung mit links.

and then, when asked which of the two shapes was wanted:

> Linkleiste in der rechten leiste würde mir reichen.

Which is the cheaper of the two by a long way, because **the panel already
exists**. `RightSidebar` has had a *links* tab since the asset panels were
built: it reads the document, lists every link in it, shows the words and the
host, and jumps to the block.

So this round is not "build a panel". It is: the panel was written before links
could be followed, and following a link is now a thing this application does. It
was read again with that in mind, and three things were wrong with it.

## Decisions

### It was a second way to follow a link, and it was not asking

ADR-0157 put `isFollowable` at the two doors a *new* link comes through — typing
and pasting — and then asked a third time at the moment of following, because a
CRDT keeps whatever ever reached it and a page written before that round can
still carry a `javascript:` link.

The panel rendered `href={link.href}` with no question asked. One tab away from
the text, in the same window, for every reader of the page.

**Measured before changing it, in Chromium, over http:**

| the row as it was written | title after the click |
|---|---|
| `<a href="javascript:…" target="_blank" rel="noreferrer">` | `quiet` — did not run |
| the same address, without `target` | `RAN-PLAIN` — ran |

So it did not execute, and *the reason it did not execute is `target="_blank"`* —
an attribute that is there because a link to another site should open in a new
tab, and that Chromium happens to also refuse to do for a `javascript:` URL. The
security of the row rested on an attribute put there for an unrelated reason, in
one browser that was measured, and this application is read on an iPad. **A rule
that holds by accident is not held.** It is asked now:

```tsx
const followable = isFollowable(link.href);
```

A followable address is an anchor. An unfollowable one is a row with the words,
the address, and nothing to click — shown rather than hidden, because a list
that quietly omits one of a page's links reads as a list that is wrong. It gets
the same shape a file whose upload has not finished gets, for the same reason.

### `rel="noopener noreferrer"`, both words

The row said `noreferrer` alone. Every browser that matters implies the other
from it — so this is not a hole, it is worse in a quieter way: the schema writes
the pair on every anchor it renders, and **a rule written one way in one place
and another way in the next is a rule nobody can check.**

### Every row can be copied, including the refused one

Asked for in the same breath as opening one — *„den Link in neuem Fenster zu
öffnen, zu kopieren usw"* — and the card over the caret (ADR-0157) got it while
the panel did not. A list of a page's links is where somebody goes precisely to
collect them.

Offered for a refused address too. Copying a string is not following it, and
somebody looking at a link they did not expect to see wants to be able to paste
it somewhere and look at it.

### `useCopyToClipboard`, and the flash is keyed

Copying is three lines and all three are easy to get wrong the same way: the
write can be refused, `navigator.clipboard` does not exist at all over plain
http, and the *copied* that follows has to end again or it becomes a label.

The flash is **keyed rather than boolean** because this is the first list to
have one of these per row: a boolean would light every row in the list at once.
The caller names what it copied; the hook says which name is currently lit.

It says nothing when the write fails. Clipboard access being refused is not a
fault to report — the address is on the screen, and "copy" quietly not lighting
up is a truthful enough answer for an act that costs nothing to do by hand.

### Its own file, and only this one

The panel moved out of `RightSidebar.tsx` because it grew a decision worth
testing on its own. The other six panels stayed: moving them all is a change with
its own reasons, and tangling it into this one would make both harder to read.

### The three other places that copy were left alone

`ShareDialog` (twice) and `CollectionTable` each call
`navigator.clipboard.writeText` with their own local flash. They are not
converted here. Naming it: this is known duplication, deliberately kept, because
converting them is a change to three dialogs whose own tests would have to be
read and re-run, and it has nothing to do with what was asked for. The hook is
where the next one goes, and those three are the follow-up.

## Consequences

**Six tests, mounted** (`packages/web/test/linksPanel.test.tsx`), against real
`Y.Doc`s carrying a `link` mark. Mounted rather than read from the source,
because *whether a row is an anchor* is exactly the thing a source test would
assert wrongly — `href=` appears in the file either way.

They hold: an ordinary link is an anchor; it carries both words of `rel`; an
executing address is listed and is not an anchor; its words stay; one bad address
does not take the good one in the same list with it; and both rows can be copied.

### The other test this moved

`docAssets.test.ts` asserts that the panel says what to do when a list is empty,
by key, against the source of `RightSidebar.tsx`. Two of those keys moved into
the new file with the panel, and it went red on the two.

Read as one text now, over both files — because what that test holds is that the
panel *somewhere* says these things, not which file the sentence is written in.

### What is still open

Only Chromium was measured. The interesting row — `target="_blank"` with an
executing address — may well run in WebKit, which is what this application is
read on when it is read on an iPad. The panel no longer depends on the answer.

## Alternatives considered

**A link-list block, as first suggested.** A new content element is a new node
type in the schema, its own serialisation, its own paste behaviour, and a
migration for documents that do not have it. The panel is the same list, always
current, on every page, with nothing to insert — and it is what was asked for
once the two were held up against each other.

**Hide a refused link.** Then a page holds a link that the list of its links does
not mention, and there is no way to find out what it is short of reading the
markup. The list is of what the page holds.

**Leave the anchor and rely on `target="_blank"`.** It is not written down
anywhere that the attribute is load-bearing, it was measured in one browser, and
the first person to make relative links open in place removes it.
