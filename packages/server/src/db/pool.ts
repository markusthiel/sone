/**
 * SONE — Postgres access.
 *
 * A thin wrapper over `pg`. No ORM: the materialiser writes bulk statements
 * whose shape matters for performance, and the query layer for collection
 * views builds SQL dynamically from filter trees. An ORM would be fought
 * with rather than used.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type Db = Pool | PoolClient;

let pool: Pool | null = null;

export function createPool(databaseUrl: string): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env['SONE_DB_POOL_MAX'] ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Fractional indices are compared byte-wise and the C collation is
    // assumed throughout. Assert it rather than trust the deployment.
    application_name: 'sone',
  });
  pool.on('error', (err) => {
    // An idle client erroring is not fatal, but silence here hides a dying
    // database until the next request.
    console.error('[db] idle client error', err);
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('database pool not initialised; call createPool first');
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Verify assumptions the schema depends on. Called at startup.
 *
 * The collation check is not paranoia: with a locale-aware collation,
 * fractional index comparison changes and sibling order silently scrambles.
 * Better to refuse to start.
 */
export async function verifyDatabaseAssumptions(db: Db): Promise<void> {
  const { rows } = await db.query<{ collate: string; ctype: string; version: string }>(
    `SELECT datcollate AS collate, datctype AS ctype, version() AS version
       FROM pg_database WHERE datname = current_database()`,
  );
  const row = rows[0];
  if (!row) throw new Error('could not read database collation');

  const acceptable = ['C', 'C.UTF-8', 'C.utf8', 'POSIX'];
  if (!acceptable.includes(row.collate)) {
    throw new Error(
      `database collation is "${row.collate}" but SONE requires one of ` +
        `${acceptable.join(', ')}. Fractional index ordering depends on ` +
        `byte-wise comparison; a locale-aware collation will reorder blocks. ` +
        `Recreate the database with --locale=C (see docker-compose.yml).`,
    );
  }
}

export async function withTransaction<T>(
  db: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function queryRows<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await queryRows<T>(db, sql, params);
  return rows[0] ?? null;
}
