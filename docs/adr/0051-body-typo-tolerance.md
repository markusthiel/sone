# ADR-0051: Typo tolerance in the body

## Status

Accepted. Decided from a measurement rather than from a preference.

## Context

A misspelt title still finds its page: names are covered by trigrams
(ADR-0036). A misspelt word in the body finds nothing. That asymmetry is the
last open half of the September review's search item, and ADR-0050 deferred it
with the note that the alternatives "need measuring before one is chosen".

So they were measured.

## The measurement

A corpus of 4000 blocks, 160 000 words, 19 993 distinct forms — roughly the
shape of a workspace of a few thousand pages in German, where compounds keep the
vocabulary large. Both candidates built on the same data, in Postgres 16.

| | index | query for one misspelling |
| --- | --- | --- |
| Trigrams over every block's text | 4544 kB | 14.4 ms |
| A word list per workspace, trigrams on that | 3824 kB (incl. the table) | 0.5 ms |
| *the content itself, for scale* | *6752 kB* | |

**Getting to a corpus worth measuring took four attempts, and each failure would
have produced a confident number.** A vocabulary of twenty words made the word
list look 20× smaller than it is. `random()` inside a correlated subquery was
folded, so every block came out as one word repeated forty times and the distinct
count was 1. Varying a word's length with its *position* made almost every token
unique — 159 683 distinct in 160 000 words, which is not a language. The numbers
above come from a generator with no randomness at all, so they can be
reproduced.

## Decision

**A word list per workspace, with trigrams on it.**

The size difference is smaller than expected — 3.8 MB against 4.5 MB, not the
order of magnitude the twenty-word corpus suggested. The decision does not rest
on it.

It rests on two things the measurement makes plain:

**Speed.** 0.5 ms against 14.4 ms, on a corpus this small. The content index
scales with the content; the word list scales with the *vocabulary*, which grows
far more slowly — a workspace ten times the size has ten times the text and
perhaps twice the distinct words.

**It yields the correction, not the match.** Searching the word list for
`beratenummer` returns `beraternummer` with a similarity of 0.69. That is what
the interface needs: it can then run the *ordinary* ranked search for the
correct word, with the same weighting, the same snippets and the same dictionary
as any other search — and it can say "did you mean". Content trigrams return
blocks ranked by string similarity, which is a second, worse ranking sitting
beside the good one.

That second reason is the real one. The cheap approach is not merely cheaper; it
composes with the search that already exists instead of competing with it.

### How the list is kept

Written by the materialiser, alongside the search row: the words of a page, in
the workspace's own scope. A page's words are removed when it is reprojected and
re-added, which means a word that no longer appears anywhere lingers until
something else touches it — accepted, because a suggestion for a word that used
to be in the workspace is a suggestion nobody is harmed by, and a reference
count per word would be a second thing to keep correct.

Titles keep their own trigram index (ADR-0036). Two mechanisms for one job is
usually the thing to avoid, but a title is short, weighted, and matched whole,
while a body word is matched against a vocabulary — and the existing one is
correct and cheap.

### What it looks like

The suggestion is offered under the same "did you mean" heading names already
use, and only when the search itself found little. A search that found what
somebody wanted must not be interrupted with a guess about what else they might
have meant.

## Consequences

One table, one index, and one more write per projection. The word list is
workspace-scoped, so it is deleted with the workspace by the same cascade as
everything else.

A word list is a list of the words in a workspace, which is a weaker thing to
leak than the text — but it is still content. It is read only through the search
route, which already applies the workspace's own visibility rules; the list
itself carries no page ids, so it cannot say *where* a word is. That is
deliberate: a suggestion has no business knowing which page it came from, and the
ordinary search will answer that with the permissions applied.

## Alternatives considered

**Trigrams over the block text**, measured above. Rejected on speed and on the
ranking it forces, not on size.

**A dictionary per language rather than per workspace.** Cheaper still, and it
cannot suggest "Beraternummer" — the words people actually misspell here are the
ones that are not in any dictionary.

**Levenshtein without an index.** A sequential scan over the vocabulary. Fine at
20 000 words, and it is a decision that stops being fine without warning.
