/**
 * SONE — removing the documents belonging to pages (ADR-0080).
 *
 * `doc_updates.doc_id` and `doc_snapshots.doc_id` carry **no foreign key** to
 * `pages`. That is deliberate: a CRDT update can arrive before the row it
 * belongs to, and a constraint would reject data that is merely early
 * (migration 0003). The consequence is that deleting a page removes the entry
 * and leaves its entire content behind — rows nothing references, invisible to
 * every view, unreclaimable, and still growing the database.
 *
 * That was found once, by a test asserting the updates were gone when they were
 * not, and fixed in the page-delete route. It was then true in two more places
 * nobody had looked at (ADR-0080):
 *
 *   - **Purging a deleted workspace** cascaded to `pages` and stopped there, so
 *     every byte of every page in it stayed in the database forever. The
 *     function's own comment said "everything else follows by cascade", and the
 *     deployment guide promised the data was "gone in the way 'deleted' is
 *     normally understood, which matters when somebody asks whether their notes
 *     are still on this server". Neither was true.
 *
 *   - **A page's internal comments document** (ADR-0057) has an id derived from
 *     the page's, not equal to it, so deleting by page id never touched it —
 *     including in the route that had already been fixed. Internal comments are
 *     the ones written where the page's readers cannot see them, which makes
 *     this the copy of a deletion most worth actually performing.
 *
 * So the knowledge lives in one function that both callers use, and neither can
 * take half of it.
 */

import { createHash } from 'node:crypto';

import { internalDocId } from '@sone/core';
import type { PoolClient } from 'pg';

const sha1 = (data: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha1').update(data).digest());

/**
 * Every document id belonging to a page: its own, and its internal comments.
 *
 * Exported because a test that checks a deletion has to be able to name what
 * should be gone, and re-deriving the internal id in the test would be a second
 * implementation of the rule the code under test uses.
 */
export function documentIdsFor(pageIds: readonly string[]): string[] {
  return pageIds.flatMap((pageId) => [pageId, internalDocId(pageId, sha1)]);
}

/**
 * Delete the CRDT rows for these pages. Returns how many updates went.
 *
 * Takes a client rather than a pool: this is never the whole of what a caller
 * is doing, and a page row removed in a transaction whose documents were
 * removed outside it is the same bug in a smaller window.
 */
export async function deleteDocumentsFor(
  client: PoolClient,
  pageIds: readonly string[],
): Promise<number> {
  if (pageIds.length === 0) return 0;
  const docIds = documentIdsFor(pageIds);

  const updates = await client.query(`DELETE FROM doc_updates WHERE doc_id = ANY($1::uuid[])`, [
    docIds,
  ]);
  await client.query(`DELETE FROM doc_snapshots WHERE doc_id = ANY($1::uuid[])`, [docIds]);
  return updates.rowCount ?? 0;
}
