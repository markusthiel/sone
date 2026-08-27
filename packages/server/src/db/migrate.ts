/**
 * SONE — migration runner.
 *
 * Migrations are plain SQL files in db/migrations, applied in filename order,
 * each in its own transaction, recorded in schema_migrations.
 *
 * Append-only. A migration that has been applied on any instance is never
 * edited — write a new one. This is the same rule as ADR-0002's stance on
 * superseding decisions rather than rewriting them, for the same reason.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Pool } from 'pg';

import { queryRows, withTransaction } from './pool.js';

export interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
  sha256: string;
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const out: MigrationFile[] = [];
  for (const filename of entries) {
    const sql = await readFile(path.join(dir, filename), 'utf8');
    out.push({
      version: filename.replace(/\.sql$/, ''),
      filename,
      sql,
      sha256: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return out;
}

async function appliedVersions(db: Pool): Promise<Set<string>> {
  // schema_migrations is created by 0001 itself, so its absence just means
  // "nothing applied yet".
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
  );
  if (!rows[0]?.exists) return new Set();

  const applied = await queryRows<{ version: string }>(
    db,
    `SELECT version FROM schema_migrations`,
  );
  return new Set(applied.map((r) => r.version));
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(
  db: Pool,
  migrationsDir: string,
  log: (msg: string) => void = console.log,
): Promise<MigrateResult> {
  const migrations = await loadMigrations(migrationsDir);
  if (migrations.length === 0) {
    throw new Error(`no migrations found in ${migrationsDir}`);
  }

  const already = await appliedVersions(db);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (already.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }

    log(`[migrate] applying ${migration.filename}`);
    // Each file wraps itself in BEGIN/COMMIT and inserts its own
    // schema_migrations row, so the runner does not add another transaction —
    // nested BEGIN would warn, and some DDL prefers its own transaction.
    const client = await db.connect();
    try {
      await client.query(migration.sql);
      applied.push(migration.version);
      log(`[migrate] applied ${migration.version}`);
    } catch (err) {
      log(`[migrate] FAILED ${migration.version}`);
      throw new Error(
        `migration ${migration.filename} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    } finally {
      client.release();
    }
  }

  if (applied.length === 0) {
    log(`[migrate] up to date (${skipped.length} migrations already applied)`);
  }
  return { applied, skipped };
}

/**
 * Warn when an already-applied migration file has changed on disk.
 *
 * Not fatal — a comment fix is harmless — but it is worth surfacing, because
 * the alternative is discovering that two instances have divergent schemas.
 */
export async function checkMigrationDrift(
  db: Pool,
  migrationsDir: string,
  log: (msg: string) => void = console.warn,
): Promise<void> {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migration_hashes') IS NOT NULL AS exists`,
  );
  if (!rows[0]?.exists) return;

  const migrations = await loadMigrations(migrationsDir);
  const stored = await queryRows<{ version: string; sha256: string }>(
    db,
    `SELECT version, sha256 FROM schema_migration_hashes`,
  );
  const byVersion = new Map(stored.map((r) => [r.version, r.sha256]));

  for (const m of migrations) {
    const known = byVersion.get(m.version);
    if (known && known !== m.sha256) {
      log(
        `[migrate] WARNING: ${m.filename} changed after being applied. ` +
          `Migrations are append-only; write a new migration instead.`,
      );
    }
  }
}

export { withTransaction };
