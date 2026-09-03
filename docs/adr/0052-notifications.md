# ADR-0052: Notifications and an inbox

## Status

Accepted.

## Context

ADR-0046 named this as the next record and as a prerequisite: comments exist, and
a mention of somebody is a label rather than a delivery. Somebody can ask a
colleague a question in a page and the colleague will never know unless they
happen to open it.

That is the most expensive gap left in SONE. Every other open item is a feature
somebody would like; this one is a promise the interface already appears to make
— it lets you write `@Anna` and shows her name — and does not keep.

## What a notification is for

One question decides the shape: **is this a record of what happened, or a list of
what needs attention?**

An activity feed is the first. It is easy to build, easy to make complete, and it
becomes noise within a week — a page anybody edits produces entries nobody reads,
and the one thing that mattered is on the third screen.

This is the second. **A notification exists when somebody has been addressed.**
Not when a page changed, not when a comment was written, but when a comment was
written *to them*. Everything else is what the page itself, the history panel and
the search are for.

The consequence, accepted deliberately: SONE will not tell you that a page you
care about changed. That is a *subscription*, it is a different feature, and
building it into the same table would turn the inbox into the feed this record
refuses.

## Decisions

### In Postgres, not in the document

A notification is about a person, not about a page. Two people reading one
document must not each carry the other's unread state — and a CRDT merges, so a
read flag in a document is a flag anybody can flip for everybody.

`notifications`: who it is for, what kind, which page, which comment thread, when,
and whether it has been read.

### Three kinds, and no more for now

- **`mention`** — somebody wrote your name in a comment.
- **`reply`** — somebody added to a thread you are in. Being in a thread means
  having written a message in it, which is a definition somebody can predict.
- **`assignment`** — a task assigned to you. **Built**: `assignee` in a task
  block's props, chosen from the workspace's people in that block's own menu.
  Only a task can carry one — a paragraph assigned to somebody is a note about
  them rather than work, and offering it everywhere would make the notification
  mean less each time it arrives.

  The block's id stands in for the message id, which makes it idempotent: a page
  is re-projected on every edit and finds the row already there. **Except that it
  did not.** The unique key in 0039 includes `thread_id`, an assignment has no
  thread, and two NULLs are distinct in Postgres — so the constraint matched
  nothing and somebody with one assigned task would have collected a
  notification per edit of the page. Migration 0040 makes the key
  `NULLS NOT DISTINCT` rather than putting a fake thread id in the column: the
  column means "no thread", and saying that with something shaped like a thread
  id would push the lie one layer down.

Deliberately not: page changed, page shared, workspace joined. Each is defensible
alone and together they are the feed.

### A mention is written as `@` and resolved when the comment is saved

The editor offers the workspace's people after an `@`, and what is stored in the
comment is the person's id beside the text — not the display name alone, which
would break the moment somebody is renamed and would match the wrong person if
two people share a name.

The resolution happens **when the comment is written**, not when it is read: a
mention is an act, and who was meant is decided at the moment of writing.

### Notifications are made by the server, from the projection

The client that wrote the comment does not create the notification. It would be
the obvious place and it is the wrong one: a client can be closed before the
write lands, can be a client that does not know about mentions, and — the real
reason — a notification a client creates is a notification a client can forge.

So the materialiser makes them, from the comment threads it already projects
(ADR-0046). One place, on the trusted side, and it happens for a comment
delivered by sync, by an import, or by any path that did not exist when this was
written.

That means notifications arrive *after* the projection, which is a moment or two
after the comment. Correct for something read on a different device anyway.

### Nobody is notified of their own writing

Obvious, and worth stating because the projection cannot tell without being told:
the author of a message is compared against the person the notification would be
for, and the notification is not made.

### A mention only notifies somebody who could read the page

Checked when the notification is created, not when the inbox is read. A
notification for a page somebody cannot open would show them a title and a
quotation from a page they have no access to — the disclosure is the
notification, not the click.

If access is granted later, they will not receive the old mention. That is the
honest trade: the alternative is keeping notifications nobody may see and
re-checking on every inbox read, which means storing a disclosure and hoping the
check holds.

### Read state is per person, and "read" means opened

A notification is marked read when somebody opens the thing it points at, not
when the inbox is looked at. An inbox that empties itself because somebody
glanced at it is an inbox that loses things.

There is a "mark all read", because after a week away the list is long and
somebody has to be able to declare bankruptcy on it.

### No email, and that is a decision rather than a gap

Email means SMTP configuration, deliverability, an unsubscribe mechanism, and a
queue that retries — and it means SONE sending the contents of somebody's
workspace through a third party. Worth doing, and worth doing on purpose in its
own record. It is now [ADR-0058](0058-email-notifications.md), whose central
decision is that the mail says *who* and *where* and never *what*: no message
text, no quoted passage, because a mailbox is not a permission system.

The inbox is in the application, with a count on the account button. What this
does *not* do is claim otherwise anywhere in the interface.

## Consequences

One table, one route to read it, one to mark things read, and a step in the
materialiser. The count needs to be cheap: it is on a button somebody sees on
every page, so it is a single indexed count of unread rows for that person, and
it is read once per navigation rather than polled.

A workspace's deletion takes its notifications with it by cascade. A person's
deletion takes theirs.

Duplicates are the risk. A page is reprojected whenever anything in it changes,
so a naive step would create the same mention notification on every edit. The
unique key is (recipient, kind, thread, message) — a mention is made once per
message, and reprojecting finds it already there.

## Alternatives considered

**An activity feed.** Described above. It is what most tools ship and what most
people turn off.

**Notifications written by the client that wrote the comment.** Simpler, and
forgeable.

**Delivery over the sync connection.** Tempting, since one is already open. It
would make a notification depend on having a document open, which is exactly the
case a notification exists for.
