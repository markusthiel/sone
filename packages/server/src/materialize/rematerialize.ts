/**
 * SONE — re-project one page from its stored document.
 *
 * Loads the document, materialises it, and disposes of it.
 *
 * This lived privately inside the pages routes until a second caller needed it:
 * the maintenance job, retrying a projection that failed. A helper used by two
 * unrelated parts of the system belongs beside the thing it wraps rather than
 * inside one of its callers.
 */

import type { Pool } from 'pg';

import { withTransaction } from '../db/pool.js';
import { loadDoc } from '../doc/docStore.js';
import { materializeYDoc } from './materialize.js';

export async function rematerialize(
  pool: Pool,
  pageId: string,
  workspaceId: string,
  actorId: string | null = null,
): Promise<void> {
  const loaded = await loadDoc(pool, pageId);
  try {
    await withTransaction(pool, (client) =>
      materializeYDoc(client, pageId, loaded.doc, {
        throughSeq: loaded.throughSeq,
        workspaceId,
        actorId,
      }),
    );
  } finally {
    // Destroyed in a finally, or a document that fails to materialise leaks its
    // Yjs structures — and the retry path exists precisely to run on documents
    // that fail.
    loaded.doc.destroy();
  }
}
