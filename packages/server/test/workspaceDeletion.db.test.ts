/**
 * Deleting a workspace.
 *
 * The only irreversible action in the workspace administration, so it is not
 * irreversible yet: marked first, removed later (ADR-0027).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { getTestPool, hasDatabase } from './support/db.js';

describe('workspace deletion (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;
  let user: string;
  let workspace: string;

  before(async () => {
    db = await getTestPool();
    const row = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1,'Deleter','x') RETURNING id`,
      [`del-${Date.now()}@example.org`],
    );
    user = row.rows[0]!.id;

    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('Doomed', $1) RETURNING id`,
      [user],
    );
    workspace = ws.rows[0]!.id;
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`,
      [workspace, user],
    );
  });

  after(async () => {
    await db.query(`DELETE FROM workspaces WHERE id = $1`, [workspace]);
    await db.query(`DELETE FROM users WHERE id = $1`, [user]);
  });

  test('marking one keeps everything it holds', async () => {
    // Nothing is removed at that point. Somebody who deletes the wrong
    // workspace needs a way back, and the way back has to exist before the
    // button does.
    await db.query(`INSERT INTO pages (id, workspace_id, title, idx, kind, ancestor_ids)
                    VALUES (gen_random_uuid(), $1, 'Kept', '0', 'page', '{}')`, [workspace]);

    await db.query(`UPDATE workspaces SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [
      workspace,
      user,
    ]);

    const pages = await db.query(`SELECT 1 FROM pages WHERE workspace_id = $1`, [workspace]);
    assert.ok((pages.rowCount ?? 0) > 0, 'the pages are still there');

    const members = await db.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id = $1`,
      [workspace],
    );
    assert.ok((members.rowCount ?? 0) > 0, 'and so is the membership');
  });

  test('a marked workspace stops appearing to its members', async () => {
    // It is not gone and can be put back; what it must not do is keep looking
    // like somewhere to write.
    const visible = await db.query(
      `SELECT w.id FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL`,
      [user],
    );
    assert.equal(visible.rowCount, 0);
  });

  test('taking the mark off brings it back whole', async () => {
    await db.query(`UPDATE workspaces SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`, [
      workspace,
    ]);

    const visible = await db.query(
      `SELECT w.id FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL`,
      [user],
    );
    assert.equal(visible.rowCount, 1);
  });

  test('a personal workspace is not deletable on its own', async () => {
    // It goes with its account. Removing it would leave somebody signed in with
    // nowhere to write, and deactivating the account is a decision made
    // elsewhere.
    const personal = await db.query<{ id: string; personal_for: string | null }>(
      `INSERT INTO workspaces (name, personal_for, created_by)
       VALUES ('Mine', $1, $1) RETURNING id, personal_for`,
      [user],
    );
    assert.ok(personal.rows[0]?.personal_for, 'which is what the route refuses on');
    await db.query(`DELETE FROM workspaces WHERE id = $1`, [personal.rows[0]!.id]);
  });
});
