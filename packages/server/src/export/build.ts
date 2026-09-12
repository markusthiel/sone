/**
 * SONE server — building an export archive (ADR-0044).
 *
 * One builder, used by the route that hands back a subtree and by the job that
 * packs a whole workspace. It was inline in the route; the job would have been a
 * second copy, and two archive builders are two answers to "what does an export
 * contain" — including the answer about which pages somebody may see, which is
 * the one place this must not have two of.
 *
 * The visibility condition is the same one the tree and search use. That matters
 * more here than anywhere: a file on a laptop outlives every permission change.
 */

import type { Pool, PoolClient } from 'pg';

import { readCanvas } from '@sone/core';

import { queryRows } from '../db/pool.js';
import { loadDoc } from '../doc/docStore.js';
import type { FileStore } from '../files/store.js';
import { readDocument } from '../materialize/readDocument.js';
import { visiblePagesCondition } from '../pages/access.js';
import { fileNameFor, pageToMarkdown } from './markdown.js';
import { MAX_ARCHIVE_BYTES, zip } from './zip.js';

export class ExportTooLarge extends Error {
  constructor(readonly detail: string) {
    super(`export_too_large: ${detail}`);
    this.name = 'ExportTooLarge';
  }
}

export interface BuildRequest {
  workspaceId: string;
  /** The page everything hangs under, or null for the whole workspace. */
  rootId: string | null;
  /** Whose rights decide what is included. */
  /**
   * Whose export this is.
   *
   * No "and are they an admin" any more: the visibility condition asks that
   * for itself now, so a caller cannot get it wrong (ADR-0087).
   */
  viewer: { userId: string | null };
  withAttachments: boolean;
  /** How many pages one archive may hold. */
  maxPages: number;
  /** Say what is happening, for a job somebody is watching. */
  report?: (progress: string) => Promise<void>;
}

export interface BuiltArchive {
  bytes: Buffer;
  pages: number;
  attachments: number;
}

export async function buildArchive(
  pool: Pool | PoolClient,
  store: FileStore,
  request: BuildRequest,
): Promise<BuiltArchive> {
  const pages = await queryRows<{
    id: string;
    parent_page_id: string | null;
    title: string;
    kind: string;
  }>(
    pool,
    `SELECT p.id, p.parent_page_id, p.title, p.kind
       FROM pages p
      WHERE p.workspace_id = $1
        AND ($2::uuid IS NULL OR p.id = $2 OR $2 = ANY(p.ancestor_ids))
        AND p.archived_at IS NULL
        -- A row of a collection and a structural container are not documents;
        -- their contents belong to the page that holds them.
        AND p.kind NOT IN ('row', 'container')
        AND ${visiblePagesCondition('p', '$3')}
      ORDER BY p.idx, p.id
      LIMIT ${request.maxPages + 1}`,
    [
      request.workspaceId,
      request.rootId,
      request.viewer.userId,
    ],
  );

  if (pages.length > request.maxPages) {
    throw new ExportTooLarge(`more than ${request.maxPages} pages`);
  }

  const byId = new Map(pages.map((page) => [page.id, page]));
  /**
   * Where a page's file goes.
   *
   * Relative to what was asked for: a subtree export's paths start at its root,
   * and a workspace export's start at the top-level folders. So the walk stops
   * at `rootId`, or at a parent that is not in the set — which for a workspace
   * export is every top-level page.
   */
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    let at: string | null = id;
    let guard = 0;
    while (at && guard < 64) {
      const page = byId.get(at);
      if (!page) break;
      parts.unshift(fileNameFor(page.title, page.id));
      if (at === request.rootId) break;
      at = page.parent_page_id;
      guard += 1;
    }
    return parts.join('/');
  };

  const entries: Array<{ name: string; body: Buffer; at: Date }> = [];
  const fileIds = new Set<string>();
  const now = new Date();

  let done = 0;
  for (const page of pages) {
    const loaded = await loadDoc(pool, page.id);
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

      const path = pathOf(page.id);
      // A folder becomes a directory with an index rather than nothing: it has a
      // name, an icon and children, and dropping it would lose the shape
      // somebody organised.
      entries.push({
        name: page.kind === 'folder' ? `${path}/index.md` : `${path}.md`,
        body: Buffer.from(markdown, 'utf8'),
        at: now,
      });

      if (request.withAttachments) {
        for (const block of parsed.blocks) {
          const fileId = block.props['fileId'];
          if (typeof fileId === 'string') fileIds.add(fileId);
        }
        // A canvas's pictures too: they are the page's files, and an archive
        // with the notes and not the drawings would be a strange thing to have.
        for (const item of readCanvas(loaded.doc)) {
          if (item.fileId) fileIds.add(item.fileId);
        }
      }
    } finally {
      loaded.doc.destroy();
    }

    done += 1;
    // Every twenty, not every page: a progress line written per page is one
    // write per page for a number nobody reads that closely.
    if (request.report && done % 20 === 0) {
      await request.report(`${done} of ${pages.length} pages`);
    }
  }

  let attachments = 0;
  if (fileIds.size > 0) {
    const files = await queryRows<{ id: string; storage_key: string; size_bytes: string }>(
      pool,
      // Authorised through the page each file hangs on, exactly as the direct
      // download is (ADR-0184). The old query loaded any file in the workspace
      // whose id appeared in an exported page's blocks — so an editor could put
      // a file id from a page they cannot read into a page they can, and export
      // it out. Now a file counts only if its own page is one this viewer may
      // see, which is the same test `GET /api/files/:id` applies.
      `SELECT f.id, f.storage_key, f.size_bytes
         FROM files f
         JOIN pages p ON p.id = f.page_id
        WHERE f.workspace_id = $1
          AND f.id = ANY($2::uuid[])
          AND ${visiblePagesCondition('p', '$3')}`,
      [request.workspaceId, [...fileIds], request.viewer.userId],
    );

    let bytes = 0;
    for (const file of files) {
      bytes += Number(file.size_bytes);
      // Half the format's ceiling, because the pages and the ZIP's own
      // structure take the rest — and refusing before reading is cheaper than
      // discovering it after loading a gigabyte into memory.
      if (bytes > MAX_ARCHIVE_BYTES / 2) {
        throw new ExportTooLarge('attachments exceed the archive limit');
      }
      try {
        entries.push({
          // By id, matching the links the Markdown writes: two pictures called
          // "screenshot.png" are one file in a flat directory.
          name: `attachments/${file.id}`,
          body: await store.get(file.storage_key),
          at: now,
        });
        attachments += 1;
      } catch {
        // A file the store has lost. The archive is worth more without it than
        // not at all, and a page referencing a missing file already shows that.
      }
    }
  }

  if (request.report) await request.report('packing');

  try {
    return { bytes: zip(entries), pages: pages.length, attachments };
  } catch {
    throw new ExportTooLarge('archive exceeds four gigabytes');
  }
}
