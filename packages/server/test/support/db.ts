/**
 * SONE — integration test harness.
 *
 * Tests run against a real Postgres, never a mocked `pg` client. A mock would
 * verify the mock's assumptions, not the behaviour of `unnest`, the recursive
 * CTE behind the ancestor cascade, `ON CONFLICT` semantics, `tsvector` ranking,
 * or C-collation ordering. Those are the things that actually break.
 *
 * ## One database per test file
 *
 * Node's test runner executes test *files* in parallel, one process per file,
 * with concurrency defaulting to the CPU count. Sharing a single database
 * across them does not work, and the failure is spectacular rather than subtle:
 *
 *   - `CREATE EXTENSION IF NOT EXISTS pgcrypto` races itself, and one process
 *     gets a duplicate-key error on pg_extension_name_index
 *   - one file's `TRUNCATE ... CASCADE` deadlocks against another's
 *   - a file that has just truncated leaves another mid-test looking at rows
 *     whose foreign keys have vanished
 *
 * This went unnoticed because the machine it was written on has one CPU, so the
 * runner serialised the files and the suite passed. It surfaces on any machine
 * with more cores, where the symptoms all look like application bugs rather
 * than like a harness that cannot share a database.
 *
 * Reproduce it on a single-CPU machine with --test-concurrency=8.
 *
 * So each test file gets its own database, named after the file. Files are then
 * genuinely independent: they can truncate, drop schemas and install extensions
 * without coordinating. The cost is running the migrations once per file, which
 * is a few hundred milliseconds and worth it.
 *
 * Setup:
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   export SONE_TEST_DATABASE_URL=postgres://sone:sone@localhost:5433/sone_test
 *   pnpm --filter @sone/server test
 *
 * Without SONE_TEST_DATABASE_URL the database tests skip rather than fail, so
 * `pnpm test` stays useful on a machine with no Postgres.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, Pool } from 'pg';

import { migrate } from '../../src/db/migrate.js';
import { verifyDatabaseAssumptions } from '../../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../../db/migrations');

export const TEST_DATABASE_URL = process.env['SONE_TEST_DATABASE_URL'];

/** True when database tests can run. Used to skip rather than fail. */
export const hasDatabase = Boolean(TEST_DATABASE_URL);

/**
 * A database name unique to this test file.
 *
 * Derived from the entry script rather than randomly, so a leftover database
 * from a killed run is reused and dropped rather than accumulating. The hash
 * keeps the name inside Postgres's 63-byte identifier limit while leaving it
 * recognisable in `\l` output when debugging.
 */
function databaseNameForThisFile(): string {
  const entry = process.argv[1] ?? 'unknown';
  const base = path
    .basename(entry)
    .replace(/\.test\.[tj]s$/, '')
    .replace(/\.db$/, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .toLowerCase()
    .slice(0, 28);
  const hash = createHash('sha256').update(entry).digest('hex').slice(0, 8);
  return `sone_t_${base}_${hash}`;
}

const DATABASE_NAME = databaseNameForThisFile();

/** Connection string for a database on the configured server. */
function urlForDatabase(name: string): string {
  const url = new URL(TEST_DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Administrative connection, used only to create and drop the per-file
 * database. A dedicated Client rather than the pool, because CREATE DATABASE
 * cannot run inside a transaction and must not target the database it creates.
 */
async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urlForDatabase('postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Connection string for *this file's* database.
 *
 * Anything that shells out to `pg_dump` or `pg_restore` must use this, not
 * SONE_TEST_DATABASE_URL — that one names the base database the harness
 * connects to in order to create per-file databases, and dumping it would
 * capture an empty schema while the test's own data sits elsewhere.
 */
export const testDatabaseUrl = (): string => urlForDatabase(DATABASE_NAME);

let pool: Pool | null = null;
let prepared = false;

export async function getTestPool(): Promise<Pool> {
  if (!TEST_DATABASE_URL) {
    throw new Error('SONE_TEST_DATABASE_URL is not set');
  }

  if (!prepared) {
    await withAdminClient(async (admin) => {
      // Dropped first: a database left behind by a killed run may hold a schema
      // from an older migration set, and reusing it would test the wrong thing.
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE_NAME)}`);
      await admin.query(`CREATE DATABASE ${quoteIdent(DATABASE_NAME)}`);
    });
    prepared = true;

    pool = new Pool({ connectionString: urlForDatabase(DATABASE_NAME), max: 4 });

    // Verified before anything else: under a locale-aware collation the
    // ordering tests would fail in a way that looks like an application bug.
    await verifyDatabaseAssumptions(pool);
    await migrate(pool, MIGRATIONS_DIR, () => {});
  }

  if (!pool) throw new Error('test pool was closed; getTestPool cannot reopen it');
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
  if (prepared) {
    // Dropped so a long session does not leave dozens of databases behind.
    // Failure is tolerated: an orphaned test database is untidy rather than
    // harmful, and throwing here would mask the actual test result.
    await withAdminClient((admin) =>
      admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE_NAME)}`),
    ).catch(() => {});
    prepared = false;
  }
}

/** Identifiers cannot be parameterised. This one is derived, not user input. */
function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to use unsafe database identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Empty every table between tests.
 *
 * TRUNCATE ... CASCADE in one statement so foreign keys do not dictate an
 * order that has to be maintained by hand as the schema grows. Safe to do
 * this bluntly now that each file owns its own database.
 */
export async function resetDatabase(db: Pool): Promise<void> {
  await db.query(`
    DO $$
    DECLARE
      tables text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO tables
        FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename <> 'schema_migrations';
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$;
  `);
  await db.query(`SELECT setval('doc_update_seq', 1, false)`);
}

// --- fixtures --------------------------------------------------------------

export interface Fixture {
  workspaceId: string;
  userId: string;
}

/**
 * Minimal workspace and owner. Kept deliberately small: a fixture that
 * creates pages would hide whether the code under test creates them.
 */
export async function seedWorkspace(db: Pool, name = 'Test workspace'): Promise<Fixture> {
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
    [`owner-${Date.now()}-${Math.random().toString(36).slice(2)}@example.org`, 'Owner'],
  );
  const userId = user.rows[0]!.id;

  const workspace = await db.query<{ id: string }>(
    `INSERT INTO workspaces (name, created_by) VALUES ($1, $2) RETURNING id`,
    [name, userId],
  );
  const workspaceId = workspace.rows[0]!.id;

  await db.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [workspaceId, userId],
  );

  return { workspaceId, userId };
}

/** Deterministic uuid so failures are reproducible from the test source. */
export const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
