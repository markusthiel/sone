# ADR-0138: A job that finished while nobody was looking

## Status

Accepted. Built. Closes the last item from the mail concept — *„Export per Mail.
Als Link, nicht als Anhang. Hängt am Job-Abschluss: der Runner bräuchte den
Versand und die Frage «wem»."*

## Context

A workspace export is a job because it cannot be a response (ADR-0044): every
page, every attachment, minutes of work, and an archive in the file store at the
end of it.

The settings screen polls while somebody is watching it. The moment they close
the tab, nothing tells them anything — and the archive expires
(`SONE_JOB_RESULT_HOURS`, a day by default, and the record for that number says
why it should not be for ever). So the ordinary shape of using this feature is:
ask for an export, go to lunch, come back tomorrow, find it gone. **An export
somebody has to ask for twice**, and the second time they will wait by the
screen.

Two questions had to be answered, and the concept named them: the runner needs a
way to send, and it needs to know who to tell.

## Decisions

### Who to tell, without a list of kinds

**A job worth telling somebody about is one somebody asked for**, and the row
already records which those are.

`jobs.created_by` is the person who pressed the button. The sweep that turns
aged notifications into work passes `null` for it — deliberately, in so many
words, in the line that writes it. So the two kinds this build has are already
separated by the data, and a third kind will separate itself.

That is the whole rule. No table of "kinds that send mail" to keep in step with
the handlers, and therefore no second list to drift from the first — the failure
ADR-0131 was written about and ADR-0133 met again.

### A link, and deliberately no token in it

ADR-0126 built a share mail that carries a token and argued carefully for it.
**This is the same question with the opposite answer**, and the archive is why.

An export is *every page of a workspace*. A bearer link to it sitting in a
mailbox — forwarded, retained by whoever administers that server, readable on an
unlocked phone — is the largest possible version of the thing ADR-0058 exists to
prevent. And nothing has to be invented to avoid it: the download route already
refuses everybody but the asker, by user id, on their own session (ADR-0044).

So the letter **says it is ready** rather than handing it over. The link opens
the screen the export was asked from, and the archive comes to somebody signed
in as themselves. The mail is a notification, not a delivery.

Not attached, for the same reason and a second one: a workspace archive is
megabytes, and relays refuse them.

### What it says, and what it does not

A count of pages and a size. Both are facts about the *archive* rather than
about what is in it, which is the line ADR-0058 draws — the digest already
reports "one page changed" under the cautious setting.

And **when it expires**, which is the reason the letter is worth sending at all.
ADR-0129 made this argument about a share link: *a link that stops working
without warning produces a question to somebody who cannot see the problem.* The
same sentence, about a file.

**A failure names no reason.** The error is a sentence this instance wrote about
its own machinery, and several of them name a page. The screen has it, and the
screen is where somebody would act on it — so the letter says it did not finish
and points there. That is the same rule applied to an error message, and it
means there is no per-error judgement to make later.

### Told once, and at the end

The runner widens the gap and tries five times (ADR-0081). A job that will be
tried again has not finished, so only the branch that gives up tells anybody:
*"your export failed"* four times before it succeeds is worse than silence.

**And nothing about telling somebody may fail a job.** The hook is called after
the state is written, and what it throws is swallowed — the export succeeded
whether or not a mailbox took a message about it, which is ADR-0121's rule for a
grant applied to a file.

### The runner still does not know that mail exists

The hook is handed in, exactly as `deleteResult` is: *"this module must not know
that a result happens to be a key in a file store"*. It must not know that
anybody is ever told anything about a job either.

It hands over a `FinishedJob` — the row plus the result and the expiry it has
just written — because neither is on the row it claimed, and reading them back
would be asking the database for something it was just told.

### `readableSize` moved to `core`

Four lines, and the reason is stronger than tidiness: **the screen and the
letter describe the same archive.** Two implementations is two chances for a
letter to say "48.2 MB" about a file the settings screen calls "49 MB", and
somebody reading both would be right to wonder which file each meant.

## Consequences

**Nine database tests**, and the useful half is who is *not* told: a job nobody
asked for, an account with no address, a deactivated one, an instance with no
relay. A letter about a finished job is one more thing that can be more generous
than the route it points at.

**The interface promises nothing** — corrected, see below. No sentence was added
to the export screen saying a mail will arrive, and this record gave the reason
as: *the client has no way to know whether this instance has a relay — it finds
out by being refused — so the promise would be a lie on an instance with none.
Making it truthful means a flag in the session, which is a different change from
this one.*

> ## Correction (ADR-0139)
>
> **That reason was wrong.** `canSendMail` has been on the instance payload
> since ADR-0059, typed in the client, read in `App`, and used by two screens —
> and its own comment records a second reader arriving. The conclusion came from
> a search that returned nothing because it was run in the wrong directory, and
> an empty result is not evidence of absence unless you know where it looked.
>
> The decision it produced was still the right one for the wrong reason: the
> screen should say so, and it does now. ADR-0139 has the sentence, and the two
> other things that had gone wrong beside the same flag.

**Every job kind added from here gets this for free**, and gets it right by
default: if somebody asked for it, they hear; if the machinery queued it for
itself, nobody does.

## Alternatives considered

**Attach the archive.** It is what somebody would ask for, and it is a copy of
their whole workspace in an inbox, at a size relays reject.

**A signed download link with a token, as the share mail has.** The mechanism
exists and is tested. It is refused here because of *what* it would open: the
share link opens one page somebody deliberately shared, and this would open
everything they can read.

**Keep the archive longer instead.** It addresses the symptom by leaving a copy
of a workspace in the file store for a week, which is the thing
`JOB_RESULT_HOURS`' own record argues against — the longer it sits, the more
likely it outlives the permissions that produced it.

**A list of kinds that send mail.** One line shorter today and a second list to
keep in step for ever. `created_by` already knows.

**Tell somebody on every attempt.** Honest about what the queue is doing and
useless to read: four letters about one export, three of which are wrong by the
time they arrive.
