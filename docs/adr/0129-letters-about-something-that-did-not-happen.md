# ADR-0129: Letters about something that did not happen

## Status

Accepted. Built. Asked for. Three of the six mails proposed beside ADR-0121;
adds one table and one task to the maintenance job (ADR-0005).

## Context

From the concept's list of mails still missing:

> 3. **Eine Einladung wurde nie eingelöst.** Nach ein paar Tagen an den
>    Einladenden, nicht an den Eingeladenen.
> 4. **Ein Gast-Link läuft bald ab.** An den, der ihn erstellt hat.
> 5. **Der Mailversand ist ausgefallen.** […] Heute landet ein gescheiterter
>    Versand im Log — niemand erfährt, dass niemand mehr etwas erfährt.

Every mail this project has sent so far hangs on a moment: somebody was
mentioned, somebody was let in, somebody sent a link. **These three have no
moment.** Each is true for days at a stretch, and the thing that notices is a
loop that comes round every five minutes.

## Decisions

### A reminder remembers that it was sent

One table, `reminders (kind, subject_id)`. Without it, "an invitation nobody
redeemed after three days" is a letter every five minutes for as long as nobody
redeems it.

One table rather than a column per kind: `invitations.reminded_at` and
`share_tokens.expiry_warned_at` would each be a column on a table that is about
something else, and the third has no row of its own to hang a column on at all.
A reminder is its own fact — *this was said, about that, once* — and the fourth
will not need a migration.

### Claimed before the send, not after

The insert happens first and the letter goes out only if it inserted. A send
that then fails is not retried, and that is the right way round: **at most once
beats possibly for ever**, and what is missed is a reminder rather than the
event it is about. The other order turns one relay timeout into a mail every
five minutes until it stops timing out.

### Except with no relay, where nothing is claimed either

An instance without mail would otherwise mark every reminder as sent while
sending none, and configuring a relay a week later would deliver silence.

And **"has a relay" is a different question from "has a sender"**: the wiring in
`main.ts` always has a sender, and that sender quietly returns without doing
anything when no relay is configured. Asking only whether the function exists
would claim everything. There is a test for the production shape specifically,
because the obvious test — no function at all — passes either way.

### The invitation reminder goes to the inviter

Not to the invited. Somebody who never signed up did not ask to hear from this
instance twice, and the person who can do something about it — send it again, or
ask in the corridor — is the one who sent it.

### The link reminder is worth having only because of ADR-0126

Links expire by default now. Before that, a warning about an expiry was a
warning about a setting almost nobody had chosen; now the failure it prevents —
a client who cannot open the page they were sent last month — is one that can
actually happen.

### A broken relay cannot report itself

The proposal was "der Mailversand ist ausgefallen". It cannot be a warning: the
mail saying the relay is broken needs the relay.

So it is **a report of a window that has closed, sent by the relay that has
started working again** — which is the only moment at which it can be sent at
all. It says how many did not arrive and since when, and notes that this message
arriving means the relay is answering now.

What covers the *current* outage stays where it already was: the count on the
administration screen, which needs no relay to be true. This adds the half that
screen cannot — the operator is told without having to be looking.

It goes to instance administrators and nobody else. A relay is an instance-wide
thing, and a workspace owner can do nothing about an SMTP password.

### A mistake the run found

The outage report is keyed on the newest failure it covered, so that a later
outage is a different subject. The first version wrote that as `max(id::text)` —
and a uuid is random, so the largest is not the latest. Whether a second outage
was reported at all depended on which ids the run happened to generate; the test
for exactly that case passed twice and failed on the third run. It is the newest
by `finished_at` now.

## Consequences

**Fourteen tests, and most of them assert silence** — the second pass, an
invitation that was used, a link that never expires, a link that expired
yesterday, an instance with no relay. That is the shape of the risk here: not a
missing letter but a letter every five minutes.

**Three days and seven days**, both named constants. Neither is a setting, and
neither should be until somebody says the numbers are wrong: an instance
settings screen with a "chase invitations after N days" field is a question
nobody asked to be asked.

**`reminders.sent_at` joins the columns nothing reads**, beside
`requirement_mails.sent_at` and for the same reason: the code needs only whether
a reminder was claimed, and the timestamp is for an operator asking when this
instance last chased somebody.

**Two of the six proposed mails remain**: a sign-in from a new device, and a
welcome mail.

## Alternatives considered

**A column per kind.** Two columns on tables about other things, and no place at
all for the third.

**Send, then record.** Reads more naturally and is wrong in the direction that
costs: a relay hiccup becomes a mail loop, and nobody who has ever received one
believes the software was trying to help.

**Warn about the outage while it is happening.** Impossible by construction, and
worth writing down because it is the obvious thing to attempt.

**Also chase the invited person.** They have already been written to once, they
have no account here, and a second unsolicited mail from an instance somebody
else runs is spam with a reason attached.

**Make the intervals settings.** Two more instance settings, two more things to
explain on a screen, in exchange for a number that is right for almost everybody
at three days.
