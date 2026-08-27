#!/usr/bin/env node
/**
 * Restore a backup archive.
 *
 *   docker compose exec app node packages/server/scripts/restore.mjs \
 *     --archive /var/lib/sone/backups/sone-2026-08-27T10-00-00-000Z
 *
 * Stop the application before restoring. Restoring underneath a running
 * instance leaves rooms in memory holding documents that no longer match the
 * database.
 *
 * Refuses a non-empty target database unless --force is given.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../dist/config.js';
import { createPool, closePool } from '../dist/db/pool.js';
import { restoreBackup } from '../dist/backup/backup.js';

const { values } = parseArgs({
  options: {
    archive: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

if (!values.archive) {
  console.error('usage: restore.mjs --archive <directory> [--force]');
  process.exit(2);
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const report = await restoreBackup({
    pool,
    archiveDir: values.archive,
    databaseUrl: config.databaseUrl,
    filesPath: config.storage.backend === 'local' ? config.storage.path : null,
    requireEmpty: !values.force,
  });
  for (const warning of report.warnings) {
    console.warn(`[restore] warning: ${warning}`);
  }
  process.exitCode = 0;
} catch (err) {
  console.error('[restore] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}
