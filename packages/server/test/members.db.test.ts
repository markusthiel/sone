/**
 * Changing who is in a workspace, and what they may do.
 *
 * There was no way to do either until now: a role was decided when somebody
 * joined and never afterwards.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { getTestPool, hasDatabase } from './support/db.js';

describe('workspace membership (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;
  let workspace: string;
  let owner: string;
  let member: string;

  before(async () => {
    db = await getTestPool();
    const stamp = Date.now();
    const users = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1,'Owner','x'), ($2,'Member','x') RETURNING id`,
      [`mo-${stamp}@example.org`, `mm-${stamp}@example.org`],
    );
    [owner, member] = users.rows.map((r) => r.id) as [string, string];

    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('Team', $1) RETURNING id`,
      [owner],
    );
    workspace = ws.rows[0]!.id;
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
       VALUES ($1,$2,(SELECT id FROM roles WHERE key = 'owner' AND workspace_id IS NULL),true),
              ($1,$3,(SELECT id FROM roles WHERE key = 'member' AND workspace_id IS NULL),false)`,
      [workspace, owner, member],
    );
  });

  after(async () => {
    await db.query(`DELETE FROM workspaces WHERE id = $1`, [workspace]);
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [[owner, member]]);
  });

  test('a workspace always keeps an owner', async () => {
    // Demoting the last one leaves a workspace nobody can transfer or delete,
    // and the person who did it is usually the person who cannot undo it.
    // Counted over `is_owner`, the column, exactly as the route counts it:
    // ownership is not a role and does not travel with one (ADR-0087), and the
    // enum word it used to count is gone (ADR-0102).
    const others = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM workspace_members
        WHERE workspace_id = $1 AND is_owner AND user_id <> $2`,
      [workspace, owner],
    );
    assert.equal(others.rows[0]?.n, 0, 'so this demotion must be refused');
  });

  test('removing somebody takes their page grants with them', async () => {
    // Left behind, a grant gives access to somebody who is no longer here — and
    // reinstates it silently if they ever rejoin.
    const page = await db.query<{ id: string }>(
      `INSERT INTO pages (id, workspace_id, title, idx, kind, ancestor_ids)
       VALUES (gen_random_uuid(), $1, 'Page', '0', 'page', '{}') RETURNING id`,
      [workspace],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [page.rows[0]!.id, member],
    );

    await db.query(`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, [
      workspace,
      member,
    ]);
    await db.query(
      `DELETE FROM page_permissions pp USING pages p
        WHERE pp.page_id = p.id AND p.workspace_id = $1 AND pp.user_id = $2`,
      [workspace, member],
    );

    const left = await db.query(`SELECT 1 FROM page_permissions WHERE user_id = $1`, [member]);
    assert.equal(left.rowCount, 0);

    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
       VALUES ($1,$2,(SELECT id FROM roles WHERE key = 'member' AND workspace_id IS NULL), false)`,
      [workspace, member],
    );
  });

  test('somebody cannot be removed from their own workspace', async () => {
    // It exists because they do (ADR-0025), and one with no members is a
    // document store nobody can open.
    const personal = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, personal_for, created_by)
       VALUES ('Mine', $1, $1) RETURNING id`,
      [member],
    );
    const found = await db.query(
      `SELECT 1 FROM workspaces WHERE id = $1 AND personal_for = $2`,
      [personal.rows[0]!.id, member],
    );
    assert.equal(found.rowCount, 1, 'which is what the route checks for');

    await db.query(`DELETE FROM workspaces WHERE id = $1`, [personal.rows[0]!.id]);
  });
});
