#!/usr/bin/env node
/**
 * Rebuild the relational projection from the CRDTs.
 *
 * This is the recovery path promised by ADR-0002. Safe to run on a live
 * instance: it only rewrites derived tables, never doc_updates or
 * doc_snapshots.
 *
 * Usage:
 *   node scripts/rematerialize.mjs                       rebuild everything
 *   node scripts/rematerialize.mjs --pending             only stale/failed
 *   node scripts/rematerialize.mjs --workspace <uuid>    one workspace
 *   node scripts/rematerialize.mjs --limit 100           smoke test
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../dist/config.js';
import { createPool, closePool, verifyDatabaseAssumptions } from '../dist/db/pool.js';
import { rebuild } from '../dist/materialize/rebuild.js';

const { values } = parseArgs({
  options: {
    pending: { type: 'boolean', default: false },
    workspace: { type: 'string' },
    limit: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  await verifyDatabaseAssumptions(pool);
  const report = await rebuild(pool, {
    onlyPending: values.pending,
    workspaceId: values.workspace,
    limit: values.limit ? Number(values.limit) : undefined,
    log: values.quiet ? () => {} : console.log,
  });

  if (report.warnings.length > 0) {
    console.log(`\n[rematerialize] ${report.warnings.length} warning(s):`);
    // Group so one systemic problem does not print ten thousand lines.
    const byWarning = new Map();
    for (const { pageId, warning } of report.warnings) {
      const key = warning.replace(/[0-9a-f-]{36}/gi, '<id>');
      if (!byWarning.has(key)) byWarning.set(key, []);
      byWarning.get(key).push(pageId);
    }
    for (const [warning, pages] of byWarning) {
      console.log(`  ${pages.length}x ${warning}`);
      if (pages.length <= 3) console.log(`       ${pages.join(', ')}`);
    }
  }

  if (report.failed.length > 0) {
    console.error(`\n[rematerialize] ${report.failed.length} page(s) failed:`);
    for (const { pageId, error } of report.failed.slice(0, 20)) {
      console.error(`  ${pageId}: ${error}`);
    }
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
} catch (err) {
  console.error('[rematerialize] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePool();
}
