/**
 * SONE — server entrypoint.
 *
 * Startup order matters and is deliberate:
 *
 *   1. Configuration, validated eagerly. A server that starts and then fails
 *      on the first upload because a variable was missing is worse than one
 *      that refuses to start.
 *   2. Database assumptions. The collation check in particular: with a
 *      locale-aware collation, fractional index ordering silently scrambles
 *      documents, and refusing to start is the only safe response.
 *   3. Migrations must already be applied — the entrypoint runs them before
 *      this process. Verified rather than assumed.
 *   4. Sync server, then HTTP, then maintenance.
 *
 * Shutdown order is the reverse, and the flush is the part that matters:
 * rooms hold up to PERSIST_MAX_DELAY_MS of unpersisted edits, so exiting
 * without awaiting it is user-visible data loss during a routine restart.
 */

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION } from '@sone/core';

import { loadConfig, type Config } from './config.js';
import { closePool, createPool, verifyDatabaseAssumptions } from './db/pool.js';
import {
  VersionFenceError,
  checkAndRecordVersion,
  pendingDocumentMigrations,
} from './db/version.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerHealthRoutes, SONE_COMMIT, SONE_VERSION } from './http/health.js';
import { registerPageRoutes } from './http/pages.js';
import { serveRefusal } from './http/refusal.js';
import { Router } from './http/router.js';
import { registerWorkspaceRoutes } from './http/workspaces.js';
import { registerFavouriteRoutes } from './http/favourites.js';
import { registerShareRoutes } from './http/share.js';
import { registerCollectionRoutes } from './http/collections.js';
import { registerAdminRoutes } from './admin/routes.js';
import { SettingsStore } from './admin/settings.js';
import { registerFileRoutes } from './files/routes.js';
import { LocalFileStore } from './files/store.js';
import { createStaticHandler } from './http/static.js';
import { Maintenance } from './maintenance/job.js';
import { PROTOCOL_VERSION } from './sync/protocol.js';
import { SyncServer } from './sync/server.js';
import { queryRows } from './db/pool.js';

/** Time allowed for a graceful shutdown before the process is forced down. */
const SHUTDOWN_GRACE_MS = 20_000;

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    // Configuration errors are the most common first-run problem, so they get
    // the plainest possible message and no stack trace.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(78); // EX_CONFIG
  }

  console.log(`SONE ${SONE_VERSION} starting`);
  console.log(
    `document schema v${SCHEMA_VERSION}, sync protocol v${PROTOCOL_VERSION}`,
  );

  const pool = createPool(config.databaseUrl);

  try {
    await verifyDatabaseAssumptions(pool);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    await closePool();
    process.exit(78);
  }

  // The entrypoint applies migrations before starting this process. If the
  // table is missing, something ran the server directly without migrating,
  // and continuing would produce confusing errors on every request instead of
  // one clear one here.
  try {
    const rows = await queryRows<{ latest: string }>(
      pool,
      `SELECT max(version) AS latest FROM schema_migrations`,
    );
    const latest = rows[0]?.latest;
    if (!latest) throw new Error('no migrations applied');
    console.log(`database at migration ${latest}`);
  } catch (err) {
    console.error(
      'database is not migrated. Run: node packages/server/scripts/migrate.mjs',
    );
    console.error(err instanceof Error ? err.message : String(err));
    await closePool();
    process.exit(78);
  }

  // --- version fence -------------------------------------------------------
  // Refuses a downgrade or an invalid version skip before serving anything.
  // Allowing either would write old-format data into a new-format database,
  // from which the only recovery is a backup restore.
  try {
    const fence = await checkAndRecordVersion(pool, SONE_VERSION, SCHEMA_VERSION, {
      allowDowngrade: config.allowDowngrade,
    });
    if (fence.isFirstStart) {
      console.log('first start against this database');
    } else if (fence.isUpgrade) {
      console.log(
        `upgraded from ${fence.previous!.appVersion} to ${SONE_VERSION}` +
          (fence.isMajorUpgrade ? ' (major)' : ''),
      );
    }

    const pending = await pendingDocumentMigrations(pool, SCHEMA_VERSION);
    if (pending.length > 0) {
      const total = pending.reduce((sum, p) => sum + p.pages, 0);
      console.log(
        `${total} document(s) still at an older schema version; ` +
          `they migrate automatically when opened`,
      );
    }
  } catch (err) {
    if (err instanceof VersionFenceError) {
      console.error(err.message);

      // Serve the reason rather than exiting.
      //
      // Exiting left nothing answering on the port, so the symptom was a blank
      // page and a container that restart-looped, writing this same paragraph
      // to a log nobody was watching. The explanation was accurate and in the
      // one place the person affected was not looking.
      //
      // The database connection is closed first: this mode does no queries, and
      // holding a pool open against a database this build has decided it must
      // not touch would be the wrong shape of caution.
      const previousVersion = err.previousVersion;
      await closePool();

      serveRefusal(config.port, {
        message: err.message,
        code: err.code,
        runningVersion: SONE_VERSION,
        previousVersion,
      });

      console.error(
        `[fence] serving the reason on port ${config.port}. ` +
          'Nothing else is running: no editing, no sync, no writes.',
      );
      return;
    }
    throw err;
  }

  const http = createServer();

  const sync = new SyncServer({
    pool,
    databaseUrl: config.databaseUrl,
    server: http,
    path: '/sync',
  });
  await sync.start();

  const router = new Router();
  registerHealthRoutes(router, {
    pool,
    sync,
    documentSchemaVersion: SCHEMA_VERSION,
    syncProtocolVersion: PROTOCOL_VERSION,
  });
  // Constructed before every route that reads it, for the reason the
  // Maintenance object is: a closure that captures a const declared later works
  // only until somebody changes the ordering, and this project has already lost
  // an afternoon to exactly that.
  const fileStore = new LocalFileStore(
    config.storage.backend === 'local' ? config.storage.path : '/var/lib/sone/files',
  );

  // Checked once, loudly, at startup.
  //
  // Not fatal: an instance with an unwritable upload directory is still a
  // working notes app for everything except images, and refusing to start would
  // turn a broken volume mount into total downtime. But it must be said now
  // rather than discovered as a 500 on somebody's first photo — and it is also
  // reported in Settings → Maintenance, because a container log is not where
  // anybody looks when an upload fails.
  const storageProblem = await fileStore.checkWritable();
  if (storageProblem) {
    console.error(
      `[storage] ${storageProblem}\n` +
        '[storage] Image uploads will fail until this is fixed. The usual cause ' +
        'is a volume created before this directory existed in the image, so it ' +
        'is owned by root rather than by uid 10001. See docs/deployment.md.',
    );
  }

  // Settings resolve from the database over the environment, so the few values
  // an administrator changes take effect without a redeploy. Created before the
  // routes that read it.
  const settings = new SettingsStore(pool, {
    signupMode: config.signupMode,
    instanceName: 'SONE',
    allowWorkspaceCreation: true,
    defaultLocale: 'en',
  });

  registerAuthRoutes(router, {
    pool,
    // Read per request, not captured at startup: an administrator who changes
    // this in the interface expects the next registration attempt to obey it.
    signupMode: () => settings.get('signupMode'),
    // Secure cookies only over https, or the browser drops them on a plain
    // http development instance and login silently fails.
    secureCookies: config.publicUrl.startsWith('https://'),
  });
  registerPageRoutes(router, { pool });
  registerWorkspaceRoutes(router, { pool });
  registerFavouriteRoutes(router, { pool });
  registerShareRoutes(router, { pool, publicUrl: config.publicUrl });
  registerCollectionRoutes(router, { pool });

  // Constructed before the routes that reference it, not after.
  //
  // The admin route captures `maintenance` in a closure that only runs when a
  // request arrives, so declaring it later would work — until it did not. This
  // project has already lost an afternoon to a const referenced before its
  // assignment (the editor view in dispatchTransaction), and "it happens to be
  // assigned by the time anyone calls it" is the same argument that was wrong
  // then.
  const maintenance = new Maintenance({ pool, sync });

  registerAdminRoutes(router, {
    pool,
    settings,
    version: SONE_VERSION,
    commit: SONE_COMMIT,
    checkStorage: () => fileStore.checkWritable(),
    // The same job the timer runs, so the button and the schedule cannot drift.
    runMaintenance: () =>
      maintenance.runOnce() as unknown as Promise<Record<string, unknown>>,
  });
  registerFileRoutes(router, {
    pool,
    // Only the local backend exists so far. The interface is in place so an S3
    // one can be added without anything above it changing.
    store: fileStore,
    maxUploadBytes: config.maxUploadBytes,
  });

  // The built client is served by this process, so a deployment is one
  // container plus Postgres rather than app plus a separate nginx.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticHandler = await createStaticHandler({
    root: path.resolve(here, '../../web/dist'),
  });

  http.on('request', (req, res) => {
    void (async () => {
      try {
        if (await router.handle(req, res, config.publicUrl)) return;
        if (await staticHandler(req, res)) return;
        if (!res.headersSent) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
        }
      } catch (err) {
        console.error('[http] unhandled request error', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
      }
    })();
  });

  // Started only once the server is otherwise wired: a pass that runs while
  // routes are still being registered would compete with startup for the pool.
  maintenance.start();

  await new Promise<void>((resolve) => {
    http.listen(config.port, resolve);
  });
  console.log(`listening on port ${config.port}`);
  console.log(`public URL ${config.publicUrl}`);
  if (config.signupMode !== 'invite') {
    console.log(`signup mode: ${config.signupMode}`);
  }

  // --- shutdown ------------------------------------------------------------

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      // A second signal means the operator is impatient. Honour it.
      console.warn(`${signal} received again, exiting immediately`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);

    // Force exit if the graceful path hangs. Without this a stuck flush turns
    // a restart into an outage requiring SIGKILL.
    const forceTimer = setTimeout(() => {
      console.error(`shutdown exceeded ${SHUTDOWN_GRACE_MS} ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceTimer.unref();

    maintenance.stop();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    // Flushes every room. This is the call that must not be skipped.
    await sync.shutdown();
    await closePool();

    clearTimeout(forceTimer);
    console.log('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // An unhandled rejection has already escaped every guard in the code. Log it
  // and keep running: crashing would drop every live connection and lose the
  // unflushed tail of every open document, which is worse than one broken
  // request.
  process.on('unhandledRejection', (reason) => {
    console.error('unhandled rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('uncaught exception', err);
    void shutdown('uncaughtException');
  });
}

void main().catch((err) => {
  console.error('failed to start', err);
  process.exit(1);
});
