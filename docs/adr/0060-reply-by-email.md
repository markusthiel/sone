# ADR-0060: Replying to a comment by email

## Status

Accepted. The token and the trimming are built and tested — the two halves that
are pure functions, and the ones carrying the security decision. IMAP, writing
the comment and the refusal mail are not.

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

## Built so far

**The token**, with the recipient inside the signature — the test that matters
edits a user id out of a valid token and expects `bad_signature`, which is the
attack the design exists to stop. The signature is checked before the expiry,
because an expired token that was never signed by us is a forgery and reporting
it as "late" would put it in the same bucket as a colleague's slow answer.

Addresses use sub-addressing (`sone+token@…`), so one mailbox serves every
notification: the difference between asking an operator to configure a mailbox
and asking them to configure DNS.

**The trimming**, as the stated rules rather than a heuristic — and with the one
test that keeps it from being clever at somebody's expense: "Am Montag schrieb
ich das falsch, sorry." is a sentence, not an attribution, so a match only counts
when quoted or indented text follows it. Cutting there would have silently
deleted the rest of a reply.

**Reading the mail.** A small MIME reader, and it is small *because* the
decisions above refuse things: plain text only, no attachments, no HTML
conversion. What remains is headers, one multipart split, two transfer encodings
and two charsets — six steps, which is the honest reason not to take a
dependency for it. A general MIME parser is a library; this is what is left once
the scope is decided.

Deliberately declined rather than guessed at: nested multiparts beyond the first
level, `message/rfc822` forwards, and charsets beyond UTF-8 and Latin-1. Each
yields "no text part", which the caller answers with a mail saying to send plain
text.

`Delivered-To` is read before `To`, and that is a security detail rather than a
preference: the token lives in the sub-address the *mailbox* saw, and `To` may
have been rewritten by a list, a forward or somebody's filter.

**The IMAP client.** Six commands, written for the same reason as the SMTP one
and with the same condition: tested against something that speaks the protocol
rather than against my idea of it.

The part hand-written IMAP clients get wrong is **literals**. A server answers a
FETCH with a byte count and then exactly that many bytes, which may contain
anything — including a line that looks like a tagged completion. A client that
scans for its own tag finds one inside somebody's mail and stops there, leaving a
message that still looks like a message. The fake server's second test sends
exactly that, and the client counts bytes.

The socket is read as latin1 on purpose: one byte, one character, so a count is
a count. Decoding as UTF-8 here would make the byte count wrong for any mail
containing an umlaut and land the truncation mid-message — the MIME reader
decodes properly afterwards, where the charset is known.

Messages the handler declines are left **unread**, which is the protocol side of
a decision above: a mailbox somebody else also uses must not lose their mail to
us.

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
