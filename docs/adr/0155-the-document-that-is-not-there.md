# ADR-0155: The document that is not there

## Status

Accepted. Built. Closes the gap ADR-0151 named and left open.

## Context

ADR-0151 recorded this, in the note beside `isDetached`:

> Whether that file is still shown on this page is a different sentence, and it
> belongs to whoever draws the page rather than to the thread.

Nobody wrote that sentence. So a comment about a place in a PDF whose block had
been deleted sat in the panel quoting a passage, offering a button that led
nowhere, and saying nothing at all about why.

**It is not "detached".** That word means the text a comment pointed at has been
rewritten, and a place cannot be: it names a file whose bytes are fixed and a
rectangle in that file's own coordinates. Nothing about the thread has changed.
What changed is the page.

## Decisions

### Shown, not merely present

Three things put a reader in the same position, and one sentence covers all
three:

- the file block was deleted;
- it was moved to another page;
- it was switched back to a card or a line.

The third is the one that makes the rule *shown* rather than *present*. A PDF
drawn as a card is still a file on the page and its **pages** are not — no
marks, no passage, nothing to point at. Somebody looking for the quoted words is
exactly as stuck as if it had been deleted, so telling them a different thing in
each case would be three sentences for one situation.

The sentence: *„Das Dokument, um das es ging, wird auf dieser Seite nicht mehr
gezeigt."*

### The page answers it, because the thread cannot

The panel reads the page's own document through `useDocAssets` — the walk the
files, images and links panels already use — and keeps the ids of the files
drawn as documents. Read inside the panel rather than handed down from the
sidebar, so the tree is walked only while this tab is open, which is the
arrangement those three panels already have.

`DocFile` gained `display`, because how a block draws its file turns out to be
part of what the page holds rather than a detail of the block.

### The quotation stays; the button stops pretending

The words are the whole of what the thread is about — losing them would make the
conversation unreadable, which is the reason a detached text thread keeps its own
(ADR-0046). The button that offered to show them is disabled, because there is
provably nothing to reach.

That control had been dead for every place thread since ADR-0151 — the page only
reveals a thread that has a *range*. This disables it where the answer is
certainly nothing and leaves it alone where a later round will make it scroll to
the mark.

## Consequences

**Five tests, mounted rather than read.** A source test would assert that a prop
is passed; the thing worth holding is the sentence a reader gets, and it is only
true once the panel has the page's list of what it holds.

### The test lied twice before it told the truth

It passed `locale` to `LocaleProvider`, which takes `initial`. So the locale was
`undefined`, the provider decided that was not English and fetched the German
catalogue — and the assertions ran against the English strings. The first
assertion happened *before* the fetch landed and passed; every later one ran
after it and failed.

Two tests green and two red, from one wrong prop name, with the red ones
rendering exactly the right sentence in the wrong language. Worth recording
because the failure looked like a bug in the feature for several minutes: the
rendered text was correct, and the comparison was not.

## Alternatives considered

**Call it detached.** The word means the text was rewritten. A place cannot be
rewritten, and ADR-0057 already had to take that same wrong sentence off the
canvas threads.

**Say "the file was deleted".** Wrong in two of the three cases, and unhelpfully
alarming in both.

**Drop the thread.** The objection outlives the block, exactly as a detached
thread outlives its paragraph.

**Ask the viewer instead of the document.** The viewer is destroyed when the
block goes, and absence of an announcement is not a message — the panel could
not tell "no viewer yet" from "no viewer ever".

**Hand the set down from the sidebar.** Then the tree is walked for every tab,
including the ones that do not care.
