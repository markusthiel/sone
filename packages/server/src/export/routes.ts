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

import { canRead } from '../auth/claims.js';
import { claimsOrNull, sessionTokenFrom } from '../http/auth.js';
import { queryOne, queryRows } from '../db/pool.js';
import { loadDoc } from '../doc/docStore.js';
import { readCanvas } from '@sone/core';

import { readDocument } from '../materialize/readDocument.js';
import { visiblePagesCondition } from '../pages/access.js';
import type { FileStore } from '../files/store.js';
import type { Router } from '../http/router.js';
import { fileNameFor, pageToMarkdown } from './markdown.js';
import { MAX_ARCHIVE_BYTES, zip } from './zip.js';

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
      restricted: boolean;
    }>(
      deps.pool,
      `SELECT id, workspace_id, ancestor_ids, title, restricted
         FROM pages WHERE id = $1 AND archived_at IS NULL`,
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
      restricted: root.restricted,
    };
    if (!claims || !canRead(claims, location)) {
      // Indistinguishable from the page not existing, like everywhere else.
      ctx.fail(404, 'not_found');
      return;
    }

    /*
     * The subtree, filtered to what this person may read.
     *
     * `ancestor_ids` contains the root for every descendant, so this is a
     * containment test rather than a walk — and the visibility condition is the
     * same one the tree and search use. A restricted page inside an exported
     * folder must not arrive in the archive of somebody who cannot open it,
     * which is the most consequential place this condition is used: a file on
     * a laptop outlives every permission change.
     */
    const pages = await queryRows<{
      id: string;
      parent_page_id: string | null;
      title: string;
      kind: string;
      idx: string;
    }>(
      deps.pool,
      `SELECT p.id, p.parent_page_id, p.title, p.kind, p.idx
         FROM pages p
        WHERE p.workspace_id = $1
          AND (p.id = $2 OR $2 = ANY(p.ancestor_ids))
          AND p.archived_at IS NULL
          AND p.kind NOT IN ('row', 'container')
          AND ${visiblePagesCondition('p', '$4', '$3')}
        ORDER BY p.idx, p.id
        LIMIT ${MAX_PAGES + 1}`,
      [
        root.workspace_id,
        root.id,
        claims.workspaceRole === 'owner' || claims.workspaceRole === 'admin',
        claims.principal.kind === 'anonymous' ? null : claims.principal.userId,
      ],
    );

    if (pages.length > MAX_PAGES) {
      // Named rather than silently truncated, and the answer says what would
      // fix it rather than only that it will not work.
      ctx.fail(413, 'export_too_large');
      return;
    }

    /** Where each page's file goes, mirroring the tree it came from. */
    const paths = new Map<string, string>();
    const byId = new Map(pages.map((page) => [page.id, page]));
    const folderPath = (id: string): string => {
      const parts: string[] = [];
      let at: string | null = id;
      let guard = 0;
      while (at && guard < 64) {
        const page = byId.get(at);
        if (!page) break;
        parts.unshift(fileNameFor(page.title, page.id));
        // Stop at the root of the export: paths are relative to what was asked
        // for, not to the workspace.
        if (at === root.id) break;
        at = page.parent_page_id;
        guard += 1;
      }
      return parts.join('/');
    };

    const entries: Array<{ name: string; body: Buffer; at: Date }> = [];
    const fileIds = new Set<string>();
    const now = new Date();

    for (const page of pages) {
      const loaded = await loadDoc(deps.pool, page.id);
      try {
        const parsed = readDocument(loaded.doc, page.id);
        const markdown = pageToMarkdown(
          parsed.page.title,
          parsed.blocks.map((block) => ({
            id: block.id,
            parentId: block.parentId,
            type: block.type,
            plainText: block.plainText,
            props: block.props,
          })),
        );

        // A folder becomes a directory with an index file rather than nothing:
        // a folder can have a name, an icon and children, and dropping it would
        // lose the shape somebody organised.
        const path = folderPath(page.id);
        const isFolder = page.kind === 'folder';
        entries.push({
          name: isFolder ? `${path}/index.md` : `${path}.md`,
          body: Buffer.from(markdown, 'utf8'),
          at: now,
        });

        if (withAttachments) {
          for (const block of parsed.blocks) {
            const fileId = block.props['fileId'];
            if (typeof fileId === 'string') fileIds.add(fileId);
          }
          // A canvas's pictures too: they are the page's files, uploaded
          // through it and counted against it (ADR-0029), and an export that
          // took the notes and left the drawings would be a strange archive.
          for (const item of readCanvas(loaded.doc)) {
            if (item.fileId) fileIds.add(item.fileId);
          }
        }
      } finally {
        loaded.doc.destroy();
      }
    }

    if (fileIds.size > 0) {
      const files = await queryRows<{
        id: string;
        filename: string;
        storage_key: string;
        size_bytes: string;
      }>(
        deps.pool,
        `SELECT id, filename, storage_key, size_bytes
           FROM files
          WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [root.workspace_id, [...fileIds]],
      );

      let bytes = 0;
      for (const file of files) {
        bytes += Number(file.size_bytes);
        if (bytes > MAX_ARCHIVE_BYTES / 2) {
          ctx.fail(413, 'export_too_large');
          return;
        }
        try {
          entries.push({
            // Named by id and not by filename, matching the links the Markdown
            // writes: two pictures called "screenshot.png" are one file in a
            // flat directory, and the second would overwrite the first.
            name: `attachments/${file.id}`,
            body: await deps.store.get(file.storage_key),
            at: now,
          });
        } catch {
          // A file the store has lost. The archive is worth more without it than
          // not at all, and a page that references a missing file already shows
          // that in the interface.
        }
      }
    }

    let archive: Buffer;
    try {
      archive = zip(entries);
    } catch {
      ctx.fail(413, 'export_too_large');
      return;
    }

    const name = `${fileNameFor(root.title, 'export')}.zip`;
    ctx.res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': String(archive.length),
      // `filename*` as well as `filename`, so a name with an umlaut survives
      // the trip: the plain parameter has no encoding for it.
      'content-disposition': `attachment; filename="export.zip"; filename*=UTF-8''${encodeURIComponent(
        name,
      )}`,
      // An export is a snapshot of a moment; a cached one is a different page.
      'cache-control': 'no-store',
    });
    ctx.res.end(archive);
  });
}
