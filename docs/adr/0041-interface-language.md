# ADR-0041: The interface's own language

## Status

Accepted.

## Context

ADR-0011 decided four layers of internationalisation and built three: the search
dictionary per workspace, the recipient locale for email, and the collation
helper. The fourth — the interface's own strings — was named as a constraint
("ICU MessageFormat", "no concatenation to build sentences") and never given a
shape.

So today every string in the web package is hardcoded English, `SUPPORTED_LOCALES`
is declared on the server and never imported by the client, and the `locale`
stored per person and per workspace changes nothing anybody can see.

The application is meant to work for anybody anywhere; German comes first,
because that is who runs it.

## Decisions

### The catalogue is TypeScript, and English is the source

`messages.en.ts` exports a flat object of key to message. Every other locale is
the same shape, typed against it, so a missing key is a compile error rather than
a blank on a screen.

Not JSON. A JSON catalogue cannot be type-checked against the keys the code uses,
and the one thing that will actually happen over time is a key being renamed in
one place and not the other.

### Keys are dotted and name a place, not a sentence

`account.signOut`, `move.consequences.restrictions`. Not the English text as the
key: an English wording change would silently orphan every translation, and the
wording changes far more often than the meaning.

A locale with a missing key falls back to **English**, not to the key. A person
reading a half-translated screen should see a sentence in a language they may not
prefer rather than `move.title`.

### Plurals are ICU, formatted by the platform

`{count, plural, one {# entry} other {# entries}}`, resolved with
`Intl.PluralRules` — which is in every browser this supports, so the formatter is
about forty lines rather than a dependency. It handles `{name}` substitution,
`plural`, and `select` for gendered languages, and nothing else until something
needs it.

This is the decision that matters most for correctness, and the reason is not
tidiness: German has two plural forms where English has two but *different* rules
around zero, Polish has four, Arabic six. A hand-written `n === 1 ? 'entry' :
'entries'` cannot be translated into any of them — it is not a string, it is
English grammar in code. Several of those exist today, written by me, and they are
what this replaces.

### Switching language does not reload the page

The locale lives in a React context; changing it re-renders. Reloading would throw
away a half-typed paragraph, and a person changing the language is very often
somebody who has just arrived and is in the middle of something.

Catalogues other than English load on demand (`import()`), so a German instance
fetches German once and an English one never pays for it.

### The locale is resolved once, in a stated order

The person's own setting, then the workspace's default, then the browser's
`navigator.languages`, then English. The first that names a locale with a
catalogue wins.

The person's own setting comes first because a workspace has one language and its
members need not share it — which is the whole reason both fields exist.

### Error codes stay codes

The server keeps sending a code and parameters; the client renders `error.<code>`.
That is what ADR-0011 decided and it survives unchanged — the existing catalogue
in `Auth.tsx` simply becomes part of the message catalogue, which is where it
should have been.

### The form of address is an instance setting, and a branch in the message

German distinguishes "du" from "Sie", and which one an instance should use is not
something this project can decide for it: a family's notes and a company's
handbook want different tones.

So it is one setting in the administration area, and in the catalogue it is a
`select` on `address` — passed to every message automatically, so a translator adds
the branch where their language needs one and nothing else changes. English
messages have no branch, which is what "meaningless in English" looks like in a
catalogue.

**Not a second locale.** `de-formal` would duplicate every German string, and two
catalogues of the same language drift — one gets a correction and the other does
not, and nobody notices because nobody reads both.

**Not a personal setting.** Two members of one workspace reading different forms of
address in the same sentence would be stranger than either choice, and it is the
people running the instance who know which their readers expect. It is delivered
with `/api/instance` rather than with the session, because the sign-in screen is
addressed too and there is nobody to ask yet.

The default is "du", because that is what the interface said before the setting
existed and an instance should not change its tone by being upgraded.

The branch is named `other` rather than `informal`, so a message still renders
when nothing is passed and a language without the distinction needs no branch at
all.

### A test makes the migration hold

The extraction is a thousand strings across sixty components and cannot happen in
one commit. So a test carries the list of files that have been migrated and fails
if any of them contains user-visible text in JSX. The list grows; nothing may
leave it.

The alternative — migrate everything, then add the test — means a half-migrated
codebase with nothing stopping the next component from arriving in English. Which
is precisely how a translation effort dies.

### What is not translated

User content, obviously: page titles, workspace names, what somebody wrote.

Dates and numbers are formatted rather than translated, with `Intl.DateTimeFormat`
and `Intl.NumberFormat` against the resolved locale.

The records in `docs/adr` and the CHANGELOG stay English. They are addressed to
whoever maintains this, and a translated architecture record is a second document
that will disagree with the first.

## Consequences

Adding a language is a file plus a line in the locale list — no schema change, as
ADR-0011 promised.

Right-to-left remains a separate piece of work. The CSS is already logical
throughout (a grep finds `margin-left` only in comments), so it is a `dir`
attribute and a review rather than a rewrite, but it is not this.

Until the migration is complete, a German interface will have English patches. The
notice about that belongs in the language setting itself rather than in a release
note nobody re-reads.

## Alternatives considered

**A library — i18next, FormatJS, Lingui.** Rejected on the same grounds as the
other dependencies here (ADR-0004): what is needed is a lookup, a plural rule and
an interpolation, and `Intl.PluralRules` provides the only hard part. A library
would also bring its own catalogue format, which is the part this decides
deliberately.

**English text as the key**, as several frameworks encourage. Rejected above: it
couples the translation to the English wording, and the wording is the thing that
changes.

**Server-rendered messages.** Rejected by ADR-0011 and still rejected: the
catalogue would exist twice and an error already on screen could not re-render in
a new language.

**Machine translation to seed the other locales.** Not rejected, but not a
decision for this record: it produces plausible text that nobody has read, and the
question of whether that is better than English is a product question rather than
an architectural one.
