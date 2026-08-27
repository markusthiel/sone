/**
 * SONE — integration test harness.
 *
 * Tests run against a real Postgres, never a mocked `pg` client. A mock would
 * verify the mock's assumptions, not the behaviour of `unnest`, `ON CONFLICT`,
 * the recursive CTE behind the ancestor cascade, or the C-collation ordering
 * that fractional indices depend on. Those are exactly the things that break.
 *
 * Setup:
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   export SONE_TEST_DATABASE_URL=postgres://sone:sone@localhost:5433/sone_test
 *   pnpm --filter @sone/server test:db
 *
 * Without SONE_TEST_DATABASE_URL the database tests skip rather than fail, so
 * `pnpm test` stays useful on a machine with no Postgres.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { migrate } from '../../src/db/migrate.js';
import { verifyDatabaseAssumptions } from '../../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../../db/migrations');

export const TEST_DATABASE_URL = process.env['SONE_TEST_DATABASE_URL'];

/** True when database tests can run. Used to skip rather than fail. */
export const hasDatabase = Boolean(TEST_DATABASE_URL);

let pool: Pool | null = null;
let migrated = false;

export async function getTestPool(): Promise<Pool> {
  if (!TEST_DATABASE_URL) {
    throw new Error('SONE_TEST_DATABASE_URL is not set');
  }
  if (!pool) {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  }
  if (!migrated) {
    // Verify the collation before anything else: with a locale-aware
    // collation the ordering tests would fail in a way that looks like an
    // application bug.
    await verifyDatabaseAssumptions(pool);
    await migrate(pool, MIGRATIONS_DIR, () => {});
    migrated = true;
  }
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    migrated = false;
  }
}

/**
 * Empty every table between tests.
 *
 * TRUNCATE ... CASCADE in one statement so foreign keys do not dictate an
 * order that has to be maintained by hand as the schema grows. Sequences are
 * restarted so sequence numbers are comparable across tests.
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
