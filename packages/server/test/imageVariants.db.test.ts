/**
 * Which file a page gets, and which one a download gives (ADR-0029).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { getTestPool, hasDatabase } from './support/db.js';

describe('image variants (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;
  let workspace: string;

  /** The query the download route runs, with the flag it takes from the URL. */
  const chosen = async (fileId: string, wantsOriginal: boolean): Promise<string | undefined> => {
    const row = await db.query<{ storage_key: string }>(
      // A faithful copy of the source query, page clause included (ADR-0184):
      // only a variant on the same page as its original is chosen, oldest first.
      `SELECT COALESCE(web.storage_key, f.storage_key) AS storage_key
         FROM files f
         LEFT JOIN LATERAL (
           SELECT v.storage_key FROM files v
            WHERE v.variant_of = f.id AND v.variant = 'web'
              AND v.page_id IS NOT DISTINCT FROM f.page_id
            ORDER BY v.created_at, v.id
            LIMIT 1
         ) web ON NOT $2
        WHERE f.id = $1`,
      [fileId, wantsOriginal],
    );
    return row.rows[0]?.storage_key;
  };

  const file = async (
    key: string,
    variantOf: string | null,
    pageId: string | null = null,
  ): Promise<string> => {
    const row = await db.query<{ id: string }>(
      `INSERT INTO files
         (workspace_id, page_id, filename, mime_type, size_bytes, sha256, storage,
          storage_key, variant, variant_of)
       VALUES ($1,$2,'photo.jpg','image/jpeg',1,$3,'local',$4,$5,$6)
       RETURNING id`,
      [workspace, pageId, `${key}-hash`, key, variantOf ? 'web' : 'original', variantOf],
    );
    return row.rows[0]!.id;
  };

  const page = async (id: string): Promise<string> => {
    await db.query(
      `INSERT INTO pages (id, workspace_id, idx) VALUES ($1, $2, 'a0')`,
      [id, workspace],
    );
    return id;
  };

  before(async () => {
    db = await getTestPool();
    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name) VALUES ('Variants') RETURNING id`,
    );
    workspace = ws.rows[0]!.id;
  });

  after(async () => {
    await db.query(`DELETE FROM workspaces WHERE id = $1`, [workspace]);
  });

  test('a page gets the web version, a download can ask for the original', async () => {
    // The block stores the original's id and nothing else, so a page written
    // before variants existed keeps working and a copy of that block carries
    // something that still resolves.
    const original = await file('orig', null);
    await file('web', original);

    assert.equal(await chosen(original, false), 'web', 'the smaller one by default');
    assert.equal(await chosen(original, true), 'orig', 'and the original when asked');
  });

  test('a file with no variant serves itself either way', async () => {
    // Everything uploaded before this existed, and every image too small to
    // need a variant. The join has to miss without changing the answer.
    const only = await file('only', null);
    assert.equal(await chosen(only, false), 'only');
    assert.equal(await chosen(only, true), 'only');
  });

  test('a variant on another page is not chosen (ADR-0184)', async () => {
    // The attack the same-page rule closes: a variant uploaded to page B and
    // pointed at an original on page A used to be served to A's readers. Bound
    // to the same page, an original on A with no variant of its own serves
    // itself, and the intruder variant on B is ignored.
    const a = await page('11111111-1111-1111-1111-111111111111');
    const b = await page('22222222-2222-2222-2222-222222222222');
    const original = await file('orig-on-a', null, a);
    await file('intruder-on-b', original, b);

    assert.equal(
      await chosen(original, false),
      'orig-on-a',
      'a foreign-page variant must not be served',
    );

    // A legitimate variant, on the same page, is served.
    await file('web-on-a', original, a);
    assert.equal(await chosen(original, false), 'web-on-a');
  });

  test('deleting an original takes its variant with it', async () => {
    // A variant without its original is a file nothing can name: not reachable
    // from any block, and not collectable as an orphan either.
    const original = await file('k1', null);
    await file('k2', original);

    await db.query(`DELETE FROM files WHERE id = $1`, [original]);
    const left = await db.query(`SELECT 1 FROM files WHERE storage_key = 'k2'`);
    assert.equal(left.rowCount, 0);
  });
});
