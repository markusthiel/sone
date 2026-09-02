# ADR-0046: Comments

## Status

Accepted. Not built.

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

### Commenting requires edit rights, for now

No new role in this record. Anybody who may edit a page may comment on it; a
read-only share link cannot.

A "may comment but not edit" role is genuinely wanted — it is how a document goes
out for review — and it is not free: it touches page permissions (ADR-0026),
share links, groups and the role vocabulary in four screens. Adding it as a
side-effect of comments would be the kind of decision that gets made badly
because it was made while thinking about something else.

Named here as the intended next step, with the reason it is not this step.

## What is deliberately not decided

**Notifications and an inbox.** The next record, and a prerequisite for mentions
being more than a highlight.

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
