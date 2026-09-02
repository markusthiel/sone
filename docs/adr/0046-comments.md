# ADR-0046: Comments

## Status

Accepted, and built — model, editor anchors, panel, and the Postgres projection.

## Context

The largest gap the September review found: Docmost, Outline and Confluence all
have inline comment threads with resolve, and SONE has nothing. It is also the
one people ask for by name as soon as a second person opens a page.

It cannot be added late, and the reason is worth stating precisely. A comment is
attached to a *range of text*. That range is in a CRDT that other people are
editing at the same time, including inside the range and including deleting it
entirely. So "where does this comment point" is a question about the document's
own model, not about a panel — and getting it wrong is not a layout bug, it is a
comment that ends up quoting the wrong sentence.

## Decisions

### The anchor is a pair of Yjs relative positions

Not an offset, not a block id plus a character count. `Y.RelativePosition`, which
Yjs provides precisely for this: it names a position by the item it sits beside
rather than by how far along it is, so it survives insertions and deletions made
by anybody, in any order, with no coordination.

An offset would be wrong the first time somebody typed a word above it. A block
id plus an offset within the block would be wrong the first time somebody edited
that block, and would break entirely when the block is split in two.

Stored encoded (`Y.encodeRelativePosition`), so the anchor is bytes and can be
written into the document like any other value.

### A comment quotes its text at the moment it is made

The range it points at can be edited or deleted. So the thread also stores the
text as it read when the comment was written.

This is not a cache — it is what the comment is *about*. "This paragraph is
wrong" is unreadable a week later if the paragraph has been rewritten, and the
quotation is the difference between a thread somebody can still understand and a
thread that has to be deleted because nobody can tell what it meant.

### A thread whose text is gone is detached, not deleted

When the anchor no longer resolves, the thread does not disappear. It is marked
detached and stays in the panel, showing its quotation and its replies.

Deleting it silently would mean somebody's objection vanishes when the text they
objected to is removed — which is precisely the case where the objection matters
most. An unresolved detached thread is a thing a person should have to look at
and close, not something the application closes for them by losing it.

### Threads live in the document, and are projected into the database

`comments: Y.Map<Y.Map>` in the document, keyed by thread id, each thread holding
its anchor, its quotation, its resolved state and a list of messages.

In the document because: it syncs by the mechanism already there, it works
offline, it is restorable from the log, its permissions are the page's, and the
anchor has to live beside the text it refers to or the two can get out of step.
A comments table with its own sync path would be a second real-time system.

Projected into Postgres by the materialiser, which already exists for exactly
this shape of problem (the document is the truth, the projection is what can be
queried). That is what makes "every unresolved thread in this workspace",
"comments addressed to me" and an unread count possible without opening every
document.

Same discipline as everywhere else here: the projection is rebuildable and never
authoritative.

### A message names its author explicitly

Unlike prose, where authorship is inferred from client ids and pruned when the
words go (ADR-0022), a comment message carries its author's user id as a field.

Because a comment is a *statement by a person*, and "who said this" must not be
recoverable-in-principle-from-the-log — it must be part of what was said. It also
must not be pruned: attribution for prose is an annotation whose loss costs a
label, while an unsigned comment is a different thing from a signed one.

A guest with a share link that permits commenting is recorded by the name they
gave, using the same `guest:` key as ADR-0022, and shown as a guest.

### A guest can comment, under the name they gave

A share link that grants editing grants commenting, and the guest's messages
carry the `guest:` key from ADR-0022 — the name they typed when the link asked
for one — shown beside the name as *guest*, as in the people panel.

That is the whole point of a comment from somebody without an account: a review
by a client, a contractor or a colleague from another company is the case comments
exist for, and forcing an account first is how a review does not happen.

The name is self-declared and unverified. It is displayed as a guest's name and
never as a member's, which is what the prefix is for, and the same merge applies:
two guests who type the same name are one identity. On a comment thread that is
more visible than it is in the people panel — two people called Anna answering
each other under one label — and it is still the honest outcome of an identity
nobody verified. A per-session id would list one reconnecting person twice, which
in a conversation is worse.

### A guest can be addressed, but not notified, and the difference is stated

Asked for, and the answer has two halves.

**Replying to a message is how anybody is addressed.** A reply quotes the message
it answers, works for members and guests alike, needs no identity beyond what the
message already carries, and cannot address the wrong person. This is the
mechanism, and it should be built first for that reason.

**A mention of a guest is a label, not a delivery.** A member has an account, an
address and (soon) an inbox. A guest has none of those: there is nowhere to send
anything, and while their session is open they are already looking at the page.
So `@` on a guest highlights the name and links to what they wrote — and must not
be styled or worded like a mention that reaches somebody.

That distinction has to be visible in the interface rather than only true in the
code, because a mention that looks like it will reach somebody and does not is
worse than no mention: the person who wrote it believes the question has been
asked. So a guest mention says so — it names them as a guest, and there is no
"notified" state to imply otherwise.

`@` therefore offers members first, and guests who have written on *this page*
second. Not every guest who ever held a link: a list of self-declared names from
strangers is not an address book.

### A commented passage is marked, and how is the reader's choice

Three options were on the table: a speech-bubble icon in the text, a highlighter
colour, either, or both.

**Not an icon in the text.** It changes the line it sits in — the text reflows
around it, so turning marks off would move every paragraph after the first
comment — and a page under review would carry a rash of bubbles. An icon also
says "there is something here" without saying *what*, which is the one thing the
quotation in the panel already does better.

**A highlighter colour, faint, is the default.** It is the mark everybody has
already met, it costs the text no space, and it says exactly as much as it
should: these words are being discussed.

**And it can be turned down.** Three states — highlight, a thin underline, or
nothing — because somebody reading a page they did not write wants the marks and
somebody proofreading their own prose does not.

**One control, and it says all three states.** Kept in the browser rather than
on the account or in the document — how much marking somebody wants depends on the
screen they are reading on, and a setting in the document would hide the marks for
everybody.

Corrected after building it: there was also a "mark commented passages" checkbox
beside the list, which is the same decision as choosing "not at all" from it. Two
controls for one thing, able to disagree, and the reason the tick appeared to keep
coming back on.

### Folding is remembered, per page and per browser

A thread somebody folded stays folded across a reload: folding is something they
did on purpose, and a reload undoing it is the application forgetting an
instruction.

Not in the document, for the reason the mark switch is not: it would fold a
thread for everybody, and a page's comments are not one reader's business to
hide. Not on the account either, because the amount of panel somebody wants on a
phone is not the amount they want at a desk.

What is stored is the set of *closed* threads, never the open ones. A thread that
arrives while nobody is looking must be open — a new comment hidden by a
preference set last week is a comment nobody reads.

What is *not* checked on reading is whether those threads exist. That check
belongs to writing only: on a reload the document has not arrived yet, so the
thread list is empty, and intersecting the stored set with it discards
everything — which is the same mistake as seeding the editor before Yjs had
synced (ADR-0002's lesson, learned again). An id for a thread that is gone
matches nothing when drawing, and is dropped the next time somebody folds
anything.

The store is bounded to the last thirty pages. Otherwise it grows for ever: every
page anybody folds a thread on leaves an entry, and a page that has since been
deleted leaves one that nothing can ever clean up, because nothing left knows
what it referred to.

### Comments are visible to anybody who can read the page, including guests

Which is the correct default and a hazard worth writing down: **the moment a share
link is given out, every existing comment on that page becomes visible to whoever
holds it.** A team that has been discussing a draft in comments and then sends the
link to a client has published that discussion.

Nothing in this record fixes that, and pretending otherwise would be worse than
naming it. What this record requires is that the share dialog says it, in the
place where the link is created, with the number of threads on the page — the same
argument as the trash button carrying its count: the fact that changes the
decision belongs where the decision is made. **Built**, and only when the page has
comments: a warning that appears every time is a warning nobody reads.

### Why "internal threads" is not the small feature I called it

The deferred item below reads as though a flag on a thread would do it. It would
not, and the reason is worth having here rather than discovered later.

A sync room sends a client **the whole document**. A share-link visitor therefore
receives every comment on the page as data, on their machine, before anything
decides what to draw. A thread marked "internal" would be hidden by their
interface and present in their browser — which is not a privacy feature, it is a
worse one than none, because it would be believed.

Doing it honestly means internal comments living in a **separate document**,
synced only to members: a second room per page, its own place in the update log,
its own authorisation, and a panel that reads two sources and merges them. That is
a real piece of work and its own record — not a flag.

Until then, the warning above is the honest answer: the hazard is named where the
decision is made.

An *internal* thread, invisible to guests, is the real answer and is deferred: it
needs a visibility on a thread, a rule for what happens when the page is exported,
and a way to see at a glance which threads are which. Named as intended.

### A message is plain text with mentions, not a document

One text field. No blocks, no nesting, no slash menu.

The same argument as a canvas note (ADR-0043): a document per message means a
second editor instance per message, with its own schema version and migrations,
inside a list. What a comment needs beyond plain text is `@` — for a person,
which is how a comment reaches somebody, and for a page, which is how a
discussion points at the thing it is about.

**Mentions need an inbox to be worth having**, and an inbox is notifications,
which is its own decision (delivery, read state, email, digests). So: the mention
*mark* is part of this, and the inbox is the next record. A mention that only
highlights a name is still useful; a mention that promises delivery and does not
deliver is not.

### Resolving hides a thread from the page and keeps it in the panel

Resolved is a flag on the thread, not a deletion. The highlight in the text goes;
the thread stays, filterable. A resolved thread is a decision that was made, and
those are worth being able to find.

Anybody who may comment may resolve. Restricting resolve to the thread's author
sounds tidier and is wrong in practice: the person who fixes the paragraph is
usually not the person who complained about it.

### Commenting requires the `commenter` role, which already existed

Corrected while building something else: this record said "no new role, commenting
requires edit rights", and a `commenter` role has been in the access model since
the beginning. `share_role` is an enum of viewer, commenter, editor, admin;
`claims.ts` has `canComment` sitting beside `canEdit`; share links accept it.

So there was nothing to add and something to *use*. Commenting is `canComment`,
which an editor satisfies and a viewer does not — and a share link can already be
created that permits comments and refuses edits, which is exactly the review case
this feature is for.

What was genuinely missing was smaller than a role: no screen offered it, so the
capability existed and nobody could reach it. Now built — the page-permissions
screen lists it beside the other three, and a share link could already be created
with it.

The test for it reads the server's own list of levels rather than a copy, so the
next level added there fails a test instead of quietly having no interface.

The lesson is the one this codebase keeps teaching: I asserted an absence without
checking, and the assertion was in a record other work would have trusted.

Named here as the intended next step, with the reason it is not this step.

## What is deliberately not decided

**Notifications and an inbox.** The next record, and a prerequisite for mentions
being more than a highlight.

**Internal threads, invisible to guests.** Decided above to be the real answer to
the disclosure hazard, and deferred with its own requirements.

**Comments on a canvas item.** The anchor there is an item id, which is a far
simpler problem than a text range — deliberately left until the text case is
working, so the harder one shapes the model rather than the easier one.

**Comments on a collection row.** A row is a page, so it comes free; whether the
table shows a marker is a separate question.

**Suggestions and tracked changes.** A different feature that people ask for in
the same breath. It needs the anchor from this record and nothing else from it.

## Consequences

The document format changes: a new root key. That is `SCHEMA_VERSION` to 4 and a
migration step, by the rule ADR-0043 established — an older client that does not
know the key will not destroy it, but a client that cannot show a comment must
not let somebody delete the text a comment is attached to without knowing.

The materialiser grows a third projection beside blocks and properties, and the
search index should include comment text: a discussion about a decision is often
where the decision is actually explained.

Every place that deletes text has to stop being casual about it. Deleting a
paragraph with an unresolved comment on it is a thing worth saying out loud
before it happens, and nothing in the editor currently says anything before
anything.

## Alternatives considered

**Comments in Postgres, keyed by block id and offset.** Rejected: the anchor
breaks on the first concurrent edit, and it puts a second real-time system beside
the one that works.

**Comments as a special block in the document body.** Rejected: a comment is
about text, not part of it. It would appear in exports, in the outline, in search
results as content, and in the plain-text projection — all wrong.

**Google-Docs-style anchored to a selection with no quotation.** Rejected: it is
what makes a stale thread unreadable, and storing fifty words of quotation is
cheaper than a thread nobody can interpret.
