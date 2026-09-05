# ADR-0081: The mail that was never sent

## Status

Accepted. Fourth of the audits argued for by ADR-0076 and ADR-0077. Amends
ADR-0058, ADR-0061 and ADR-0062.

## Context

Notification mail is covered at both ends and cut in the middle. `claimForEmail`
runs against a real database, with eight cases including the timezone clause.
`composeNotificationEmail` and `sendMail` have their own files, and `sendMail`
is tested against a server that speaks SMTP. Between them sit `writeNotifications`,
`sweepForEmail` and `emailNotificationsHandler` — the three functions that turn
an event into a mail — and **nothing imported any of them**.

The activity digest is the same shape: `changedFor` and `composeDigest` are
tested, and `sendActivityDigests`, which decides who gets one and when, is not.

Six faults, and the first is the one somebody would have noticed.

**A notification put off until later was still mailed about.** ADR-0075 shipped
"Später" three days ago: asleep means absent from the list and absent from the
badge, because a count that includes what somebody deliberately put off is a
count nobody believes. `claimForEmail` never learned it. Putting something off
until Monday morning still sent the mail about it that afternoon — the loudest
possible way to tell somebody they cannot put a thing off.

**A reply address vanished when an assignment came first.** The address named
the batch's *oldest* notification, always, and an assignment carries no thread.
So a batch whose oldest item happened to be an assignment got no `Reply-To` at
all, however many answerable mentions were listed under it. The reasoning —
"the first is the one the subject line names" — is true for a batch of one and
only then: with several, the subject is "3 things in ⟨workspace⟩" and names
none of them. The token was minted anyway, with an empty thread id, and thrown
away.

**A failed digest lost the day and recorded it as delivered.** The watermark
moved *before* the send. A relay failure therefore advanced the reader past a
window they were never told about, and nothing mentions it again. Worse, the
throw escaped the loop: everybody sorting after that reader was skipped for the
hour — and since the gate is "eight o'clock in your timezone", for the day.

**A claim without its job was a mail nobody would ever send.** `claimForEmail`
marks every batch `emailed_at = now()` in one statement; the queueing was a loop
after it. A throw on the third batch left the fourth onwards marked as emailed
with no job, and `emailed_at IS NULL` is the only way back in.

**The queue did not retry, and the record said it did.** ADR-0058: "Five
attempts with widening gaps, then failed." `runOneJob` wrote `failed` on the
first exception; `attempts` was incremented at claim and read by nobody;
`retryDelayMs` — in the maintenance job, about a different queue — had two tests
and no callers (ADR-0080). This is not a cosmetic gap between record and code.
The whole argument for letting `emailed_at` mean "claimed" rather than
"delivered" is that *the queue owns the retries*, and it did not: one transient
relay hiccup discarded a batch of somebody's notifications permanently.

**Both timers swallowed everything, silently.** An unreachable database, a
schema drift, a relay outage and a bug were identical and invisible, and the
counts each pass computed were returned and dropped. The reply poll next door
was given a voice four days ago (ADR-0078) and these two were not.

Two smaller ones. The digest grouped by workspace **name**, so two workspaces
called "Projekte" — one per team, an ordinary thing to have — merged under one
heading and a reader saw somebody else's pages listed under their own. And
`List-Unsubscribe`, which ADR-0058 says is included, was not: the comment
describing it survived in `send.ts` above a line that had become
`Auto-Submitted`, and the whole repository held the string once, in the record.

Finally, one that is a divergence rather than a bug, until you look at it from
the other side. **The digest asked a different visibility question from the rest
of SONE.** `visiblePagesCondition` documents its third argument as "whether they
hold owner or admin **in the workspace**", and every other caller passes exactly
that. The digest passed `users.is_instance_admin` — wrong in both directions: an
instance administrator saw restricted page titles from every workspace they
belong to, and a workspace **owner** silently lost rows from their own digest,
because an owner is not an instance admin. ADR-0062 states the rule this
violates: "not a second answer to who may see what". The existing test baked the
bug in, reading as the fixture's owner and asserting they could not see a
restricted page.

## Decision

**Asleep is absent here too.** One clause in `claimForEmail`, and not
`snoozed_until IS NULL`: when the moment passes the row wakes, and a mail is
then exactly right.

**The reply address names an item that can take a reply** — the earliest one
with a thread. A batch with nothing answerable still carries none, because
inviting a reply to something with no conversation is inviting somebody to
write into a void.

**Sent, then marked.** A digest that fails repeats its window rather than
dropping it: one somebody gets twice is a nuisance, one they never get is a
hole. A quiet week still advances the watermark, which was right and stays. Each
reader is wrapped, so one unreachable address costs one person their digest
rather than everybody after them in the list.

**Claim and queue in one transaction.** Either a notification is marked and
queued, or it is neither and the next sweep finds it.

**The queue retries, five times, with widening gaps** (migration 0057 adds
`run_after`). 0035_jobs said adding retries would need no migration; it was
nearly right — retrying does not, retrying *after a delay* does, and retrying
without one hammers a relay that is already unhappy.

**Both timers say what happened**, including the counts they were already
computing.

**The digest asks the workspace question**, per row, through the membership it
already joins. Two paths to one rule get one rule (ADR-0078's decision, applied
again).

**`List-Unsubscribe` is sent**, as a URL and without `List-Unsubscribe-Post`:
the one-click form lets anybody who can send a request unsubscribe somebody
else, and the page it points at is behind a sign-in for that reason.

**The handler and the sweep have tests** — `emailHandler.db.test.ts`, against a
real database and a server that speaks SMTP, reading the headers off the wire.

## Consequences

Two tests changed rather than were added, and both were wrong in the same
instructive way. The digest's restricted-page test read as the workspace
*owner*, so it passed only because of the bug it was standing next to; it reads
as a plain member now, which is what "somebody else's digest" meant all along.
And `mentions at once and replies tomorrow` asserted `claimed.length === 1`
where `claimForEmail` groups by (user, workspace) — both notifications belonged
to one person in one workspace, so the assertion could not fail whatever the
query did. A test that cannot fail is worse than no test: it occupies the space
where a real one would go.

The retry change alters what an operator sees. A job that fails now sits at
`queued` with its error recorded, up to five times, before it reads `failed`. An
administration screen showing "failed" counts will show fewer, later.

`emailed_at` still means "claimed", not "delivered", and that is still the right
way round — but the sentence in `emailNotifications.ts` explaining it now rests
on something true.

Still unexercised in this area, named rather than fixed: `writeNotifications`
has no database test, so the membership join and `visiblePagesCondition` that
decide who is eligible for a notification at all are checked only by the SQL
column guard; `changedFor`'s editor count reads `page_versions` snapshots that
are only taken after a quiet period, so for recent activity the count is quietly
zero and a page whose last editor is the reader but which a colleague also
edited is omitted until a snapshot exists; and ADR-0062 still describes one mail
per workspace where the code sends one with a heading per workspace, and ADR-0061
still describes an hourly sender for the notification digest where the daily
branch rides the sixty-second sweep. Those two are records to amend, not code to
change — the code is right and the reasoning for it is in a comment rather than
in the record.
