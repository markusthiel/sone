# ADR-0036: A misspelled search finds names, in a group of its own

## Status

Accepted.

## Context

ADR-0033 made search match prefixes and deferred typo tolerance, for a stated
reason: it needs `pg_trgm`, a second index and a decision about how "similar"
ranks against "contains" — and introducing two ranking systems at once means being
unable to tell which one is wrong when the results are.

Prefix matching has been in use since. What it does not cover is the ordinary
mistake: "Testordnr" finds nothing at all, and the person retypes it rather than
learning that the search cannot spell.

## Decisions

### Trigram similarity, on titles only

`pg_trgm` with a GIN index on `pages.title`.

Titles only, and not block text. A typo happens while looking for a *thing*, and
a thing is found by its name; the body of a page is where somebody searches for a
phrase they remember, and they remember it correctly or they do not remember it.
Indexing every block's text for trigrams would also be the largest index in the
schema by a wide margin, for the rarer half of the case.

`word_similarity(query, title)` rather than `similarity`, because a title is often
longer than the query: `similarity('testordnr', 'Testordner Projekte 2026')` is low
because most of the title is not the query, while `word_similarity` measures how
well the query matches the best part of it. The threshold is 0.4, which admits one
or two wrong letters in a word and refuses a different word.

### A separate group, not a merged list

Similar names come back as their own list and are drawn under their own heading.
They are never mixed into the ranked results.

This is the whole reason the change is safe to make now. Two ranking systems in
one ordered list cannot be reasoned about: a result is either above another
because it matched better or because a different measure said so, and nobody can
tell which from looking. Kept apart, each list means one thing, and a bad
suggestion is visibly a suggestion.

### Only when the search did not do well

The second query runs only when the ranked results number fewer than five, and it
excludes anything already found.

Somebody whose search worked does not need five guesses underneath it, and a
"similar names" section that is always present is a section people learn to skip —
which is exactly when they will not read it on the day it holds the answer.

Five is also the cap on the suggestions themselves. A misspelling that produces
twenty similar names has not produced an answer.

### It stays a suggestion in the interface

No snippet and no "why", because there is nothing honest to say beyond the name
being close. The heading says what the list is; each row shows the kind, the name
and where it lives, exactly as a result does.

## Consequences

One migration: the extension and one index. `pg_trgm` ships with Postgres and is
already the kind of thing this schema uses — `pgcrypto` has been required since
the first migration — so this adds no operator step beyond applying migrations.

The second query only runs on a search that found almost nothing, which is the
cheap case: there is nothing to rank and the index is on a short column.

A typo in the *body* text still finds nothing. That is a deliberate remaining
limit, written here so the next person knows it was a choice.

## Alternatives considered

**Correcting the query and re-running it**, as a search engine does with "did you
mean". Rejected: it needs a dictionary of the workspace's own words to correct
against, which is a second index over everything, and a correction shown as a
result is a claim about what somebody meant. A list of close names makes no claim.

**Merging similar names into the ranked list**, weighted below exact matches.
Rejected above: one list ordered by two measures cannot be debugged.

**Trigrams on block text as well.** Rejected for now on cost and on value: the
largest index in the schema for the rarer half of the case. Worth revisiting if
anybody actually asks for it, and the shape it would take is a third group rather
than a change to either of these two.

**Levenshtein distance** (`fuzzystrmatch`) instead of trigrams. Rejected: it needs
a candidate set to compare against, so it cannot be indexed the way a trigram
similarity can, and on a workspace of a few thousand titles that is a scan per
keystroke.
