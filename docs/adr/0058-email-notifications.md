# ADR-0058: Notifications by email

## Status

Accepted and built end to end: the settings, the storage, the composer, an SMTP
client, the batching sweep, the send job, the per-person screen and the failed
sends an operator can see. Two things the record got wrong on the way are
recorded where they were wrong.

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

**This section promised "who" before the data had it.** The job's query joined
an actor and Postgres refused the column: a notification recorded the user, the
workspace, the page, the kind and an excerpt, and not who caused it. SQL is not
typechecked, so it would have shipped and failed on the first mail.

`notifications.actor_id` exists now. A mention or a reply takes the message's
author; an assignment takes whoever's edit produced the projection, because a
todo block records who it is *for* and not who gave it. Null stays a real
answer — rows written before the column, and an account since deleted — so the
composer keeps two wordings per kind rather than a name glued to the front:
German cannot prefix "Du wurdest erwähnt" with a subject and stay grammatical,
and neither can English.

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

## Built so far

The instance settings (`smtpHost`, `smtpPort`, `smtpUser`, `smtpFrom`,
`smtpSecurity`, `emailDetail`), with the **password only from the environment**
for the same reason as the OIDC secret (ADR-0024): a secret in a table is a
secret in every backup.

The storage: `notifications.emailed_at`, a partial index over what is still
unread and unmailed, and three per-person preferences. `emailed_at` being null
covers "not yet", "no relay" and "does not want mail" on purpose — the sender
decides afresh each time, and a column recording *why* would be a second place
for that decision to live.

And the composer, separate from the sending so the rule can be tested without a
relay — which is the part worth testing. Its first test searches the output for
content rather than checking wording, so a future change that adds an excerpt
"for context" has to make it fail.

**An SMTP client, written rather than depended on.** A trade worth stating:
sending mail in general is a large problem — queues, bounces, DKIM, dozens of
servers behaving differently — but handing one message to *one relay an operator
configured* is EHLO, STARTTLS, AUTH, MAIL FROM, RCPT TO, DATA. The server has six
runtime dependencies and that is a number worth keeping.

The condition on the trade is that it is tested against something that speaks
back. There is a fake relay in the tests that answers EHLO across four lines
(a client reading one line hangs against every real server), undoes dot-stuffing
so a truncated body is visible as one, and records everything it was told so a
newline smuggled into a subject can be seen not to have become a header. A
password is refused outright over an unencrypted connection: a credential in the
clear is worse than no mail.

**The batching sweep and the send job.** The runner is row-driven, and there is
no natural row per person, which forced a decision the record had left open: a
sweep claims what is ready and enqueues one job per person per workspace, and
the queue owns the retries because `jobs.attempts` exists for that and a sweep
of its own would retry a permanently rejected address for ever.

**So `emailed_at` means "claimed for mail", not "delivered".** Set at enqueue,
not on the relay's acceptance. That is the uncomfortable half and it is the
right way round: the alternative re-enqueues the same batch every minute while a
relay is misconfigured, turning one wrong setting into an unbounded queue. A
send that fails after its retries is a failed job an administrator can see, and
the person is still told in the inbox — the primary channel.

The claim is one statement, so its `WHERE` is where every rule in this record
lives: the delay, the read check, the per-person preference, an address that does
not exist. `FOR UPDATE SKIP LOCKED` is what keeps two overlapping ticks from
each enqueuing the same batch. The preference is read at claim time rather than
at write time, so turning mail off stops what is already waiting instead of
having decided somebody's next week.

### Set in the administration area, except the password

The five values that describe a relay — host, port, encryption, user, sender —
and the detail setting are ordinary instance settings: an administrator changes
them without a redeploy, and each row says whether the value came from the
database or the environment.

They were settings from the start and **no screen drew them**, which meant that
from an administrator's side they were environment-only whatever the code said.
That is worth naming as a failure mode of its own: a key in `SETTING_KEYS` and a
route that accepts it are not a feature until something renders it.

**The password stays in the environment**, as `SONE_SMTP_PASSWORD`, for the same
reason as the OIDC secret (ADR-0024): a secret in a table is a secret in every
backup, in every `pg_dump` somebody mails themselves, in every copy of a staging
database. It is refused as an unknown setting rather than silently ignored, and
the user field's hint says where it lives — an administrator hunting for the
field deserves an answer rather than an absence.

Encrypting it in the database with `SONE_SECRET_KEY` would work and was
considered: the key is not in the backup, so the ciphertext in one is useless.
It is not done because it buys convenience at the cost of a second place where a
credential lives, and an operator who can set one environment variable can set
two.

**The per-person screen, at the address the mail already gave out.** The
unsubscribe line says `/settings/notifications`, and that section did not
exist when the line was written — a link in a message that cannot be recalled,
pointing at nothing. It exists now, and a test ties the two together so neither
can move without the other.

Three ticks, saved on change rather than behind a button, and the screen says
what a mail contains before asking whether somebody wants one: that is the part
a person deciding this actually wants to know, and nothing else in the interface
says it. The preferences ride on the existing profile route rather than one of
their own — they are three fields of a person's own account, and a second route
would be a second place to authorise the same thing.

**Failed sends are an anomaly in the maintenance panel**, counted across every
workspace because a relay is an instance-wide thing: one wrong password fails
every workspace's mail, and an operator should see one number rather than a hunt.

It counts against the panel's all-clear, which is the part that matters — a
panel saying "nothing is wrong" while mail is failing teaches an operator not to
read it. The explanation names the likely causes and says the notifications
themselves are not lost, because that is the fact that stops somebody hunting.

## Still to build

Nothing. The record's decisions are all built; what remains is under
"deliberately not decided" below.

## What this made possible elsewhere

A **password reset by email**, which was impossible while the server had no mail
path and is now [ADR-0059](0059-password-reset.md). Worth noting here because it
is the second feature this one enables rather than provides, and because the
`password_resets` table that had been waiting since `0004_auth` was dropped
rather than adopted — a table shaped years earlier is not a decision about what
a token should be.

## What is deliberately not decided

**Replying by email.** Parsing a reply back into a comment thread means quoting,
signatures, forwarded chains and HTML, and it means accepting text into a
workspace from whatever can spoof a From header.

**Digest emails on a schedule** — a daily summary of everything. A different
feature with a different purpose, and one that needs someone to want it first.

**Anything but SMTP.** No provider APIs. SMTP is what a self-hosted instance can
already reach, and every provider integration is a dependency with an outage
somebody else schedules.
