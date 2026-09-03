# ADR-0060: Replying to a comment by email

## Status

Accepted. Nothing built yet.

## Context

ADR-0058 sends a notification and deferred replying to one: "parsing a reply back
into a comment thread means quoting, signatures, forwarded chains and HTML, and
it means accepting text into a workspace from whatever can spoof a From header."

The parsing is tedious and finite. The From header is the actual problem, and it
has an answer — this record is mostly that answer, and the second half is about
how mail gets *in* at all, because nothing in SONE has ever received a message.

## Decisions

### The address the mail was sent *to* is the credential

Each notification's `Reply-To` is unique: `sone+<token>@instance`, where the
token is an HMAC over the thread, the message and the recipient, keyed with
`SONE_SECRET_KEY`.

**The `From` header is decoration and is never trusted.** A reply is attributed
to the person the token names, whatever address it arrives from — so a forged
From does nothing, and somebody replying from their phone's secondary address
still gets attributed correctly.

Signed rather than stored: no table, no expiry sweep, nothing to keep in step
with the notification it belongs to. The HMAC covers the recipient's id, so a
token leaked from one person's mailbox cannot post as anybody else — it can only
post as them, which is what possession of their mailbox already allows.

**It does expire**, in the token: fourteen days. A `Reply-To` from a mail
somebody finds in an archive two years later should not still write into a page.

### Mail arrives by IMAP, polled

SONE cannot receive SMTP: that needs a port reachable from the internet, DNS
records, and a story about spam that is a different profession. An operator who
can already send through a relay can almost always read from a mailbox on the
same account.

So: IMAP credentials, one mailbox, polled on the job queue. Unread messages are
processed and marked read; anything not addressed to a valid token is left alone
rather than deleted, because a mailbox somebody else also uses must not lose
their mail to us.

The interval is a setting, defaulting to two minutes. That is the whole cost of
this approach and it is worth naming: a reply appears in the page up to two
minutes after it was sent, and nothing in the interface should suggest otherwise.

### The reply is the text before the quoted part, and the rest is dropped

Best effort, and the rules are stated rather than clever:

- `text/plain` only. An HTML-only mail is answered with a refusal mail rather
  than a guess at what its markup meant.
- Everything from the first quote marker onwards is dropped: a line beginning
  `>`, or a line matching the common "On … wrote:" shapes in English and German.
- A trailing `-- ` signature block is dropped.
- Attachments are ignored in the first version, and the reply says so if there
  were any, because silence about a dropped file is worse than the file being
  dropped.

**And the result is marked.** A comment written by mail says so in the panel.
Not to shame it: quoting is guesswork, and somebody reading a mangled reply
should be able to tell that a machine trimmed it rather than that a colleague
wrote something strange.

### A reply that cannot be used is answered

An expired token, an HTML-only mail, an empty body after trimming: the sender
gets one short mail saying which of those it was and that nothing was posted.
Silence would leave somebody believing they had answered a colleague.

One reply mail per incoming message, never more, and never to an address that
did not just write to us.

### Internal threads reply the same way

The token identifies the thread, including one in the internal document
(ADR-0057), and the notification carried no content in the first place — so
nothing about replying to an internal thread leaks more than the notification
already did. The reply text goes into the internal document, where only members
can read it.

## Consequences

An operator gains IMAP settings beside the SMTP ones and a mailbox to dedicate.
The password is env-only, like the SMTP one and for the same reason.

A comment can now exist that nobody typed into SONE, which the panel has to show
honestly, and the "who wrote this" question gains a second answer: the token's
owner, not the From header.

## What is deliberately not decided

**Starting a thread by email.** A reply has a thread to belong to; a new mail has
nothing, and deciding which page an unsolicited mail is about is a different
feature with a different failure mode.

**Attachments.** Accepting a file from an unauthenticated channel into somebody's
workspace deserves its own decision about size, type and where it is stored.

**Anything other than IMAP.** No inbound SMTP, no provider webhooks. Both are
defensible and both are a second way in to keep correct.
