/**
 * SONE — health and version endpoints.
 *
 * Two endpoints with deliberately different contracts, because conflating them
 * is how a rolling deploy takes an instance down:
 *
 *   /api/health   Liveness. Cheap, no database. "The process is running."
 *                 Used by the container healthcheck; must not fail because
 *                 Postgres briefly went away, or Docker restarts a server that
 *                 would have recovered on its own.
 *
 *   /api/ready    Readiness. Checks the database, migrations and rooms.
 *                 "This instance can serve traffic." Used by a load balancer.
 */

import type { Pool } from 'pg';

import { queryOne } from '../db/pool.js';
import type { Router } from './router.js';
import type { SyncServer } from '../sync/server.js';

/**
 * Version reported to operators.
 *
 * Read from the environment because it is baked into the image at build time —
 * the running code has no other way to know which tag produced it. 'dev' when
 * running from a working tree.
 */
export const SONE_VERSION = process.env['SONE_VERSION'] ?? 'dev';
export const SONE_COMMIT = process.env['SONE_COMMIT'] ?? 'unknown';

/**
 * Contract versions.
 *
 * These matter more to compatibility than the application version does, and
 * are surfaced so an operator can see at a glance whether two instances or a
 * client and a server can talk to each other. See ADR-0013.
 */
export interface ContractVersions {
  /** Persisted document layout. Bumped by a document schema change. */
  documentSchema: number;
  /** Sync wire format. Bumped by a protocol change. */
  syncProtocol: number;
  /** Highest applied migration. */
  migration: string | null;
}

export interface ReadinessReport {
  ready: boolean;
  version: string;
  commit: string;
  contracts: ContractVersions;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    migrations: { ok: boolean; applied?: number; latest?: string; error?: string };
    collation: { ok: boolean; value?: string; error?: string };
    rooms: { ok: boolean; total: number; poisoned: number; pageIds?: string[] };
  };
}

export interface HealthDeps {
  pool: Pool;
  sync?: SyncServer;
  documentSchemaVersion: number;
  syncProtocolVersion: number;
}

export function registerHealthRoutes(router: Router, deps: HealthDeps): void {
  router.get('/api/health', (ctx) => {
    // No database call. Liveness must not depend on a dependency.
    ctx.send(200, { status: 'ok', version: SONE_VERSION });
  });

  router.get('/api/ready', async (ctx) => {
    const report = await checkReadiness(deps);
    ctx.send(report.ready ? 200 : 503, report);
  });

  router.get('/api/version', (ctx) => {
    ctx.send(200, {
      version: SONE_VERSION,
      commit: SONE_COMMIT,
      documentSchema: deps.documentSchemaVersion,
      syncProtocol: deps.syncProtocolVersion,
    });
  });
}

export async function checkReadiness(deps: HealthDeps): Promise<ReadinessReport> {
  const report: ReadinessReport = {
    ready: true,
    version: SONE_VERSION,
    commit: SONE_COMMIT,
    contracts: {
      documentSchema: deps.documentSchemaVersion,
      syncProtocol: deps.syncProtocolVersion,
      migration: null,
    },
    checks: {
      database: { ok: false },
      migrations: { ok: false },
      collation: { ok: false },
      rooms: { ok: true, total: 0, poisoned: 0 },
    },
  };

  // --- database ------------------------------------------------------------
  const started = Date.now();
  try {
    await deps.pool.query('SELECT 1');
    report.checks.database = { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    report.checks.database = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    // Nothing else is meaningful without a database.
    report.ready = false;
    return report;
  }

  // --- migrations ----------------------------------------------------------
  try {
    const row = await queryOne<{ n: string; latest: string }>(
      deps.pool,
      `SELECT count(*)::text AS n, max(version) AS latest FROM schema_migrations`,
    );
    report.checks.migrations = {
      ok: true,
      applied: Number(row?.n ?? 0),
      ...(row?.latest ? { latest: row.latest } : {}),
    };
    report.contracts.migration = row?.latest ?? null;
  } catch (err) {
    report.checks.migrations = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    report.ready = false;
  }

  // --- collation -----------------------------------------------------------
  // Checked at startup too, but re-checked here because a restore from a
  // wrongly-created database would otherwise only show up as scrambled
  // document order.
  try {
    const row = await queryOne<{ collate: string }>(
      deps.pool,
      `SELECT datcollate AS collate FROM pg_database WHERE datname = current_database()`,
    );
    const value = row?.collate ?? 'unknown';
    const ok = ['C', 'C.UTF-8', 'C.utf8', 'POSIX'].includes(value);
    report.checks.collation = ok ? { ok, value } : { ok, value, error: 'not byte-wise' };
    if (!ok) report.ready = false;
  } catch (err) {
    report.checks.collation = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    report.ready = false;
  }

  // --- rooms ---------------------------------------------------------------
  if (deps.sync) {
    const poisoned = deps.sync.poisonedRooms;
    report.checks.rooms = {
      // A poisoned room does not make the instance unready — it still serves
      // its document, and taking the whole instance out of rotation over one
      // broken page would be a worse outage than the bug.
      ok: true,
      total: deps.sync.stats.rooms,
      poisoned: poisoned.length,
      ...(poisoned.length > 0 ? { pageIds: poisoned.map((r) => r.pageId) } : {}),
    };
  }

  return report;
}
