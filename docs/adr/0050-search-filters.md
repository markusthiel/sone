# ADR-0050: Narrowing a search

## Status

Accepted.

## Context

The body search is a ranked `tsvector` query with snippets and the workspace's
own dictionary (ADR-0033), and it is better than I remembered when I audited it.
What is missing is narrower: there is no way to say *which* results are wanted.
The search screen separates folders from pages and nothing else.

Three filters are worth having, and they are the three every review of a notes
tool asks about: by tag, by who wrote it, and by when.

## Decisions

### Filters are typed into the query, not clicked beside it

`tag:budget`, `author:markus`, `after:2026-08-01`, `before:2026-09-01` — parsed
out of the search box, the rest of the words remaining the search itself.

Two reasons, and the second is the important one.

A search box is already where somebody's hands are. A row of dropdowns beside it
means leaving the keyboard to narrow a search that was typed, and the cost is
paid every time.

And a typed filter is **shareable and repeatable**. `tag:rechnung after:2026-01-01`
can be pasted into a message, kept in a page, or typed again next month. A set of
dropdown states cannot be any of those without a query language underneath —
which is this, arrived at from the other direction and with a screen on top.

The interface shows what it parsed as chips above the results, so nothing is
hidden: somebody who typed `autor:` and got no filter can see that.

### The prefixes are English, and that is a decision rather than an oversight

`tag:`, `author:`, `before:`, `after:` — not `schlagwort:` or `autor:`.

A translated prefix means a query that works for one reader and not another,
which breaks the sharing the syntax exists for. It also means the parser's
behaviour depends on the interface language, so the same string typed by two
people in one workspace does different things.

The German prefixes are accepted as *aliases* rather than replacing anything,
because somebody typing `autor:` has been clear about what they mean and
refusing them would be pedantry. The chips show the canonical form, which is how
somebody learns it.

### What each one matches

**`tag:`** — an exact tag, matched case-insensitively against the projected tag
list. Not a prefix search: tags are chosen from a set, and `tag:re` matching both
"Rechnung" and "Recht" would make a filter that narrows nothing.

**`author:`** — anybody whose writing is *in the page*, from the attribution
already projected (ADR-0022). Matched against display name, case-insensitively
and by prefix, because nobody types a whole name to narrow a list. A guest is
matched by the name they gave.

The honest limit: this finds pages an author *contributed to*, not pages they
created. Attribution is per character and the projection records who has writing
in a page, which is the more useful question anyway — "what has Markus been in"
rather than "what did Markus start".

**`assigned:`** — pages holding a task given to somebody, by id, with `me`
resolved from the session (ADR-0052). An id rather than a name prefix, unlike
`author:`: the names come from a picker in the interface, so there is nothing to
guess at — and a name that is not an id matches nothing, which is the honest
answer to a filter nobody can resolve rather than quietly matching everybody.

Added after assignments were built, because assigning is useless if nobody can
list what they were given. The assignment was already projected into
`blocks.props`, so the question needed a filter and a partial index rather than a
screen of its own.

**`before:` and `after:`** — the page's last edit, by date. Not creation: the
question behind a date filter is almost always "what has changed since", and a
creation date is answered better by the tree's order.

Dates are `YYYY-MM-DD`, inclusive at both ends — "before the first" meaning "up
to the thirty-first" is a boundary nobody would guess.

**Corrected while building it.** This record said the dates would be interpreted
in the workspace's own time zone. There is no such setting anywhere in SONE: not
on a workspace, not in the configuration. So they are interpreted in the
server's zone, which is what a cast to date does, and the limit is written down
rather than left as a claim: a container running in UTC and a reader in Berlin
disagree about "today" for two hours. A per-workspace zone is a real feature —
it would also want to reach the version list, the history panel and every
timestamp in the interface — and inventing half of it inside a search filter
would be the wrong place to start.

### A filter with no query is a valid search

`tag:rechnung` alone lists everything tagged Rechnung, newest first. That is
where the two-character minimum stops applying: the minimum exists because one
character matches most of a workspace, and a filter is not a guess.

This is also the cheapest useful thing here — "show me everything tagged X" is a
question people ask constantly and currently have no way to ask at all.

### An unparseable filter narrows nothing and says so

`after:letzte-woche` is not a date. The chip appears struck through with the
reason, and the search runs without it.

Not an error, and not silently ignored either. A search that returns results
while quietly dropping half of what was asked is worse than one that says which
half it could not use.

## Consequences

`page_search` already carries the tags; the authors need projecting, which is one
more column written by the materialiser from what `readDocument` already reads.

The two-character minimum becomes conditional, which is a small hole in a rule
that was there for a good reason. Guarded: a query shorter than two characters
with no filters still returns nothing.

## What is deliberately not decided

**Typo tolerance in the body.** The other half of the review's item, and its own
job: trigrams over every block's text is an index the size of the content, and
the alternative — `word_similarity` against a per-workspace lexeme list — needs
measuring before it is chosen.

**Saved searches.** The obvious next thing once a query is a string worth
keeping, and a feature with its own storage and its own place in the interface.

**`in:` for a folder.** Wanted, and it needs a way to name a folder in a query
that survives renaming — which is an id in a string, and a string with an id in
it is not shareable in the way the rest of this syntax is.
