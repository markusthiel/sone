# ADR-0062: A mail about what changed

## Status

Accepted and built.

## Context

ADR-0061 built a digest of *notifications* — things addressed to you, arriving
once a day instead of as they happen — and argued the other digest was a
different feature: "here is what changed in your workspaces", addressed to
nobody in particular.

It was wanted anyway, which is a fair answer: my objection was that it needs
somebody to decide what "interesting" means, and that is design work rather than
a reason to refuse. This record does the deciding.

## Decisions

### Opt-in, where notifications are opt-out

A notification is about something aimed at you, so a mail about it is expected
and the ticks exist to turn it *off*. Activity is aimed at nobody, and a mail
listing what colleagues did that somebody never asked for is the definition of
what people mean when they call something spam.

So: off unless chosen, and nobody's mail changes when this ships.

### It lists pages, not changes

A page that was edited eleven times by three people is **one line**. The
alternative is a mail whose length is a function of how busy somebody else was,
which is exactly the mail people filter into a folder they never open.

Each line: the page, who touched it last, and how many people touched it. Enough
to decide whether to open it, and nothing that pretends to be a summary of what
was written.

### It says no more than a notification does

Titles and names and links, never content — the same rule as ADR-0058, and it
applies with more force here because a digest covers pages nobody chose to tell
you about. `emailDetail` is honoured: an instance set to `workspace` gets
workspace names and counts, not page titles.

**And a restricted page is invisible in it.** The digest uses
`visiblePagesCondition`, the same clause the tree and search use, per recipient —
not a second answer to who may see what. That is the failure this feature could
have that would matter, and it is prevented by not writing a new rule.

### Daily or weekly, and never more often

An activity mail is not urgent by construction: if something needed somebody
now, it was a mention and it has its own mail. Hourly activity mail is a
notification pipeline with the interesting parts removed.

Weekly arrives Monday morning; daily on weekdays only. A Sunday-morning mail
about what happened on Saturday is a mail about work, arriving on somebody's
weekend, that nobody will act on before Monday anyway.

### Nothing to say means nothing sent

Two people on holiday and a quiet week produce no mail at all rather than "no
activity". A mail whose content is its own emptiness is an interruption that
taught the reader to ignore the next one.

### It is per workspace, like the notification mail

One mail per workspace, for the same reason: workspaces are how people separate
one context from another, and a single mail mixing three of them makes somebody
sort them by hand.

## Consequences

Two columns on `users`, one query joining pages to their editors under the
visibility clause, one composer, and a sender on the same hourly timer the
notification digest uses.

The query is the only interesting part, and it is interesting because of what it
must not do: leak a restricted page's title into a mail.

## What was found building it

`page_versions` keys on `doc_id`, stores its people in an `authors text[]` and
timestamps with `taken_at`. I wrote `page_id`, `author_id` and `created_at` —
three invented column names in one subquery, none of which the compiler could
see, because SQL in a template literal is a string.

The SQL column guard named all three before the query ever ran. That guard was
written two days earlier for exactly this, and this is the first time it has
caught something in new code rather than in a review of old code.

## What is deliberately not decided

**Which pages somebody cares about.** Now [ADR-0064](0064-watching.md), which
adds watching as its own act — deliberately not a side effect of favouriting,
because a favourite is "I come here often" and watching is "tell me when this
changes". The digest gains a scope, and *everything I can see* stays the default
for anybody who already has it on: a release that silently narrows what somebody
receives is as bad as one that widens it.

**Comments and collection rows as activity.** A comment already reaches the
people it names. What a digest would add is "people are talking on a page you
have not opened", which is a different and more social claim than "this page
changed", and it is not obviously wanted.

**A per-person hour.** Eight in the reader's own timezone, as ADR-0061 decided,
for the reason given there.
