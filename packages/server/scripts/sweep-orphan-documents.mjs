#!/usr/bin/env node
/**
 * Remove CRDT content belonging to no page (ADR-0106).
 *
 *   docker compose exec app node packages/server/scripts/sweep-orphan-documents.mjs
 *   docker compose exec app node packages/server/scripts/sweep-orphan-documents.mjs --apply
 *
 * An instance that purged a deleted workspace under a build older than ADR-0080
 * still holds every byte of every page that was in it: the purge cascaded to
 * `pages` and stopped there, because `doc_updates.doc_id` deliberately carries
 * no foreign key. This removes what was left.
 *
 * **Reports by default.** Nothing is deleted without `--apply`, because this is
 * the query ADR-0080 called "one mistake away from deleting live data" and the
 * number it prints is one an operator can check against their own history
 * before acting on it.
 *
 * Safe to run while the instance is serving traffic, and safer still with it
 * stopped. The age window is what keeps a document that is merely arriving
 * ahead of its page out of reach; a week by default.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../dist/config.js';
import { createPool, closePool } from '../dist/db/pool.js';
import { sweepOrphanDocuments } from '../dist/doc/sweepOrphanDocuments.js';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    'older-than-hours': { type: 'string', default: String(24 * 7) },
    limit: { type: 'string' },
  },
});

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const report = await sweepOrphanDocuments(pool, {
    apply: values.apply,
    olderThanHours: Number(values['older-than-hours']),
    ...(values.limit ? { limit: Number(values.limit) } : {}),
  });

  if (report.documents === 0) {
    console.log('[sweep] no documents belong to a page that is gone. Nothing to do.');
  } else {
    console.log(
      `[sweep] ${report.documents} document(s) belong to no page: ` +
        `${report.updates} update(s) and ${report.snapshots} snapshot(s).`,
    );
    for (const id of report.sample) console.log(`  ${id}`);
    if (report.documents > report.sample.length) {
      console.log(`  … and ${report.documents - report.sample.length} more`);
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
