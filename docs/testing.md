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

## Fixtures

Kept deliberately minimal. `seedWorkspace` creates a workspace and an owner
and nothing else; a fixture that created pages would hide whether the code
under test creates them correctly. Ids come from `uuid(n)`, which is
deterministic, so a failure is reproducible from the test source.
