# ADR-0033: Search matches prefixes, and a result says what it found

## Status

Accepted.

## Context

Two reports about the same screen. Search only finds whole words: a folder called
"Testordner" is found by "testordner" and not by "testordn", and a page is found
only if some complete word in it is typed. And a result is a bare link, so
nothing says whether the match was the title, a tag, or one sentence in the
middle of a long page — or whether the thing found is a page or a folder.

The first is one function. The index is built with `to_tsvector` over the
workspace dictionary and `simple` (ADR-0011), and the query is built with
`websearch_to_tsquery`, which produces exact lexemes. `'testordn'` is not
`'testordner'`, so it does not match, and no amount of typing more slowly helps.
Case does not matter because the dictionary normalises it, which is why that half
appeared to work.

The second is the response. It carries a page id, a title, an icon, a rank and
the ancestor *ids* — which the interface cannot render, so it shows the title and
nothing else.

## Decisions

### The last word is a prefix

The trailing term of a query matches as a prefix; every earlier term stays exact.

`websearch_to_tsquery` keeps parsing what a person types — quotes, `or`, `-` —
and its output is then reparsed with `:*` appended to the last lexeme. Building
on its output rather than on the raw string is the point: the input is
already-validated lexemes, so nothing can be injected and nothing malformed can
reach `to_tsquery`.

Only the last term, because the earlier ones are finished words. Somebody who has
typed `budget rep` means a document about the budget and something starting with
"rep"; making `budget` a prefix too would also return documents about budgeting
tools, which is a worse answer to the same keystrokes.

This is deliberately not fuzzy matching. A typo still finds nothing, and fixing
that needs `pg_trgm`, a second index and a decision about how "similar" ranks
against "contains" — a separate change, worth doing after this one has been used.

### A result says what it is, where it is, and what matched

The response gains four things:

- `kind`, so a folder is drawn as a folder. It is in `pages` already and was
  simply not selected.
- `trail`: the ancestor ids **and their titles**, so the interface can show where
  a result lives. Ids alone are unrenderable, which is why the old field was
  never used.
- `titleMatch`, so "the title matched" can be said rather than inferred from a
  rank number that means nothing to a reader.
- `snippet` and `blockId`: the best matching block's text with the match marked,
  and the id of that block so the result can open the page at the sentence rather
  than at the top.

### The snippet comes from `blocks.plain_text`, not from a new column

`page_search` holds only a tsvector, and `ts_headline` needs the original text.
The obvious fix is to store the body text beside the vector. Rejected: the text
is already in `blocks.plain_text`, written by the materialiser for exactly this
purpose, and a second copy would be a second thing that can go stale.

Reading per block is also better than reading a page's text as one string: the
snippet is a real passage rather than a window into a concatenation, and the
block's id comes with it, which is what lets a result land on the sentence.

### The match is marked with control characters, not with HTML

`ts_headline` wraps matches in delimiters of one's choosing, and the usual choice
is `<mark>`. That would make the response HTML, and rendering it means
`innerHTML` on a string built from document content — a stored-XSS hole for the
sake of two tags.

So the delimiters are `U+0002` and `U+0003`, and the interface splits on them and
builds real elements. Nothing is ever interpreted as markup, and the decision
cannot be undone accidentally by somebody "simplifying" the renderer.

### Results are grouped, and drawn as cards

Pages and folders in separate groups, each result a card with its icon, its
title, its path and its snippet. A flat list of links cannot say what kind of
thing each hit is, and that was half the report.

## Consequences

Searching is now a query with two prefix tsqueries, a lateral join per row for the
snippet, and a subquery for the trail. On a workspace of a few thousand pages that
is fine; it is bounded by `LIMIT` and the joins run only for the rows returned. If
it ever is not, the snippet is the part to make optional — the interface would
degrade to what it shows today rather than to nothing.

An empty or unparseable query yields no rows rather than an error, because the
concatenation with `:*` is null-propagating. The route already refuses fewer than
two characters, so this is the boundary behaviour of a case that cannot arrive.

`page_search` is untouched, so no reindex and no migration.

## Alternatives considered

**Prefix on every term.** One character shorter to implement and worse to use:
`budget rep` would return everything about budgeting, and the earlier words in a
query are the ones somebody has already finished typing.

**`ILIKE '%term%'`** across titles and block text. It finds substrings anywhere,
including inside words, which is what the report literally asks for. Rejected: no
index can serve it, ranking disappears, and stemming goes with it — so a German
search stops finding declined forms, which is a regression the report did not ask
for.

**Trigram similarity now.** The right answer to typos and the wrong thing to
combine with this change: two ranking systems introduced at once cannot be
told apart when the results are wrong.

**Storing the body text on `page_search`.** Simpler query, one more copy of every
document's text, and a snippet that is a window into a concatenation with no
block to jump to.
