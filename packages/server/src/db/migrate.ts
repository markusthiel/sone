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

      // Recorded here if the file did not record itself.
      //
      // The convention is that each file inserts its own row, and it is a
      // convention with no enforcement — so forgetting it is possible, and the
      // consequence is severe out of all proportion to the mistake: the
      // migration's changes are applied, nothing is recorded, and every
      // subsequent start retries it and fails on "already exists". The server
      // then never boots, and the only visible symptom is a blank page.
      //
      // That happened with 0007_folders on a deployed instance. The runner no
      // longer depends on every file remembering.
      const recorded = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM schema_migrations WHERE version = $1`,
        [migration.version],
      );
      if (Number(recorded.rows[0]?.n ?? 0) === 0) {
        await client.query(
          `INSERT INTO schema_migrations (version) VALUES ($1)
             ON CONFLICT (version) DO NOTHING`,
          [migration.version],
        );
        log(
          `[migrate] ${migration.version} did not record itself; recorded by the ` +
            `runner. Add "INSERT INTO schema_migrations (version) VALUES ` +
            `('${migration.version}');" to the file.`,
        );
      }

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


export { withTransaction };
