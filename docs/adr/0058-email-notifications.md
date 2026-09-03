# ADR-0058: Notifications by email

## Status

Accepted. Nothing built yet.

## Context

ADR-0052 built the inbox and refused email on purpose: "SMTP configuration,
deliverability, an unsubscribe mechanism, and a queue that retries — and it means
SONE sending the contents of somebody's workspace through a third party. Worth
doing, and worth doing on purpose in its own record."

This is that record. The inbox works; what it cannot do is reach somebody who is
not looking at SONE, which is most people most of the time. A mention that waits
three days for its recipient to open a tab is a message that did not arrive.

Two things already exist and are worth using rather than rebuilding: the `jobs`
table has `attempts` with a comment saying it is there so retries need no
migration, and `notifications` already holds exactly what would be sent.

## Decisions

### The email says who and where. It never says what

**No message text, no quoted passage, no excerpt.** "Anna mentioned you on
Q3 Planung" and a link. Not "Anna wrote: can we drop the Meyer contract".

A mailbox is not a permission system. It is a third party's server, retained
indefinitely, searchable by whoever administers it, forwarded by accident,
readable on an unlocked phone on a table. Everything SONE has built about who
may read what — page permissions, restricted pages, ADR-0057's second document —
stops at the moment a body of text leaves for an SMTP relay.

The page title is included, because "you have a notification" is a mail nobody
can act on and everybody learns to filter. That is a real disclosure and it is
the one this record accepts: a title is a line somebody chose to name a thing,
not the thing.

An instance setting reduces even that to the workspace name, for an operator who
needs it. Off by default, because a default nobody can use is not a kindness.

### An internal thread's mention is emailed like any other

It can only reach a member — `writeNotifications` joins `workspace_members`
(ADR-0057) — and the mail carries no body, so the thing that must not leave the
workspace does not. Excluding internal threads would mean the more private
conversation is the one nobody hears about, which is backwards.

### One email per person per workspace, after a few minutes

Not one per notification. Somebody mentioned four times while restructuring a
page gets four mails, and the fourth teaches them to filter the sender.

A short delay — five minutes, one setting — then one mail per person per
workspace listing what is waiting. The delay is also what makes "she fixed it
herself two minutes later" not generate a mail at all, because the notification
is checked for having been read before the mail is sent.

### Read in the app means no email

A notification opened before its mail goes out is dropped from the batch. The
inbox is the primary channel; email exists for the person not looking at it, and
a mail about something already dealt with is noise that costs trust in every
later one.

### Unconfigured means absent, not broken

With no SMTP settings, no mail is attempted and nothing in the interface offers
it. Not a queue filling up, not a red banner on somebody's settings screen: a
self-hosted instance without a relay is a normal instance.

When it *is* configured, the per-person setting defaults to **on** for mentions
and assignments — the two kinds somebody is expected to act on — and off for
replies to threads they are merely in. A person who wants everything can say so.

### Sending happens in the job queue, with bounded retries

`kind = 'email_notifications'`, the existing `attempts` column, and a cap. A
relay that is down for an hour should not lose the mail; a relay that rejects an
address permanently should not be retried for ever. Five attempts with widening
gaps, then failed and visible in the administration screen.

### No tracking of any kind

No open pixels, no click wrapping, no per-recipient link ids. The link is the
page's URL. Knowing whether somebody read a mail is not worth becoming the kind
of software that measures it.

### The unsubscribe link goes to a settings page and requires signing in

Not a one-click token in the mail. A URL that changes somebody's settings without
authentication is a credential printed in a message that is forwarded, quoted and
stored — and the failure mode is somebody else turning your notifications off.

A `List-Unsubscribe` header is included for mail clients that offer the button,
pointing at the same authenticated page. It is a worse experience than one click
and it is the one that cannot be used against the recipient.

## Consequences

An operator gains SMTP settings to fill in and a per-person preference to
explain. The administration screen gains failed sends, which is where a wrong
password will show up.

The `notifications` table gains one column: when its mail was sent, or null. Not
a second table — the thing being emailed and the thing being shown are the same
row, and two tables would eventually disagree about whether something had been
delivered.

## What is deliberately not decided

**Replying by email.** Parsing a reply back into a comment thread means quoting,
signatures, forwarded chains and HTML, and it means accepting text into a
workspace from whatever can spoof a From header.

**Digest emails on a schedule** — a daily summary of everything. A different
feature with a different purpose, and one that needs someone to want it first.

**Anything but SMTP.** No provider APIs. SMTP is what a self-hosted instance can
already reach, and every provider integration is a dependency with an outage
somebody else schedules.
