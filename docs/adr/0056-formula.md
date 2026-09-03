# ADR-0056: A formula column

## Status

Accepted. Nothing built yet.

## Context

The last thing ADR-0054 deferred, and the one it deferred hardest: "an
expression language: a parser, an evaluation order, a decision about what a
formula may reference, and cycle detection that the rollup rule above avoids by
construction and a formula cannot".

Two of those three worries turn out to be avoidable by choosing the language
carefully. This record is mostly about what the language *cannot* do.

## Decisions

### A formula may not reference another formula

The rollup rule — "a rollup may aggregate a stored field, never another derived
one" — removed cycles by construction rather than detecting them. The same trick
works here, and it is the single most important decision in this record.

A formula may read the row's **stored** fields and its **rollups**. It may not
read another formula. So there is no dependency graph among formulas, no cycle to
detect, no evaluation order to compute, and no recomputation cascade.

The cost is real: `Total` and `Total with tax` cannot build on each other, and
somebody will have to repeat an expression. That is a worse language and a
program that cannot lock up, and the trade is the same one ADR-0054 already made
for rollups.

Cycle detection is not a hard algorithm. What it is is a thing that must be
correct in the projection, in the interface's preview, in the importer, and in
whatever reads a document next year — and a rule that makes cycles impossible is
correct in all of them for free.

### Expressions only, evaluated per row, on the server

No statements, no assignment, no loops. An expression over the row's own values.

Evaluated where the rollups are: in the read route, with the projection. That
keeps the promise ADR-0054 made — derived values come from the server and are
read-only — and it is what lets a formula be sorted, filtered and exported like
any other column. A formula evaluated in the browser would be absent from a CSV
and unsortable, which is two features lost to save a small amount of work.

### Infix arithmetic, and functions for the rest

`(Menge * Preis) * 1.19` reads the way somebody writes it on paper. Requiring
`multiply(add(...))` for arithmetic is a language for programmers, and the people
who want a formula column are the ones who know a spreadsheet.

Everything else is a function call: `if(...)`, `round(...)`, `concat(...)`,
`days(...)`. A small set, and adding to it is a decision each time rather than a
namespace.

### Fields are named, not numbered

`Menge * Preis`, not `$1 * $2` and not `prop("Menge") * prop("Preis")`. A name
with a space in it is written `[Netto ohne Steuer]`.

Names are resolved to field ids **when the formula is saved**, and the ids are
what is stored beside the text. So renaming a column does not break a formula,
and the formula's text is re-rendered from the ids when it is shown — which means
the text somebody typed is not quite the text they see back. That is the right
way round: a formula that breaks when a column is renamed is a formula people
learn not to trust.

### Four types, and no coercion that guesses

Number, text, boolean, date. `1 + "2"` is an error rather than 3 or "12" — the
two most popular answers to that question in other languages are both wrong often
enough to have cost people money.

An empty cell is not zero. It is empty, and any arithmetic on it is empty, which
propagates: a total over a row with a missing price is empty rather than wrong.
`coalesce(Preis, 0)` is how somebody says they meant zero.

### An error shows in the cell, with its reason

Not blank, not zero, not `#ERROR`. The cell says what went wrong — "no column
called Preis", "cannot add a number and a text" — because a formula is written by
somebody who will need to fix it, and the only place they will look is the column
they were watching.

Errors are per row: a formula can work for nine rows and fail on the tenth
because that row's cell is text where the others are numbers. Nine results and
one message is more useful than ten messages.

### The parser is hand-written, bounded, and never `eval`

Recursive descent, a few hundred lines. Bounded input (500 characters), bounded
depth (32), bounded work per row. No `Function`, no `eval`, no library: this
evaluates strings from a document on the server, and a formula language is a
sandbox escape waiting to be found if it is anything other than a small parser
that does exactly what it says.

## Consequences

`DERIVED_FIELD_TYPES` already includes `formula`, so nothing about the field
model changes. The evaluation belongs beside `computeRollup`, and the two are
computed in the same place for the same rows.

Sorting by a formula is sorting by a derived column, which ADR-0054 allows and
ADR-0055 excludes from paging — a view sorted by a formula reads the whole
collection, and already says so.

## What is deliberately not decided

**Formulas across rows.** `sum(Rechnungen.Betrag)` is a rollup, and it exists.
The formula language stays inside one row so that the two features do not grow
into each other.

**A function library.** Trigonometry, regular expressions, date arithmetic beyond
days between two dates. Each is a decision; none is needed to make the column
useful.

**Localised function names.** `wenn()` beside `if()` is tempting for a German
interface and it means a formula written by one person does not parse for
another. The prefixes in ADR-0050 were decided the same way and for the same
reason.
