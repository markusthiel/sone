# ADR-0011: Internationalisation

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

SONE is built for German-speaking self-hosters first but is meant to be usable
in any language. Three of the four layers of internationalisation are schema
decisions, and one of them contradicts a decision already made in
migration 0001.

## Decision

### The API returns error codes, never translated sentences

Every error carries a machine-readable code plus parameters; the client renders
it. The sync protocol's error frame is `{ code, detail }` where `detail` is for
logs only.

Two reasons. A server that returns prose needs the whole catalogue twice, and
an error already on screen cannot be re-rendered when the user switches
language.

### Locale is stored, not inferred

`users.locale` and `users.timezone`, plus `workspaces.default_locale`.

An `Accept-Language` header describes a browser; a stored preference describes a
person. More importantly, notification and invitation emails must be written in
the **recipient's** language, which has nothing to do with the request that
triggered them: an invitation sent by a German admin to a French colleague
arrives in French. Resolution order is user, then workspace, then English.

The timezone matters server-side too, for date grouping in calendar views —
"this week" depends on where the reader is.

### Search indexes under two dictionaries at once

Migration 0001 hardcoded `to_tsvector('simple', ...)`, which does no stemming:
a German search for *Häuser* would not find *Haus*, and *running* would not
find *run*. Visibly broken search for any non-trivial language.

The stored vector now carries lexemes from both the workspace's configured
dictionary and `simple`:

```sql
setweight(to_tsvector('german', body), 'D') ||
setweight(to_tsvector('simple', body), 'D')
```

The stemmed lexemes give recall; the simple lexemes keep search working for
content in a language the dictionary does not cover, which is the normal case
in a real multilingual workspace. Roughly doubles the body index, which is a
fair price for search that works in two languages simultaneously.

`page_search.built_with` records which configuration produced a row, and the
`stale_search_rows` view makes a mismatch visible instead of silently wrong.
Changing a workspace's language requires
`rematerialize.mjs --workspace <id>` — the code returns
`searchConfigChanged` so the caller knows.

Postgres ships no dictionary for Chinese, Japanese or Korean. Those fall back
to `simple` until an operator installs an extension. Honest limitation, not a
hidden one.

### Collation: the conflict with ADR-0002

ADR-0002 and migration 0001 mandate the C collation database-wide, and that is
still correct — fractional indices are compared byte-wise, and a locale-aware
database collation would silently reorder blocks. `verifyDatabaseAssumptions`
refuses to start otherwise.

But C collation is wrong for text a human reads. Verified against Postgres 16:

```
select 'Äpfel' < 'Zwiebel';                                    -- false
select ('Äpfel' collate "und-x-icu") < ('Zwiebel' collate "und-x-icu");  -- true
```

An alphabetical list of German page titles under C collation is visibly wrong.

Resolution: the database collation stays C, and every query sorting
**user-visible** text applies an explicit `COLLATE` using the workspace's
`sort_collation`. The rule, stated so it can be checked in review:

- `ORDER BY idx` — never `COLLATE`. Byte-wise is the requirement.
- `ORDER BY title`, or any text property value — always `COLLATE`.

Default is `und-x-icu`, the language-neutral Unicode collation: correct for
most European languages and the only defensible choice for a workspace holding
mixed-language content. Language-specific collations are used where the
difference would be obvious to a native reader — Swedish sorts *ä* after *z*
where German sorts it with *a*, and no single collation is right for both.

Collation names cannot be parameterised in SQL, so `collateClause` interpolates
them into the query and therefore validates against a pattern. That validation
is load-bearing; do not relax it.

### Web client constraints

Binding now, cheap now, expensive later:

- Logical CSS properties (`margin-inline-start`, not `margin-left`) and `dir`
  handling from the start, so right-to-left is a setting rather than a rewrite.
  Mixed-direction content needs per-block direction, which means the block
  model must carry it.
- ICU MessageFormat for plurals and gender. `Intl.PluralRules` is built into
  the platform; the formatter is a thin layer over it.
- No string concatenation to build sentences. Word order differs by language
  and concatenation cannot express that.

## Consequences

Adding a language is a catalogue plus, optionally, a search dictionary and
collation entry. No schema change.

Every list query must remember the `COLLATE` rule. This is the weakest part of
the decision: it relies on discipline rather than the type system. Mitigated by
`collateClause` being the only way to produce the clause, and by the two
collated indexes existing so a missing `COLLATE` shows up as a slow query
rather than silently wrong output.

Changing a workspace's language invalidates its search index. Recoverable and
visible, but not instant.

## Alternatives considered

**Translate errors server-side.** Rejected: doubles the catalogue and prevents
re-rendering on language switch.

**One `simple` search configuration for everyone.** What 0001 did. Rejected
because it makes search visibly bad in every inflected language.

**Language-aware database collation, and encode fractional indices in a
collation-safe alphabet.** Considered. It would remove the per-query `COLLATE`
discipline, but requires the index alphabet to sort identically under every
collation, which is not a property any ICU collation guarantees. Rejected as
more fragile than the discipline it replaces.

**Per-page language detection.** Better search in theory. Rejected: detection
is unreliable on short text, and a wrong guess makes a page unfindable.
