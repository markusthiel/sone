#!/usr/bin/env node
/**
 * Remove stored files belonging to no row (ADR-0109).
 *
 *   docker compose exec app node packages/server/scripts/sweep-orphan-files.mjs
 *   docker compose exec app node packages/server/scripts/sweep-orphan-files.mjs --apply
 *
 * Purging a deleted workspace removes its `files` rows by cascade and leaves
 * every attachment on the disk. So does replacing a profile picture, by
 * design — content-addressed keys mean two people with the same picture share
 * one file, so a replacement cannot delete the old one without risking
 * somebody else's.
 *
 * **Reports by default.** Nothing is removed without `--apply`. Three columns
 * hold a storage key — `files.storage_key`, `users.avatar_key` and an export's
 * key inside `jobs.result` — and the number this prints is one an operator can
 * check against their own instance before acting on it.
 *
 * Safe while the instance is serving traffic: only files older than the age
 * window are considered, which is what keeps an upload in flight out of reach.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../dist/config.js';
import { createPool, closePool } from '../dist/db/pool.js';
import { LocalFileStore } from '../dist/files/store.js';
import { sweepOrphanFiles } from '../dist/files/sweepOrphanFiles.js';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    'older-than-hours': { type: 'string', default: String(24 * 7) },
    limit: { type: 'string' },
  },
});

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const store = new LocalFileStore(config.storage.path);

try {
  const report = await sweepOrphanFiles(pool, store, {
    apply: values.apply,
    olderThanHours: Number(values['older-than-hours']),
    ...(values.limit ? { limit: Number(values.limit) } : {}),
  });

  if (report.files === 0) {
    console.log('[sweep] every stored file is named by a row. Nothing to do.');
  } else {
    const mb = (report.bytes / 1_048_576).toFixed(1);
    console.log(`[sweep] ${report.files} file(s) belong to no row: ${mb} MB.`);
    for (const key of report.sample) console.log(`  ${key}`);
    if (report.files > report.sample.length) {
      console.log(`  … and ${report.files - report.sample.length} more`);
    }
    console.log(
      report.applied
        ? '[sweep] removed.'
        : '[sweep] nothing was removed. Re-run with --apply once the list above looks right.',
    );
  }
  process.exitCode = 0;
} catch (err) {
  console.error('[sweep] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}
