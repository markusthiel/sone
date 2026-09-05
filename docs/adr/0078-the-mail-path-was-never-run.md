# ADR-0078: The mail path was never run

## Status

Accepted. Amends ADR-0060.

## Context

ADR-0076 ended with a sentence about a mechanism nobody had exercised, and
ADR-0077 was that sentence happening again in a different place. This is the
first of the audits those two argued for: replying to a notification by email.

The parts were well covered. The MIME reader, the reply token, the quote
trimmer and the IMAP client each have their own test file, and the IMAP client's
runs against a server that actually speaks the protocol. What had no test at
all was `pollReplies` — the function that puts the four together and makes every
decision between them. **Nothing in the repository imported it.**

Five faults were in there, and each of them is a decision the parts cannot make
alone.

**The access check was the loosest rule in SONE.** `mayComment` asked whether
there was a row in `workspace_members`. Everything else asks `resolvePageAccess`
and then `atLeast(access, 'commenter')`, and the difference is not academic:

- A **guest** satisfies a join on `workspace_members` and gets nothing by role
  (ADR-0026). The inbox route has always refused them. The mail path accepted
  them.
- A **restricted** page replaces the member default with what was granted
  explicitly. `mayComment` never looked at `restricted`, `page_permissions` or
  `page_group_permissions`, so a plain member could answer by mail on a page
  they cannot open in SONE.
- A workspace with `deleted_at` set was still a place to write to.

Being mentioned is what produces the notification, and the notification is what
carries the fourteen-day token. Losing access afterwards is precisely the case
the function exists for, and it is the case it got wrong. The comment above it
described the right rule; the SQL under it did not implement it.

**A refusal could not be delivered, and failing to deliver it broke the poll.**
The `From` header was handed to `sendMail` whole, so a perfectly ordinary
`From: Anna Beispiel <anna@example.org>` produced
`RCPT TO:<Anna Beispiel <anna@example.org>>`. Every relay rejects that. The
throw escaped before the message was marked read, so the mail stayed unread, the
rest of the batch was abandoned, and the same failure repeated every two minutes
for as long as that message sat in the mailbox. Every other caller of `sendMail`
passes an address out of `users.email`, which is why this was unique to the one
path that writes to an address a stranger supplied.

**A refusal that could not be sent was dropped silently while the mail was still
consumed.** `if (!current.relay || to === '') return;` — and then the poll went
on to mark the message read. An instance with IMAP configured and no relay ate
every unusable reply and told nobody: not the sender, not the operator, not a
log. That is the exact outcome ADR-0060 exists to prevent, reached by a
different road.

**The whole poll's errors were swallowed without a word,** and its result was
computed, returned and dropped. An unreachable mailbox, a wrong password, an
oversized message and a database error were identical and invisible, and nothing
anywhere recorded that a reply had been posted. Comments could stop arriving
entirely with nothing to look at.

**Nothing stopped two polls overlapping.** A poll may legitimately take longer
than the two-minute interval — fifty messages, each with its own step timeout —
and two overlapping polls both search for unread mail, both find the same
message, and both can post it before either marks it read. Nothing dedupes on
the mail's `Message-ID`, so the reply appears twice, as two comments.

And then, found by accident while writing the tests, the one an actual person
would have noticed first:

**An umlaut arrived doubled.** A plain 8-bit body — what a phone sends — was
decoded with `Buffer.from(body, 'utf8')`. But the mail reaches the reader as a
string the IMAP client deliberately keeps byte-for-byte by reading the socket as
latin1, so re-reading it as utf8 re-encodes every character above 127. `Grüße`
became `GrÃ¼ÃŸe`, in the page, for as long as replying by mail existed. The
base64 and quoted-printable branches were right, and both umlaut tests in
`readMail.test.ts` were written for those two — because those encodings exist
*because* a mail has non-ASCII in it, so that is where anybody thinks to put a
charset test. The plain case is the one that carries the bug and the one nobody
tests.

## Decision

**`pollReplies` is tested end to end**, in `replies.db.test.ts`: a real IMAP
conversation over TLS into a real database, then a look in the document and in
`page_comments` for the sentence. Sixteen cases, and they are the decisions
rather than the parts — who may post, what is left unread, what is refused, what
is consumed.

**The mail path asks the same access question as the inbox route, in the same
words.** `mayComment` is `resolvePageAccess` + `atLeast('commenter')`, and
`locate` carries the `archived_at`/`deleted_at` conditions the route carries.
Two paths to one action get one rule; the previous arrangement is how a second
path becomes a way around the first.

**A refusal goes to a parsed address or to nobody.** `addressIn` takes the bare
address out of a header that may carry a display name, and returns null rather
than a guess. Null is not silence: the caller says out loud that it could not
answer, and so does a missing relay. `sendMail` also applies `headerSafe` to the
recipient now — never load-bearing before, because every other caller passes an
address out of the database, and exactly the kind of second lock that belongs on
the door a stranger's text reaches.

**The poll speaks.** Failures are logged, results are logged when there is
anything to say, and a flag stops a second poll starting while one is running.

**A plain body is decoded as the bytes it is.** `Buffer.from(body, 'latin1')`,
which recovers what the socket delivered, and then the charset decides how to
read it — which is what the other two branches already did.

## Consequences

An instance that has been running this feature has comments in it with doubled
umlauts. They are ordinary text in the document now; nothing rewrites them, and
nothing should — an automatic repair of somebody's words is a worse idea than a
few wrong characters in an old comment.

Anyone who was answering by mail on a restricted page, or as a guest, will now
be refused with "You no longer have access to that page." That sentence is
accurate about the outcome and misleading about the history: they never should
have had it. It is the right message for the person and the wrong story about
what happened, and the honest version — "you never had access to that page" —
would be worse to receive. Left as it is.

The IMAP fake moved to `test/support/imap.ts` and had a fault of its own: it
counted a literal's bytes as latin1 and wrote the string as utf-8, so any
non-ASCII message announced a byte count the payload did not have. Nothing
noticed because every message it had ever served was ASCII or base64. A test
harness gets the same treatment as the code — it is the thing standing between a
claim and the truth.

What remains unexercised in this area, named rather than fixed: the IMAP
authentication failure path (the fake accepts any LOGIN, and TLS verification is
switched off process-wide in both files that use it), the per-poll size and
count limits, and `Reply-To` generation in the notification job — no test
asserts that a notification mail actually carries the address this whole feature
depends on. ADR-0060 also says replies are "polled on the job queue"; they are
polled on a bare interval, with no job row and no record of the run.

The pattern across ADR-0076, 0077 and this one is now hard to miss. Each time,
the parts were tested and the seam was not, and each time the seam is where the
decisions live. The remaining audits — digests, maintenance, OIDC,
backup/restore — should be read as this one was: not "is the code good" but "is
there anything that has ever run it".
