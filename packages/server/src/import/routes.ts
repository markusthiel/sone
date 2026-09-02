/**
 * SONE server — importing an archive (ADR-0044).
 *
 * Two routes, deliberately, and the split is the feature: one reads an archive
 * and says what importing it *would* do, the other carries out a plan somebody
 * has looked at.
 *
 * One route that did both would be an import nobody previewed — and an import
 * that has created two hundred pages by the time somebody notices it mangled the
 * hierarchy is worse than no import, because undoing it is two hundred deletions
 * into a trash never built for that many arrivals at once.
 *
 * The archive travels twice, once per route. That is a real cost and the right
 * one: the alternative is holding somebody's upload in server memory between two
 * requests, keyed by a token, expiring on a timer — a small cache with an
 * eviction policy, for a saving of one upload.
 */

import type { Pool } from 'pg';

import { canEdit } from '../auth/claims.js';
import { queryOne, queryRows } from '../db/pool.js';
import { readBinary } from '../files/routes.js';
import { claimsOrNull, sessionTokenFrom } from '../http/auth.js';
import type { FileStore } from '../files/store.js';
import type { Router } from '../http/router.js';
import { executePlan } from './execute.js';
import { planImport, type Existing, type ImportPlan } from './plan.js';
import { ArchiveError, unzip } from './unzip.js';

export interface ImportDeps {
  pool: Pool;
  /** Where an archive's files go. */
  store: FileStore;
  /** The same limit uploads use: an archive is an upload by any other name. */
  maxUploadBytes: number;
}

export function registerImportRoutes(router: Router, deps: ImportDeps): void {
  /**
   * May this person put pages into this folder?
   *
   * Edit rights on the destination, which is the page the new ones hang under —
   * not workspace membership. Somebody who may read a folder and not write it
   * must not be able to fill it.
   */
  const destination = async (
    ctx: Parameters<Parameters<typeof router.post>[1]>[0],
    pageId: string,
  ): Promise<{ workspaceId: string; actorId: string | null } | null> => {
    const page = await queryOne<{
      id: string;
      workspace_id: string;
      ancestor_ids: string[];
      kind: string;
      restricted: boolean;
    }>(
      deps.pool,
      `SELECT id, workspace_id, ancestor_ids, kind, restricted
         FROM pages WHERE id = $1 AND archived_at IS NULL`,
      [pageId],
    );
    if (!page) {
      ctx.fail(404, 'not_found');
      return null;
    }
    if (!sessionTokenFrom(ctx)) {
      ctx.fail(401, 'not_authenticated');
      return null;
    }
    const claims = await claimsOrNull(deps.pool, ctx, page.workspace_id);
    const location = {
      id: page.id,
      workspaceId: page.workspace_id,
      ancestorIds: page.ancestor_ids,
      restricted: page.restricted,
    };
    if (!claims) {
      ctx.fail(404, 'not_found');
      return null;
    }
    if (!canEdit(claims, location)) {
      ctx.fail(403, 'not_authorized');
      return null;
    }

    return {
      workspaceId: page.workspace_id,
      actorId: claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
    };
  };

  /** What already exists under the destination, so collisions can be named. */
  const existingUnder = async (
    workspaceId: string,
    parentPageId: string,
  ): Promise<Existing> => {
    const rows = await queryRows<{ id: string; title: string; parent_page_id: string }>(
      deps.pool,
      `SELECT id, title, parent_page_id FROM pages
        WHERE workspace_id = $1
          AND (parent_page_id = $2 OR $2 = ANY(ancestor_ids))
          AND archived_at IS NULL`,
      [workspaceId, parentPageId],
    );

    // Paths relative to the destination, built by walking parents. Only pages
    // under the destination are in `rows`, so a chain that leaves the set is a
    // page whose parent is the destination itself.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byPath = new Map<string, string>();
    for (const row of rows) {
      const parts: string[] = [];
      let at: string | undefined = row.id;
      let guard = 0;
      while (at && at !== parentPageId && guard < 32) {
        const page = byId.get(at);
        if (!page) break;
        parts.unshift(page.title.toLowerCase());
        at = page.parent_page_id;
        guard += 1;
      }
      if (parts.length > 0) byPath.set(parts.join('/'), row.id);
    }
    return { byPath };
  };

  /**
   * The archive, as a plan and as its files.
   *
   * Both from one read, because the entries are already in hand: planning and
   * uploading from two separate unzips of the same bytes would be two chances
   * to disagree about what the archive contained.
   */
  const readArchive = async (
    ctx: Parameters<Parameters<typeof router.post>[1]>[0],
    workspaceId: string,
    parentPageId: string,
  ): Promise<{ plan: ImportPlan; attachments: Map<string, Buffer> } | null> => {
    const body = await readBinary(ctx.req, deps.maxUploadBytes);
    if (body === 'too_large') {
      ctx.fail(413, 'too_large');
      return null;
    }

    try {
      const entries = unzip(body);
      const attachments = new Map<string, Buffer>();
      for (const entry of entries) {
        if (!entry.name.startsWith('attachments/')) continue;
        const name = entry.name.slice('attachments/'.length);
        if (name !== '') attachments.set(name, entry.body);
      }
      return {
        plan: planImport(entries, await existingUnder(workspaceId, parentPageId)),
        attachments,
      };
    } catch (error) {
      if (error instanceof ArchiveError) {
        // The parser's own code, so the interface can say *why* rather than
        // "could not read the file" — "this is not an archive" and "this archive
        // is too large uncompressed" are different problems with different fixes.
        ctx.fail(422, error.code);
        return null;
      }
      throw error;
    }
  };

  /** What importing this archive here would do. Writes nothing. */
  router.post('/api/pages/:pageId/import/plan', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const target = await destination(ctx, pageId);
    if (!target) return;

    const read = await readArchive(ctx, target.workspaceId, pageId);
    if (!read) return;
    const plan = read.plan;

    ctx.send(200, {
      // Without the bodies: a plan is read to be looked at, and the Markdown of
      // two hundred pages is the archive again.
      pages: plan.pages.map((page) => ({
        path: page.path,
        title: page.title,
        isFolder: page.isFolder,
        collides: page.collidesWith !== null,
      })),
      attachments: plan.attachments,
      skipped: plan.skipped,
      totals: plan.totals,
      // They are, now: each one is stored and every link rewritten to the id it
      // became. The flag stays because the interface reads it, and because an
      // archive whose files this instance cannot store — an unrecognisable type
      // — still leaves a picture drawn as missing rather than silently absent.
      attachmentsImported: true,
    });
  });

  /** Carry out the plan for this archive. */
  router.post('/api/pages/:pageId/import', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const target = await destination(ctx, pageId);
    if (!target) return;

    const collision = ctx.url.searchParams.get('collision') === 'duplicate'
      ? 'duplicate'
      : 'skip';

    const read = await readArchive(ctx, target.workspaceId, pageId);
    if (!read) return;

    const result = await executePlan(deps.pool, read.plan, {
      workspaceId: target.workspaceId,
      parentPageId: pageId,
      actorId: target.actorId,
      onCollision: collision,
      store: deps.store,
      attachments: read.attachments,
    });

    // 200 even with failures in it: the pages that arrived did arrive, and a
    // status code cannot say "twelve of fifteen". The list can.
    ctx.send(200, {
      created: result.created.length,
      collided: result.collided,
      failed: result.failed,
    });
  });
}
