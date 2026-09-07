# ADR-0139: What the interface claims about mail

## Status

Accepted. Built. Corrects a consequence of ADR-0138, and fixes two screens that
were making claims nothing had checked.

## Context

ADR-0138 ended by declining to say anything on the export screen:

> **The interface promises nothing.** […] the client has no way to know whether
> this instance has a relay — it finds out by being refused — so the promise
> would be a lie on an instance with none.

**That reason was wrong.** `canSendMail` has been on the instance payload since
ADR-0059, typed in `packages/client`, read in `App`, and used by the sign-in
screen and the share dialog. Its own comment on the server even records the
moment it stopped being about one thing:

> It was `canResetPassword`, which named one consequence of the fact rather than
> the fact. **A second reader arrived** — the share dialog, which offers to mail
> a link only where there is a relay — and two fields carrying one boolean is
> the duplication this codebase keeps removing.

The conclusion came from a search that returned nothing because it was run in
the wrong directory. **An empty result is not evidence of absence unless you
know where it looked** — which is a different mistake from the one this codebase
keeps recording, and worth separating from it: `recipientLocale` (ADR-0133) was
nobody looking; this was looking and misreading the answer.

And the flag being unused in one place was not the worst of it.

### The empty inbox was denying what the share dialog was offering

> **SONE does not send email.** This is where notifications are.

Rendered unconditionally, in the empty inbox, since ADR-0052. True when it was
written. **False since ADR-0058**, which is notification mail, and increasingly
false through the sixteen letters this instance now sends. So on any instance
with a relay, one screen said mail is never sent and another, three clicks away,
offered to send some.

Neither screen was wrong about its own feature. **Nothing was asking the
instance.**

## Decisions

### One context, named for the instance rather than for a field

The argument was already written, in `App`, above the logo:

> Here rather than threaded as a prop: the mark appears in the rail, in the mode
> bar on a phone, on the sign-in screen and beside a workspace in the switcher,
> and **four routes to it are four chances to show two different logos on one
> screen.**

`canSendMail` has the same four readers and the same failure — with the
difference that for the logo it was a risk and here it had already happened.

So `BrandLogoContext` became `InstanceContext`: what this interface needs to know
about this server, provided once. The share dialog stopped taking it as a prop.
A fifth fact goes in the same place, and a fifth reader needs no plumbing.

### Not knowing is never a promise

The field is optional: an older server does not send it, and neither does one
whose instance request has not landed. The context's default is `false` and
`App` compares `=== true`.

**The failure directions are not symmetrical.** A screen that stays quiet about
mail on an instance that sends it is a missing sentence. A screen that promises
mail on an instance with no relay is a lie somebody waits on. So the value that
means "I do not know" resolves to the quiet one.

### The inbox says what is true, and names the setting rather than the answer

With a relay: *"Notifications live here. Whether you are also emailed is up to
you, under You → Notifications."*

It points at the setting rather than reading somebody's own preference back at
them. Two reasons: the screen does not have it, and it would be the wrong place
to put it — the sentence exists to say *where notifications live*, which is
ADR-0052's point and is true either way.

Without a relay the old sentence stands, unchanged, because it is still exactly
right.

### And the export screen says the tab can be closed

Which is the useful half — the archive takes minutes and this screen only polls
while somebody is looking at it.

## Consequences

**Three tests**, and two of them are general. That the instance is *asked* and
not threaded — no component may take `canSendMail` as a prop, which is the shape
that lets two of them disagree. That not knowing is never a promise. And that
any component rendering one of the sentences about mail has the flag in the same
file, which is the check that would have caught the inbox.

**One test got better by being wrong.** `scale.test.ts` asserted
`t('inbox.noEmail')` under the heading *"it says there is no email, rather than
letting somebody assume one"* — a true assertion about a sentence that had
stopped being true. It asserts the condition now, both keys and the choice
between them: **asserting only the sentence for an instance with no relay is how
the wrong one survived being right once.**

**ADR-0138 is corrected in place**, with the reasoning it got wrong quoted and
the correction beside it. The decision it reached — say nothing — was right for
that round and is superseded here; the reason it gave was not right at all, and
a record whose reasoning is wrong is worse than one that is silent, because the
next person believes it.

## Alternatives considered

**Thread `canSendMail` down to the two screens.** Two more props through two
more components, and the fifth reader threads it again. It is the arrangement
that produced the disagreement.

**Leave the inbox sentence and add a caveat.** *"SONE does not send email —
unless it does"* is a sentence nobody can act on.

**Tell the inbox whether *this person* is emailed.** More precise and worse: the
screen would need the notification settings it does not have, and the sentence
is about where notifications live rather than about one person's preferences.

**Say nothing on the export screen and leave ADR-0138 alone.** The record would
keep a wrong reason in it, and the next person to ask "can the client know
whether mail works" would find "no" written down by somebody who had checked.
