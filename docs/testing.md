# Testing

Two suites, split by whether they need a database.

```sh
pnpm test                     # unit tests, no database required
```

```sh
docker compose -f docker-compose.test.yml up -d
export SONE_TEST_DATABASE_URL=postgres://sone:sone@localhost:5433/sone_test
pnpm --filter @sone/server test:db
```

Without `SONE_TEST_DATABASE_URL` the database suites skip rather than fail, so
`pnpm test` stays useful on a machine with no Postgres.

## One database per test file

Node's test runner executes test *files* in parallel, one process per file,
with concurrency defaulting to the CPU count. Each file therefore creates and
drops its own database, named after itself.

This is not tidiness. Sharing one database across parallel files fails loudly
and misleadingly: `CREATE EXTENSION IF NOT EXISTS pgcrypto` races itself into a
duplicate-key error, `TRUNCATE ... CASCADE` deadlocks between files, and a file
that has just truncated leaves another mid-test staring at rows whose foreign
keys have vanished. Every symptom looks like an application bug.

It stayed hidden because the machine this was written on has one CPU, so the
runner serialised the files and the suite passed. It surfaces on any machine
with more cores. To reproduce it deliberately:

```sh
pnpm --filter @sone/server exec tsx --test --test-concurrency=8 test/*.test.ts
```

Anything shelling out to `pg_dump` or `pg_restore` must use `testDatabaseUrl()`
from the harness, not `SONE_TEST_DATABASE_URL`. The latter names the base
database used only to create the per-file ones; dumping it captures an empty
schema while the test's data sits elsewhere.

## Why the editor is mounted in tests

`packages/editor/test/mount.test.ts` builds a real `EditorView` against jsdom.

It exists because 361 passing tests did not catch a bug that made every page in
the application render white. `dispatchTransaction` referenced the `view` const
that the `EditorView` constructor was in the middle of assigning; ySyncPlugin
dispatches from inside that constructor to populate the document, so the
callback ran while `view` was still in its temporal dead zone and threw.

Nothing in the rest of the suite could have found it. Every other editor test
drives `EditorState` and plugins headlessly, and the bug lived in the assembly.
A schema, a plugin and a command can all be correct while the thing that puts
them together is broken.

jsdom does not verify rendering, layout or real input events — those still need
a browser. It verifies that the editor mounts, receives its document, accepts a
transaction, writes back to Yjs, and tears down twice without complaint.

## Why no mocked database

The database tests run against a real Postgres. A mocked `pg` client would
verify the mock's assumptions rather than the behaviour of `unnest`, the
recursive CTE behind the ancestor cascade, `ON CONFLICT` semantics, `tsvector`
ranking, or C-collation ordering. Those are the things that actually break.

This is not a theoretical preference. The first run of the integration suite
found three foreign keys in migration 0001 that forbade a state the system
legitimately passes through — a child page syncing before its parent, a
collection row before its collection, a property before its field definition.
None of that was visible to the type checker or to a mock. See migration 0003.

## Building before typechecking

Workspace packages resolve each other through their built declarations
(`dist/index.d.ts`), so a typecheck needs its dependencies compiled. Each
package's `typecheck` and `test` scripts therefore run `tsc -b` on their
dependencies first, which makes them work on a fresh clone.

Do not remove those prefixes. Without them, `pnpm typecheck` passes on a machine
that has built once and fails on a clean checkout — a difference that only shows
up in CI or on somebody else's first day.

## Collation

The test database must use the C collation, same as production. Fractional
indices are compared byte-wise; under a locale-aware collation the ordering
tests would fail for reasons unrelated to the code, and — worse — could pass
while production silently reorders blocks. `verifyDatabaseAssumptions` refuses
to run against a wrongly collated database.

## What the compiler cannot see

TypeScript does not look inside a template literal, so **every column name in
SQL is unchecked**. This session lost twice to that: `n.actor_id` on a table
that had no such column, and a `GET /api/admin/settings` route that does not
exist. Both typechecked, and both failed at the moment the code ran — on
whatever path happened to be exercised, which for the mail job would have been
the first send on somebody's instance.

Three tests close the ordinary cases, all by reading source rather than running
it:

- `sqlColumns.db.test.ts` resolves every `alias.column` in the server's SQL
  through the statement's own `FROM`/`JOIN` and checks it against
  `information_schema`. It does not attempt CTEs, subquery aliases or
  concatenated SQL — a checker that argues with you gets turned off, so silence
  means "nothing obviously wrong" and not "correct".

  **And it counts what it could not resolve**, with a ratchet on that number.
  Both of this check's own false-positive sources were found by reading what it
  had collected rather than by trusting its silence: `` `[^`]*` `` matches the
  text *between* two unrelated literals, so ordinary JavaScript was being
  scanned as SQL, and `WITH` is also an English word, so a JSDoc paragraph
  beginning "with no numeric part…" was read as a statement. Fixing both took
  the unchecked references from 76 to 26.
- `routePaths.test.ts` checks every path the client asks for against the routes
  the server registers.
- `errorMessages.test.ts` checks that every refusal code has a message, or is
  named as deliberately not having one.

Each of them begins with a test that makes the check **fail on purpose**. A
guard nobody has seen catch anything is a guard nobody should believe, and the
one in `sqlColumns` puts back the exact mistake that prompted it.

## Fixtures

Kept deliberately minimal. `seedWorkspace` creates a workspace and an owner
and nothing else; a fixture that created pages would hide whether the code
under test creates them correctly. Ids come from `uuid(n)`, which is
deterministic, so a failure is reproducible from the test source.
