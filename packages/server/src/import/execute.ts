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
function writeBlocks(doc: Y.Doc, markdown: string): void {
  const fragment = doc.getXmlFragment(DOC_KEYS.content);
  const blocks = markdownToBlocks(markdown);

  const elements = blocks.map((block) => {
    const element = new Y.XmlElement(block.type);
    element.setAttribute(BLOCK_ATTRS.id, crypto.randomUUID());
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
        await applyToDocument(pool, created.id, (doc) => writeBlocks(doc, page.markdown), options.actorId);
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
