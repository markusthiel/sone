/**
 * SONE server — carrying out an import plan (ADR-0044).
 *
 * One page at a time, one transaction each. Not one transaction for the whole
 * import: a partial import that stopped with a clear error and left twelve
 * pages is recoverable, and one giant transaction that rolls back an hour's
 * work on the last file is not.
 *
 * The plan is trusted here — its collisions are named, its depth is bounded, its
 * names are safe — because it was built from a parser that refuses rather than
 * guesses. This module's job is to write, and to report what it wrote.
 */

import crypto from 'node:crypto';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { BLOCK_ATTRS, DOC_KEYS, serialiseProps } from '@sone/core';

import { applyToDocument } from '../doc/docStore.js';
import { detectType, type FileStore } from '../files/store.js';
import { queryOne } from '../db/pool.js';
import { createEntry } from '../pages/createEntry.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { markdownToBlocks } from './markdown.js';
import type { ImportPlan } from './plan.js';

export interface ImportResult {
  /** Page ids, in the order they were created. */
  created: string[];
  /** Pages that were skipped because something of that name was already there. */
  collided: string[];
  /** A page the plan named and this could not write, with the reason. */
  failed: Array<{ path: string; error: string }>;
}

export interface ImportOptions {
  workspaceId: string;
  /**
   * Where an archive's files go, and the bytes to put there.
   *
   * Both or neither: without them a page's pictures arrive as blocks with an
   * `attachmentRef` and nothing behind it, which the editor shows as a picture
   * that failed to load. That is the honest rendering of a half-import, and it
   * is why the plan says whether files are coming.
   */
  store?: FileStore;
  /** The archive's `attachments/<name>` entries, by name. */
  attachments?: Map<string, Buffer>;
  /** The folder everything lands in. The root holds only folders (ADR-0019). */
  parentPageId: string;
  actorId: string | null;
  /**
   * What to do about a name that already exists.
   *
   * `skip` leaves the existing page alone; `duplicate` creates a second page
   * with the same title. There is no `overwrite`, deliberately: an import that
   * can replace a page somebody wrote is an import that can lose work nobody
   * asked it to touch, and "merge" is a decision this has no basis to make.
   */
  onCollision: 'skip' | 'duplicate';
}

/**
 * Build a page's body from parsed blocks.
 *
 * Through core's own attribute names and `serialiseProps`, so a document written
 * here is indistinguishable from one the editor wrote — the alternative is a
 * second opinion about the document format, held by the one module that only
 * ever writes and never reads it back.
 */
function writeBlocks(doc: Y.Doc, markdown: string, files: Map<string, string>): void {
  const fragment = doc.getXmlFragment(DOC_KEYS.content);
  const blocks = markdownToBlocks(markdown);

  const elements = blocks.map((block) => {
    const element = new Y.XmlElement(block.type);
    element.setAttribute(BLOCK_ATTRS.id, crypto.randomUUID());
    /*
     * An archive's file id becomes ours.
     *
     * The reference is replaced rather than kept alongside: two ids on one
     * block would leave the question of which one wins to whatever reads it
     * next. A reference with no uploaded file keeps its `attachmentRef` and no
     * `fileId`, which is a picture the editor draws as missing — true, and
     * better than a `fileId` pointing at nothing.
     */
    if (typeof block.props['attachmentRef'] === 'string') {
      const mapped = files.get(block.props['attachmentRef']);
      if (mapped) {
        delete block.props['attachmentRef'];
        block.props['fileId'] = mapped;
      }
    }

    /*
     * A callout's tone, a quote's source and a divider's shape are schema
     * attributes, not props (ADR-0188, ADR-0189): the editor reads them from the
     * stylesheet from `data-tone`, neither of which looks inside the JSON.
     * Written where they are read, or an imported warning is a grey box.
     */
    for (const key of [
      BLOCK_ATTRS.tone,
      BLOCK_ATTRS.source,
      BLOCK_ATTRS.rule,
      BLOCK_ATTRS.ornament,
      BLOCK_ATTRS.ornamentAt,
    ]) {
      const value = block.props[key];
      if (typeof value === 'string' && value !== '') {
        element.setAttribute(key, value);
        delete block.props[key];
      }
    }

    const props = serialiseProps(block.props);
    if (props) element.setAttribute(BLOCK_ATTRS.props, props);
    if (block.indent > 0) element.setAttribute(BLOCK_ATTRS.indent, String(block.indent));

    if (block.text !== '') {
      const text = new Y.XmlText();
      text.insert(0, block.text);
      element.insert(0, [text]);
    }
    return element;
  });

  // An empty file still becomes a page with one paragraph: a page with no blocks
  // cannot be typed into, which is the state `seedEmptyPage` exists to avoid on
  // the client.
  if (elements.length === 0) {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.setAttribute(BLOCK_ATTRS.id, crypto.randomUUID());
    elements.push(paragraph);
  }

  fragment.delete(0, fragment.length);
  fragment.insert(0, elements);
}

export async function executePlan(
  pool: Pool,
  plan: ImportPlan,
  options: ImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = { created: [], collided: [], failed: [] };
  /** Archive name → our file id, so a picture used twice is stored once. */
  const uploaded = new Map<string, string>();
  /** Which page each planned path became, so children can find their parent. */
  const madeByPath = new Map<string, string>();

  for (const page of plan.pages) {
    const path = page.path.join('/');

    if (page.collidesWith && options.onCollision === 'skip') {
      result.collided.push(path);
      // Mapped anyway, so a page *inside* a folder that already existed lands
      // in that folder rather than being orphaned or creating a second one.
      madeByPath.set(path, page.collidesWith);
      continue;
    }

    const parentPath = page.path.slice(0, -1).join('/');
    const parent = parentPath === '' ? options.parentPageId : madeByPath.get(parentPath);
    if (!parent) {
      // Its folder failed or was skipped without an id. Reported rather than
      // put somewhere plausible: an import that quietly reparents pages is one
      // whose result nobody can check against the archive.
      result.failed.push({ path, error: 'parent_missing' });
      continue;
    }

    try {
      const created = await createEntry(pool, {
        workspaceId: options.workspaceId,
        kind: page.isFolder ? 'folder' : 'page',
        title: page.title,
        parentPageId: parent,
        actorId: options.actorId,
      });

      if (!page.isFolder && page.markdown.trim() !== '') {
        // The files this page refers to, uploaded before its body is written so
        // the blocks can name them. Per page rather than all at once, because a
        // file belongs to the page it hangs on — that is how files are
        // authorised — and the first page that refers to one is the honest
        // answer to which page that is.
        const files = await uploadFor(pool, page.markdown, options, uploaded, created.id);
        await applyToDocument(
          pool,
          created.id,
          (doc) => writeBlocks(doc, page.markdown, files),
          options.actorId,
        );
      }
      await rematerialize(pool, created.id, options.workspaceId, options.actorId);

      madeByPath.set(path, created.id);
      result.created.push(created.id);
    } catch (error) {
      // One page's failure is one line in the result. The import carries on,
      // because twelve pages and a clear list of three that did not arrive is
      // more use than nothing and one error.
      result.failed.push({
        path,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return result;
}

/**
 * Upload the files one page refers to, and say what they became.
 *
 * Returns the mapping for *this* page's references only, but shares the
 * `uploaded` cache across the import: an archive where a logo appears on twenty
 * pages should store one file, not twenty copies of it.
 */
async function uploadFor(
  pool: Pool,
  markdown: string,
  options: ImportOptions,
  uploaded: Map<string, string>,
  pageId: string,
): Promise<Map<string, string>> {
  const { store, attachments } = options;
  const mapping = new Map<string, string>();
  if (!store || !attachments || attachments.size === 0) return mapping;

  for (const [, reference] of markdown.matchAll(/\]\(attachments\/([^)]+)\)/g)) {
    const name = reference ?? '';
    const already = uploaded.get(name);
    if (already) {
      mapping.set(name, already);
      continue;
    }

    const bytes = attachments.get(name);
    // A link to a file the archive does not contain. Left unresolved rather
    // than invented: the block keeps its reference and draws as missing.
    if (!bytes) continue;

    const detected = detectType(bytes);
    // Refused rather than stored as something we cannot describe: the download
    // route serves what the row says, and a wrong type is a file a browser
    // renders wrongly or refuses.
    if (!detected) continue;

    try {
      const stored = await store.put(bytes, detected.extension);
      const row = await queryOne<{ id: string }>(
        pool,
        `INSERT INTO files
           (workspace_id, page_id, filename, mime_type, size_bytes, sha256,
            storage, storage_key, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          options.workspaceId,
          pageId,
          // The archive's name, which for our own exports is a file id and for
          // somebody else's is a real name. Neither is wrong to show.
          name,
          detected.mime,
          stored.sizeBytes,
          stored.sha256,
          store.kind === 's3' ? 's3' : 'local',
          stored.key,
          options.actorId,
        ],
      );
      if (row) {
        uploaded.set(name, row.id);
        mapping.set(name, row.id);
      }
    } catch {
      // One file's failure is one missing picture, not a failed import.
    }
  }

  return mapping;
}
