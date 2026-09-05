# ADR-0085: Naming somebody

## Status

Accepted. Completes ADR-0052, which specified mentions and could not produce
one.

## Context

The report was a question: "how do I mention anybody at all? I typed `@` and
expected a list of names, and nothing came."

The answer is that there was no way. **The entire feature existed except the
part where a person uses it.** `mentions: string[]` has been a field on a
comment message since ADR-0052. `notificationsFor` reads it and produces
`kind: 'mention'`. The inbox filters by that kind, the per-kind mail preference
`mentions_when` is on the settings screen, `claimForEmail`'s CASE names it, and
the mail composer has a sentence for it in two languages. Nothing anywhere could
set the field: no `@` in the editor, no picker in either comment box, and the
only two writers — `addThread` and `addMessage` in `useComments` — never passed
one.

This is the fifth finding of the same shape in a week, and the largest. ADR-0078
found a seam with no test; ADR-0082 found a route that could not create an
account; here a whole feature is wired end to end from the model to the
notification mail, and the first step is missing.

## Decision

**In the page's text, a mention is a node.** An inline atom carrying `userId`
and `label`. Plain text would be a string that stops meaning anything when
somebody's display name changes, cannot be told apart from the same characters
typed by hand, and gives a notification nothing to address. A caret goes round
it rather than into it, because half a mention is not a smaller mention.

The label is stored beside the id rather than resolved when drawing. That is a
copy and it goes stale, and it is still right: a document is read by clients
that may not be allowed to list the people in a workspace, and one that cannot
resolve an id would otherwise draw a blank where a name was.

**A mention contributes its name to the block's text.** An atom has no text
children, so without this the sentence "@Anna, can you look at this?" is indexed
and excerpted as ", can you look at this?" — and searching for a colleague's
name finds every page except the ones that name them.

**The trigger is `@` at a word boundary, and the difference from `/` is the
whole design.** `/` is rare in prose, so the slash menu opens after whitespace
and closes on a space with no match. `@` is not rare at all: every email address
has one. So an `@` mid-word never opens a menu, and what closes one is *length*
rather than a space — because a name has a space in it and "Markus Thiel" would
otherwise be unsearchable.

**The plugin holds a query and never a list.** `@sone/editor` has no business
knowing how this application asks a server who is in a workspace, any more than
it knows how translations are stored (ADR-0041's reasoning, applied again). So
the plugin owns the trigger, the query and Escape; the interface owns the list,
the filtering, the arrows and Enter, and calls `insertMention` when somebody is
chosen. That is why this is not the slash menu with a different character.

**Who is offered: the workspace's members**, from the list the assignee picker
already fetches. One request per page rather than one per `@`, and one answer to
"who is in this workspace" rather than two.

**Notifications come from the projection, never from the client**, exactly as
comment notifications do (ADR-0052): a notification a client creates is a
notification a client can forge. `mentionsIn` reads the document; the
materialiser hands the result to `writeNotifications`, which already filters by
`visiblePagesCondition` — so mentioning somebody who cannot see the page tells
them nothing, which is right and needed no new rule.

**Addressed by the block.** One notification per person per block, using the
uniqueness constraint that is already NULLS NOT DISTINCT over
(user_id, kind, thread_id, message_id). Editing the sentence around a name does
not announce it again, and the block is also where the notification sends
somebody — "somewhere on this page" is not where to look. Never to the person
who wrote it: naming yourself is a note to self.

**In a comment, the same rules and a different mechanism.** A comment is a
string, not a document, and making it a second ProseMirror instance would be a
second document model for one sentence. So the picker works from the caret in a
textarea, and the ids live beside the text in `mentions`, as ADR-0052 shaped it.

Which ids count is then a real question with no perfect answer, and the one
chosen is: **an id counts if its `@label` is still in the text.** Type a name,
change your mind, delete it, and the notification goes with it. Two people with
the same display name would both be notified by one mention of that name. That
is matching by label, which is precisely the fragility a node exists to avoid —
and it is the honest behaviour available to a string. The alternative, keeping
every id ever picked, sends somebody a notification about a sentence that does
not name them.

## Consequences

The draft and the people picked for it are one piece of state, held by the
caller rather than by the composer. That is not tidiness: there is a **button**
beside the box as well as Enter, and a component keeping the ids privately would
leave that button able to send the text and not the people named in it. Both
paths go through one function now — they were two copies of the same three lines
before, which was a duplication that had not yet had a chance to be a bug.

A guard in `scale.test.ts` had to change with it, and its subject did not: a
thread still appears only once something is written.

A mention is not a link. Nothing happens when you press one, and it carries no
address to a profile — there is no profile screen to go to. The tint says the
name means a person; that is all it currently promises, and promising a click
that does nothing would be worse than promising nothing.

Two things this does not do, named rather than implied. A mention does not
notify somebody who is **added** to a page's audience later — the notification
is made when the sentence is written, and a person granted access afterwards
gets nothing. And **renaming somebody does not update the labels already
written**: the id is what is meant and the label is what is drawn, so a page
written last year shows the name as it was. Refreshing them is possible — the
ids are all there — and it is a decision about editing somebody's writing after
the fact, which is its own record.

The comment field's fragility deserves one more sentence, because somebody will
hit it: a colleague renamed between typing `@Anna` and pressing Enter loses
their notification, since the label no longer matches. The window is seconds
wide and the failure is silence rather than a wrong recipient, which is the
right way for it to fail.
