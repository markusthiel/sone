# ADR-0064: Watching a page

## Status

Accepted. The table, the routes and the digest's scope are built; the control on
the page itself is not.

## Context

[ADR-0062](0062-activity-digest.md) sends a mail listing what changed in
somebody's workspaces, and deferred the obvious refinement: "which pages
somebody cares about. No watching, no per-page subscriptions… Watching is a real
feature and would deserve a record; it is not a thing to smuggle in as a digest
heuristic."

The digest as built lists everything visible. In a workspace of thirty pages
that is exactly right; in one of three thousand it is a mail nobody reads, and
the feature quietly stops working as the instance it runs on grows.

## Decisions

### Watching is its own act, not a side effect of favouriting

There is already a `favourites` table keyed by person and page, and reusing it
would cost nothing to build. It is refused anyway.

**A favourite is "I come here often"; watching is "tell me when this changes".**
They are different sentences, and conflating them means somebody who bookmarked
a page for navigation starts getting mail about it — a surprise, and the kind
that teaches people to stop using a feature rather than to configure it.

The screens can sit next to each other. The verbs must not be the same verb.

### Watching a folder watches what is under it

`ancestor_ids`, the same way the `in:` search filter works (ADR-0050). Somebody
who watches "Projekte" means the project pages, not the empty folder itself —
and a folder that only ever changes when it is renamed would otherwise be a
subscription to nothing.

A page watched *and* under a watched folder is watched once. That is a set, not
a count.

### The digest gains a scope, and its current behaviour stays available

Two choices: *everything I can see*, which is what it does today, and *only what
I watch*. The first stays the default for anybody who already has the digest on,
because a release that silently narrows what somebody receives is as bad as one
that widens it.

Nothing about notifications changes. A mention already reaches the person named
whether they watch the page or not, and making that depend on watching would
turn a notification into something you can accidentally opt out of.

### Watching produces no notification of its own

No "a page you watch has changed" in the inbox, and no immediate mail. Watching
feeds the digest and nothing else.

This is the decision most likely to be questioned later, so the reason is worth
writing down: an inbox is for things addressed to somebody, and a page changing
is not addressed to anybody. Putting watched-page changes in the inbox would
make the badge a number that no longer means "somebody needs you", which is the
only thing that makes a badge worth looking at.

### An unwatched page is silence, not a smaller mail

Somebody who watches nothing and chooses the watched-only scope gets no mail.
Not "you watch no pages" — that is a mail whose content is a complaint about its
own recipient.

## Consequences

One table, two routes, a control on the page, and one branch in the digest
query. The digest's visibility clause is unchanged and still per recipient: a
watched page nobody may see is still invisible, and watching cannot be used to
learn a title.

## What was found building it

**An alias shadow.** My watched-pages subquery used `watch` — but only after the
SQL column guard complained: the first version used `w`, which the digest query
already uses for `workspaces`. The guard resolved the outer `w.id` and `w.name`
against `watched_pages` and reported two columns that do not exist.

It was right to complain for a better reason than its own: a reader who has to
track which `w` is which will misread one of them. Renamed rather than
suppressed.

**And the reverse guard caught `users.digest_scope` unused** — I had added the
column and the query branch but not the line that reads the column into the
branch, so the scope would have been ignored while everything appeared to work.

## What is deliberately not decided

**Watching a collection view or a search.** "Tell me when something new matches
this" is a saved search with a schedule, which is a different feature and a
better one for that want.

**Watching somebody else.** "What has Anna been working on" is a reasonable
question and a socially loaded one. It needs a decision about whether the person
being watched knows, and that decision is the feature.

**Muting.** The inverse — everything except these — is a second mechanism
answering the same question, and two of those drift. If watching turns out to be
the wrong way round, it should be replaced rather than joined.
