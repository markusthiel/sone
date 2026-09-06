/**
 * Rights, rather than one word standing in for eight questions (ADR-0087).
 *
 * `role === 'owner' || role === 'admin'` was written out in five files for
 * eight different things. It was not a check; it was a guess that the eight
 * belong together — so the only way to let somebody make a group was to let
 * them change everybody's role and rename the workspace as well.
 *
 * These tests say what the named rights do, and — the part that matters more —
 * that they can be held **apart**. A custom role carrying one of them
 * and not the others is what proves the eight questions really came apart,
 * rather than being renamed.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { holdsRight } from '../src/auth/rights.js';
import { loadWorkspaceStanding } from '../src/auth/standing.js';
import { getTestPool, hasDatabase, resetDatabase } from './support/db.js';

describe('rights (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;
  let workspace: string;
  let owner: string;
  let colleague: string;

  before(async () => {
    db = await getTestPool();
    await resetDatabase(db);

    const users = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES
         ($1,'Owner','x'), ($2,'Colleague','x') RETURNING id`,
      [`o-${randomUUID()}@example.org`, `c-${randomUUID()}@example.org`],
    );
    [owner, colleague] = users.rows.map((r) => r.id) as [string, string];

    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('Shared', $1) RETURNING id`,
      [owner],
    );
    workspace = ws.rows[0]!.id;

    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner) VALUES
         ($1,$2,(SELECT id FROM roles WHERE key='owner'),true),
         ($1,$3,(SELECT id FROM roles WHERE key='member'),false)`,
      [workspace, owner, colleague],
    );
  });

  after(async () => {
    await db.query(`DELETE FROM workspaces WHERE id = $1`, [workspace]);
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [[owner, colleague]]);
  });

  test('the system roles carry what the old comparison gave them', async () => {
    // The whole promise of the first two steps: nothing changes. An owner could
    // manage people, groups and settings before, and can now; a member could
    // not, and cannot. `roles.manage` joined them in step three, when there
    // were routes for it to guard.
    const asOwner = await loadWorkspaceStanding(db, owner, workspace);
    assert.deepEqual(
      [...asOwner.rights].sort(),
      ['groups.manage', 'people.manage', 'roles.manage', 'workspace.settings'],
    );

    const asMember = await loadWorkspaceStanding(db, colleague, workspace);
    assert.deepEqual([...asMember.rights], [], 'a member decides nothing about who is here');
    assert.equal(asMember.pageLevel, 'editor', 'and may still write');
  });

  test('a right can be held on its own', async () => {
    /*
     * The point of the change, and the thing the old comparison could not
     * express: somebody who may make groups and may not rename the workspace
     * or add people.
     *
     * If this passed before the change it would have been by accident, because
     * there was nothing to hold — the eight questions had one answer.
     */
    const role = await db.query<{ id: string }>(
      `INSERT INTO roles (workspace_id, name, page_level, rights)
       VALUES ($1, 'Gruppenpflege', 'editor', ARRAY['groups.manage']) RETURNING id`,
      [workspace],
    );
    await db.query(
      `UPDATE workspace_members SET role_id = $3 WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague, role.rows[0]!.id],
    );

    assert.equal(
      (await holdsRight(db, workspace, colleague, 'groups.manage')).held,
      true,
      'may make a group',
    );
    assert.equal(
      (await holdsRight(db, workspace, colleague, 'people.manage')).held,
      false,
      'and may not decide who is in the workspace',
    );
    assert.equal(
      (await holdsRight(db, workspace, colleague, 'workspace.settings')).held,
      false,
      'nor rename it',
    );

    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key='member')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
    await db.query(`DELETE FROM roles WHERE id = $1`, [role.rows[0]!.id]);
  });

  test('a right held through a group counts', async () => {
    // Union over their own role and their groups' (ADR-0087). Never a
    // subtraction: joining must not take anything away (ADR-0026).
    const role = await db.query<{ id: string }>(
      `INSERT INTO roles (workspace_id, name, page_level, rights)
       VALUES ($1, 'Büro', NULL, ARRAY['people.manage']) RETURNING id`,
      [workspace],
    );
    const group = await db.query<{ id: string }>(
      `INSERT INTO groups (workspace_id, name, role_id) VALUES ($1,'Büro',$2) RETURNING id`,
      [workspace, role.rows[0]!.id],
    );
    await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
      group.rows[0]!.id,
      colleague,
    ]);

    const standing = await loadWorkspaceStanding(db, colleague, workspace);
    assert.deepEqual([...standing.rights], ['people.manage']);
    assert.equal(standing.pageLevel, 'editor', 'and the member level is not lowered by it');

    await db.query(`DELETE FROM groups WHERE id = $1`, [group.rows[0]!.id]);
    await db.query(`DELETE FROM roles WHERE id = $1`, [role.rows[0]!.id]);
  });

  test('somebody outside the workspace holds nothing', async () => {
    const outsider = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1,'Outsider','x') RETURNING id`,
      [`x-${randomUUID()}@example.org`],
    );
    const { member, held } = await holdsRight(
      db,
      workspace,
      outsider.rows[0]!.id,
      'people.manage',
    );
    assert.equal(held, false);
    assert.equal(member, false, 'so the refusal can be not-found rather than forbidden');

    await db.query(`DELETE FROM users WHERE id = $1`, [outsider.rows[0]!.id]);
  });

  test('a database that lost the system roles says so', async () => {
    /*
     * The failure this cost an hour to diagnose, twice.
     *
     * Without the four system roles every membership resolves to a member
     * holding no role, which is no access at all: every request answers 403,
     * every page vanishes from every tree, and nothing anywhere explains it.
     * It happened in the server test harness and then again in the client one,
     * because "empty every table" was written in two places and only one of
     * them was fixed.
     *
     * So it is loud now. `ensureSystemRoles` at boot means a running instance
     * cannot reach this, which is exactly why the message has to name the
     * cause: whoever sees it is looking at a database somebody truncated or
     * restored in part.
     */
    /*
     * Simulated by breaking referential integrity, which is what it is
     * (ADR-0102).
     *
     * The membership used to be pointed at nothing — `role_id = NULL` — and
     * that state is now forbidden, because a membership holding no role
     * resolves to no access and reads exactly like being removed. Which leaves
     * one way to reach this: a role row that is gone while a membership still
     * names it. No running instance produces that, and a restore of one dump
     * against another does.
     *
     * The constraint comes off for the length of the assertion rather than the
     * check being deleted: the message is worth an hour to whoever hits it, and
     * `ensureSystemRoles` at boot is why nobody should.
     */
    await db.query(`ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_role_id_fkey`);
    const kept = await db.query<{ id: string; key: string; page_level: string | null }>(
      `DELETE FROM roles WHERE workspace_id IS NULL RETURNING id, key, page_level`,
    );

    await assert.rejects(
      () => loadWorkspaceStanding(db, colleague, workspace),
      /system roles are missing/,
    );

    for (const role of kept.rows) {
      await db.query(
        `INSERT INTO roles (id, workspace_id, key, name, page_level, rights)
         VALUES ($1, NULL, $2, initcap($2), $3, '{}')`,
        [role.id, role.key, role.page_level],
      );
    }
    await db.query(
      `ALTER TABLE workspace_members
         ADD CONSTRAINT workspace_members_role_id_fkey
         FOREIGN KEY (role_id) REFERENCES roles (id)`,
    );
    // And the rights those rows carry, which the seed above left empty.
    await db.query(
      `UPDATE roles
          SET rights = ARRAY['people.manage','groups.manage','workspace.settings','roles.manage']
        WHERE workspace_id IS NULL AND key IN ('owner','admin')`,
    );
  });

  test('a right name the code does not know is dropped', async () => {
    /*
     * A row can outlive the code that understood it: a right removed from the
     * enumeration, or a database restored from an instance running a later
     * version. Carrying the name would put a string in a set that is only ever
     * asked closed questions — harmless today, and exactly how a permission
     * comes to half-work.
     */
    const role = await db.query<{ id: string }>(
      `INSERT INTO roles (workspace_id, name, page_level, rights)
       VALUES ($1, 'Zukunft', 'editor', ARRAY['people.manage','rights.from.the.future'])
       RETURNING id`,
      [workspace],
    );
    await db.query(
      `UPDATE workspace_members SET role_id = $3 WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague, role.rows[0]!.id],
    );

    const standing = await loadWorkspaceStanding(db, colleague, workspace);
    assert.deepEqual([...standing.rights], ['people.manage'], 'the known one, and only it');

    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key='member')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
    await db.query(`DELETE FROM roles WHERE id = $1`, [role.rows[0]!.id]);
  });
});
