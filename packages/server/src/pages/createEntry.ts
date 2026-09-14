/**
 * SONE — creating a tree entry.
 *
 * One implementation, used by the HTTP API and by first-run setup. The logic is
 * small but it has three parts that must happen in order, and getting the order
 * wrong produces a page that exists in the sidebar and cannot be opened:
 *
 *   1. append to the CRDT log — the document is the truth (ADR-0002)
 *   2. materialise it — the projection is derived from that document
 *   3. record who created it
 *
 * Writing only the projection was already done once by mistake, in a test
 * helper, and produced exactly that: a row with no document behind it. Having
 * one function means an importer or a template feature cannot repeat it.
 */

import {
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  SCHEMA_VERSION,
  generateKeyBetween,
  type EntryKind,
} from '@sone/core';
import type { Pool, PoolClient } from 'pg';
import * as Y from 'yjs';

import { appendUpdate } from '../doc/docStore.js';
import { queryRows, withTransaction } from '../db/pool.js';
import { materializeYDoc } from '../materialize/materialize.js';

export interface CreateEntryInput {
  /**
   * The encoded state of a template's document, copied into the new page.
   *
   * Bytes rather than a page id, so this function does no loading and stays a
   * pure "make a page out of this" — the caller has already checked that the
   * template exists, is in this workspace, and may be read by this person.
   */
  fromTemplate?: Uint8Array;
  workspaceId: string;
  kind: EntryKind;
  title: string;
  parentPageId: string | null;
  /** Interactive creation prepends; imports keep their source order. */
  position?: 'first' | 'last';
  /** Null for an entry created by the system rather than by a person. */
  actorId: string | null;
}

export interface CreatedEntry {
  id: string;
  idx: string;
  kind: EntryKind;
  title: string;
  parentPageId: string | null;
}

/**
 * The index that places a new entry before or after its siblings.
 *
 * Sorted by `(idx, id)`: a fractional-index midpoint is deterministic, so two
 * clients inserting concurrently can produce the same key and the id breaks the
 * tie (ADR-0015).
 */
async function nextIndex(
  db: Pool | PoolClient,
  workspaceId: string,
  parentPageId: string | null,
  position: 'first' | 'last',
): Promise<string> {
  const siblings = await queryRows<{ idx: string }>(
    db,
    `SELECT idx FROM pages
      WHERE workspace_id = $1
        AND parent_page_id IS NOT DISTINCT FROM $2
      ORDER BY idx ${position === 'first' ? 'ASC' : 'DESC'}, id ${position === 'first' ? 'ASC' : 'DESC'}
      LIMIT 1`,
    [workspaceId, parentPageId],
  );
  const edge = siblings[0]?.idx ?? null;
  return position === 'first' ? generateKeyBetween(null, edge) : generateKeyBetween(edge, null);
}

export async function createEntry(
  pool: Pool,
  input: CreateEntryInput,
): Promise<CreatedEntry> {
  const idx = await nextIndex(pool, input.workspaceId, input.parentPageId, input.position ?? 'last');
  const id = crypto.randomUUID();
  const title = input.title.trim().slice(0, 512);

  const doc = new Y.Doc();
  try {
    /*
     * From a template, if one was named (ADR-0045).
     *
     * The template's document is copied whole and then its page properties are
     * replaced. Not extracted as text and re-parsed: a round trip through
     * Markdown loses collections, canvases, table widths and block attributes,
     * which are exactly the things somebody built a template for.
     *
     * Applied before the properties below, so those overwrite the template's
     * own title, position and template flag rather than the other way round.
     */
    if (input.fromTemplate) {
      Y.applyUpdate(doc, input.fromTemplate);
    }

    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.createdWith, 'sone-server');

    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, title);
    // A copy is not itself a shape to start from unless somebody says so.
    page.delete(PAGE_KEYS.template);
    // In the document, not only the projection, so a folder is rebuildable
    // from the CRDT log like everything else (ADR-0019).
    page.set(PAGE_KEYS.kind, input.kind);
    page.set(PAGE_KEYS.idx, idx);
    page.set(PAGE_KEYS.parentPageId, input.parentPageId);
    page.set(PAGE_KEYS.collectionId, null);

    const seq = await appendUpdate(
      pool,
      id,
      Y.encodeStateAsUpdate(doc),
      input.actorId,
    );

    await withTransaction(pool, (client) =>
      materializeYDoc(client, id, doc, {
        throughSeq: seq,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
      }),
    );

    // Separate from materialisation: created_by is an instance-level fact, not
    // something the document carries, so the materialiser must not own it.
    await pool.query(`UPDATE pages SET created_by = $2 WHERE id = $1`, [
      id,
      input.actorId,
    ]);
  } finally {
    doc.destroy();
  }

  return {
    id,
    idx,
    kind: input.kind,
    title,
    parentPageId: input.parentPageId,
  };
}

/**
 * The folder a new workspace starts with.
 *
 * A workspace with no folders cannot hold a page at all, because pages live in
 * folders (ADR-0019) — so a fresh instance would present a sidebar with a "new
 * page" button that refuses. One folder makes the empty state usable instead of
 * a puzzle.
 *
 * Named rather than left untitled: "Notes" says what to do with it, and an
 * empty workspace whose only affordance is called "Untitled folder" reads as
 * something that went wrong.
 */
export const DEFAULT_FOLDER_NAME = 'Notes';

export async function createDefaultFolder(
  pool: Pool,
  workspaceId: string,
  actorId: string | null,
): Promise<CreatedEntry> {
  return createEntry(pool, {
    workspaceId,
    kind: 'folder',
    title: DEFAULT_FOLDER_NAME,
    parentPageId: null,
    actorId,
  });
}
