/**
 * SONE server — asking for a job and fetching what it produced (ADR-0044).
 *
 * Three routes: ask, watch, fetch. The middle one is polled, so it is
 * deliberately cheap — one row, no joins — and reports a sentence rather than a
 * percentage, because a job that does not know how much is left cannot honestly
 * report a fraction.
 */

import type { Pool } from 'pg';

import { WORKSPACE_EXPORT } from '../export/workspaceJob.js';
import { queryOne, queryRows } from '../db/pool.js';
import type { FileStore } from '../files/store.js';
import { claimsOrNull, sessionTokenFrom } from '../http/auth.js';
import type { Router } from '../http/router.js';
import { enqueue } from './runner.js';

export interface JobRouteDeps {
  pool: Pool;
  store: FileStore;
}

export function registerJobRoutes(router: Router, deps: JobRouteDeps): void {
  /**
   * Ask for the whole workspace as an archive.
   *
   * Members only, and not admins only: an export contains what the asker may
   * read, so somebody exporting their own view of a workspace is exporting
   * something they could already open page by page. Refusing it to everybody
   * but an owner would be a rule about *effort*, not about access.
   */
  router.post('/api/workspaces/:workspaceId/export', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, workspaceId);
    if (!claims || claims.principal.kind === 'anonymous' || !claims.workspaceRole) {
      ctx.fail(404, 'not_found');
      return;
    }

    // One at a time per person. A second archive of the same workspace while
    // the first is still packing is work nobody asked for twice, and the button
    // being pressed twice is how it would happen.
    const running = await queryOne<{ id: string }>(
      deps.pool,
      `SELECT id FROM jobs
        WHERE workspace_id = $1 AND created_by = $2 AND kind = $3
          AND state IN ('queued', 'running')
        LIMIT 1`,
      [workspaceId, claims.principal.userId, WORKSPACE_EXPORT],
    );
    if (running) {
      ctx.send(200, { jobId: running.id, alreadyRunning: true });
      return;
    }

    const jobId = await enqueue(deps.pool, {
      workspaceId,
      kind: WORKSPACE_EXPORT,
      payload: { attachments: ctx.url.searchParams.get('attachments') !== 'false' },
      createdBy: claims.principal.userId,
    });

    ctx.send(202, { jobId });
  });

  /** Every job this person has asked for in this workspace, newest first. */
  router.get('/api/workspaces/:workspaceId/jobs', async (ctx) => {
    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = await claimsOrNull(deps.pool, ctx, workspaceId);
    if (!claims || claims.principal.kind === 'anonymous' || !claims.workspaceRole) {
      ctx.fail(404, 'not_found');
      return;
    }

    const rows = await queryRows<{
      id: string;
      kind: string;
      state: string;
      progress: string | null;
      error: string | null;
      result: { bytes?: number; pages?: number } | null;
      created_at: Date;
      expires_at: Date | null;
    }>(
      deps.pool,
      `SELECT id, kind, state, progress, error, result, created_at, expires_at
         FROM jobs
        WHERE workspace_id = $1 AND created_by = $2
        ORDER BY created_at DESC
        LIMIT 20`,
      [workspaceId, claims.principal.userId],
    );

    ctx.send(200, {
      jobs: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        state: row.state,
        progress: row.progress,
        error: row.error,
        // Only what the interface shows. The storage key is not somebody's
        // business even when it is their own export: the download route is how
        // a result is reached, so the key never has to leave the server.
        bytes: row.result?.bytes ?? null,
        pages: row.result?.pages ?? null,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      })),
    });
  });

  /**
   * Fetch what a job produced.
   *
   * The asker only, not everybody who may read the workspace: an archive is a
   * snapshot of what *one* person could see when it ran, and handing it to a
   * colleague with narrower access would be a disclosure the permission system
   * has no way to catch.
   */
  router.get('/api/jobs/:jobId/download', async (ctx) => {
    const jobId = ctx.params['jobId'] ?? '';
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }

    const job = await queryOne<{
      workspace_id: string;
      created_by: string | null;
      state: string;
      result: { key?: string; bytes?: number } | null;
      expires_at: Date | null;
    }>(
      deps.pool,
      `SELECT workspace_id, created_by, state, result, expires_at FROM jobs WHERE id = $1`,
      [jobId],
    );
    if (!job) {
      ctx.fail(404, 'not_found');
      return;
    }

    const claims = await claimsOrNull(deps.pool, ctx, job.workspace_id);
    if (
      !claims ||
      claims.principal.kind === 'anonymous' ||
      claims.principal.userId !== job.created_by
    ) {
      ctx.fail(404, 'not_found');
      return;
    }

    if (job.state !== 'done' || !job.result?.key) {
      // Not an error: a job somebody is watching is often not finished yet, and
      // 409 says "ask again" where 404 would say "you were wrong to ask".
      ctx.fail(409, 'not_ready');
      return;
    }
    if (job.expires_at && job.expires_at.getTime() < Date.now()) {
      ctx.fail(410, 'expired');
      return;
    }

    let bytes: Buffer;
    try {
      bytes = await deps.store.get(job.result.key);
    } catch {
      // The row says there is a file and the store disagrees — which happens
      // after an expiry sweep that removed the file and could not remove the
      // row. Gone is the truthful answer.
      ctx.fail(410, 'expired');
      return;
    }

    ctx.res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': String(bytes.length),
      'content-disposition': `attachment; filename="workspace-export.zip"`,
      'cache-control': 'no-store',
    });
    ctx.res.end(bytes);
  });
}
