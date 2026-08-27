#!/usr/bin/env node
/**
 * Create a backup archive.
 *
 *   docker compose exec app node packages/server/scripts/backup.mjs
 *   docker compose exec app node packages/server/scripts/backup.mjs --out /backups
 *
 * Safe to run while the instance is serving traffic. Files are archived before
 * the database on purpose — see src/backup/backup.ts for why the ordering is
 * not arbitrary.
 */
import { parseArgs } from 'node:util';

import { SCHEMA_VERSION } from '@sone/core';

import { loadConfig } from '../dist/config.js';
import { createPool, closePool } from '../dist/db/pool.js';
import { createBackup } from '../dist/backup/backup.js';
import { SONE_VERSION } from '../dist/http/health.js';

const { values } = parseArgs({
  options: { out: { type: 'string', default: '/var/lib/sone/backups' } },
});

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const manifest = await createBackup({
    pool,
    databaseUrl: config.databaseUrl,
    outputDir: values.out,
    filesPath: config.storage.backend === 'local' ? config.storage.path : null,
    appVersion: SONE_VERSION,
    documentSchemaVersion: SCHEMA_VERSION,
  });
  console.log(`\nBackup format ${manifest.backupFormatVersion}, created ${manifest.createdAt}`);
  process.exitCode = 0;
} catch (err) {
  console.error('[backup] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}
