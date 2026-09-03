# ADR-0056: A formula column

## Status

Accepted and built: the language, the validation, the evaluation, and a dialog
to write one in. What is not built is named at the end.

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
stored beside the text as a binding from name to id. So renaming a column does
not break a formula: the text still says `Menge` and the binding still points at
the column.

**Corrected while building it.** This said the text would be *re-rendered* from
the ids when shown. It is not: the stored text is displayed as it was typed, so
a renamed column keeps its old name inside the formula while the formula keeps
working. Re-rendering needs a printer for the syntax tree, which is its own small
piece of work and not one this slice needed — and claiming it while storing the
raw text would have been a promise nobody could find in the code.

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

## Not built yet

**An editor.** A formula is typed into a one-line field with the usable column
names above it, and validated by the server — one validator, on the side that
stores it, rather than two that can disagree about what is allowed. A formula can be
edited from its own column, in the same dialog — and that edit goes through the
same validation on the way in, or the rule forbidding a formula from reading a
formula would hold only when a column was created. That was the hole the rollup
rule had, met a second time and closed before shipping this time.

**Completion, and deliberately no syntax highlighting.**

The field completes column names and function names from what the collection
actually has, so a suggestion cannot be something the server would refuse — a
formula may not read another formula, and offering one would be teaching
somebody a mistake. The list lives in core beside the parser: what a formula may
name is the parser's business, and a second list in the interface would be a
second answer to it, one that could offer a function the evaluator does not
have.

Accepting a suggestion inserts what parses rather than just the name — brackets
around a column with a space, an opening parenthesis after a function, with the
caret inside it. A completion that leaves a formula that does not parse has made
things worse.

Escape closes the list before it closes the dialog. One Escape that did both
would lose a typed formula because a suggestion happened to be open. Enter
accepts a suggestion only while the list is open, so the key that finishes a
formula does not depend on what is showing.

**No highlighting**, and this is the trade rather than an omission: the field is
an `input`, and colouring text inside one is impossible without replacing it
with a contenteditable and reimplementing selection, undo and mobile keyboards.
A formula is one line, and its errors are already named in the cell — completion
prevents mistakes, where colour would only show them.

**Re-rendering the text after a rename**, as above: a printer for the tree.

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
