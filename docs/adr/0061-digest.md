# ADR-0061: One mail a day instead of one per batch

## Status

Accepted and built.

## Context

ADR-0058 deferred "digest emails on a schedule — a daily summary of everything"
as needing somebody to want it first. Somebody does.

But two different features answer to that name, and choosing between them is most
of this record.

**An activity digest** — "here is what changed in your workspaces yesterday" —
means deciding what counts as interesting, filtering every page edit by who may
see it, and summarising a day of a CRDT. It is a feature about *the workspace*.

**A notification digest** — "here is everything that was waiting for you
yesterday" — is the existing pipeline with a different delay. It is a feature
about *the person's inbox*, which is what the notification mail is already about.

## Decisions

### The digest is the notification pipeline on a longer timer

One mail a day carrying what would otherwise have been several, and nothing
else. No page edits, no "activity in your workspaces", no summary of a document.

The reason is not laziness about the harder feature. It is that the two answer
different complaints, and only one of them has been made: "I do not want a mail
every five minutes" is a complaint about frequency, and this fixes it exactly. "I
do not know what my colleagues did yesterday" is a complaint about awareness, and
a mail is a poor answer to it — the page, its history and its inbox are all
better, and all already exist.

An activity digest stays deliberately undecided below.

### It is a choice per person, not per instance

`as it happens`, `once a day`, or `never` — beside the three per-kind ticks that
already exist, and answering a different question from them. The kinds say *what*
is worth a mail; the schedule says *how often*. Somebody who wants mentions
immediately and replies daily is asking for something this deliberately does not
offer: two schedules is a matrix, and a matrix in a settings screen is a thing
people abandon halfway.

### It is sent in the person's own morning

The account already carries a timezone, used for dates in the interface. A digest
at 07:00 UTC is the middle of the night for somebody and the middle of the
afternoon for somebody else, and a mail that arrives at the wrong hour is a mail
that gets filed unread.

So: 08:00 in the reader's own timezone, and no setting for the hour. A time
picker for a daily mail is a decision nobody wants to make and everybody has to
scroll past.

### Nothing that was read is in it

The same rule as the immediate mail, and it matters more here: a day is long
enough that most of what a digest could say has usually been dealt with. A digest
listing four things somebody read yesterday afternoon is a mail teaching them to
ignore the next one.

If everything was read, no mail is sent. An empty digest is an interruption
carrying no information.

### It says the same as the immediate mail, and no more

Who, where, a link. Never the comment text (ADR-0058), and the same for twenty
items as for one — a digest is not a place where the rules relax because the mail
is longer.

## Consequences

One column on `users`, one branch in the claim query, and a sender that runs once
an hour to catch each timezone's eight o'clock. The composer already takes a list
and writes one mail from it.

An operator gains nothing to configure: this is a per-person choice on a feature
they have already enabled or not.

## What is deliberately not decided

**An activity digest.** Above. It is a real feature and this is not a step
towards it — building it would mean deciding what "interesting" means, which is
the whole problem and is not made easier by having a daily mail already.

**A weekly option.** Two schedules are a choice; three are a menu. If somebody
wants weekly they can say so and it is one enum value, but nobody has.

**Per-workspace schedules.** The mail is already one per workspace; the schedule
is about the person. Making it per workspace means a settings screen inside every
workspace for a preference most people set once.
