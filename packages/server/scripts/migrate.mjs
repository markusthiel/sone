#!/usr/bin/env node
/**
 * Apply pending migrations. Run by the container entrypoint on every start,
 * and safe to run by hand.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../dist/config.js';
import { createPool, closePool, verifyDatabaseAssumptions } from '../dist/db/pool.js';
import { migrate } from '../dist/db/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../db/migrations');

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  await verifyDatabaseAssumptions(pool);
  const result = await migrate(pool, migrationsDir);
  if (result.applied.length > 0) {
    console.log(`[migrate] applied: ${result.applied.join(', ')}`);
  }
  process.exitCode = 0;
} catch (err) {
  console.error('[migrate] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}
