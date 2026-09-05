/**
 * SONE server — handing a page's contents back (ADR-0044).
 *
 * A page and everything under it, as Markdown with its attachments beside it, in
 * one archive streamed into the response.
 *
 * Its own module rather than another route in `pages.ts`, because it is the one
 * thing that needs both the database and the file store — and a subtree export
 * is deliberately *not* the workspace export the record describes. That one is a
 * background job with an archive list and a `jobs` table that does not exist
 * yet; this one is the common case, small enough to build in memory, and it
 * proves the two writers before any of that machinery is worth building.
 */

import type { Pool } from 'pg';

import { canRead, restrictedAtSql } from '../auth/claims.js';
import { claimsOrNull, sessionTokenFrom } from '../http/auth.js';
import { queryOne, queryRows } from '../db/pool.js';
import { loadDoc } from '../doc/docStore.js';
import { readCanvas } from '@sone/core';

import { readDocument } from '../materialize/readDocument.js';
import { visiblePagesCondition } from '../pages/access.js';
import type { FileStore } from '../files/store.js';
import type { Router } from '../http/router.js';
import { ExportTooLarge, buildArchive } from './build.js';
import { fileNameFor } from './markdown.js';

export interface ExportDeps {
  pool: Pool;
  store: FileStore;
}

/**
 * How many pages one archive may hold.
 *
 * A bound, because this builds in memory and a subtree can be a whole workspace
 * if somebody exports the folder everything lives in. Refusing with a clear
 * answer is better than a request that takes the process down — and the honest
 * fix for the refusal is the job runner, which the refusal names.
 */
const MAX_PAGES = 200;

export function registerExportRoutes(router: Router, deps: ExportDeps): void {
  /**
   * A page and everything under it.
   *
   * Read rights are enough: this hands back what somebody can already read.
   * `?attachments=false` leaves the files out, which is the difference between
   * an archive somebody can email and one they cannot.
   */
  router.get('/api/pages/:pageId/export', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const withAttachments = ctx.url.searchParams.get('attachments') !== 'false';

    const root = await queryOne<{
      id: string;
      workspace_id: string;
      ancestor_ids: string[];
      title: string;
      restricted_at: string | null;
    }>(
      deps.pool,
      // The *inherited* restriction, not the page's own column. This read
      // `pages.restricted` and therefore said "not restricted" for every page
      // inside a restricted section — which the type change from a boolean to
      // a boundary id is what surfaced (ADR-0026, ADR-0089).
      `SELECT p.id, p.workspace_id, p.ancestor_ids, p.title,
              ${restrictedAtSql('p')} AS restricted_at
         FROM pages p WHERE p.id = $1 AND p.archived_at IS NULL`,
      [pageId],
    );
    if (!root) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return;
    }

    const claims = await claimsOrNull(deps.pool, ctx, root.workspace_id);
    const location = {
      id: root.id,
      workspaceId: root.workspace_id,
      ancestorIds: root.ancestor_ids,
      restrictedAt: root.restricted_at,
    };
    if (!claims || !canRead(claims, location)) {
      // Indistinguishable from the page not existing, like everywhere else.
      ctx.fail(404, 'not_found');
      return;
    }

    /*
     * Built by the shared builder, which is also what the workspace export job
     * uses. It was inline here; a second copy in the job would have been a
     * second answer to which pages somebody may see, and that is the one
     * question this must not have two answers to.
     */
    let archive;
    try {
      archive = await buildArchive(deps.pool, deps.store, {
        workspaceId: root.workspace_id,
        rootId: root.id,
        viewer: {
          userId: claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
        },
        withAttachments,
        maxPages: MAX_PAGES,
      });
    } catch (error) {
      if (error instanceof ExportTooLarge) {
        // Named rather than truncated, and the answer says what would fix it:
        // a whole workspace is a job, not a response.
        ctx.fail(413, 'export_too_large');
        return;
      }
      throw error;
    }

    const name = `${fileNameFor(root.title, 'export')}.zip`;
    ctx.res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': String(archive.bytes.length),
      // `filename*` as well as `filename`, so a name with an umlaut survives
      // the trip: the plain parameter has no encoding for it.
      'content-disposition': `attachment; filename="export.zip"; filename*=UTF-8''${encodeURIComponent(
        name,
      )}`,
      // An export is a snapshot of a moment; a cached one is a different page.
      'cache-control': 'no-store',
    });
    ctx.res.end(archive.bytes);
  });
}
