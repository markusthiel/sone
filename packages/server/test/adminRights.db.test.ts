/**
 * Who may administer workspaces.
 *
 * The first grantable right on this instance, and the first time
 * `is_instance_admin` is not the only question anything asks (ADR-0027).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { administratorRights } from '../src/admin/rights.js';
import { getTestPool, hasDatabase } from './support/db.js';

describe('administration rights (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;
  let plain: string;
  let manager: string;
  let admin: string;

  before(async () => {
    db = await getTestPool();
    const stamp = Date.now();
    const rows = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_instance_admin, can_manage_workspaces)
       VALUES ($1,'Plain','x',false,false),
              ($2,'Manager','x',false,true),
              ($3,'Admin','x',true,false)
       RETURNING id`,
      [`p-${stamp}@example.org`, `m-${stamp}@example.org`, `a-${stamp}@example.org`],
    );
    [plain, manager, admin] = rows.rows.map((r) => r.id) as [string, string, string];
  });

  after(async () => {
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [[plain, manager, admin]]);
  });

  test('an ordinary account administers nothing', async () => {
    const rights = await administratorRights(db, plain);
    assert.equal(rights.instance, false);
    assert.equal(rights.workspaces, false);
  });

  test('the right can be held without being an instance administrator', async () => {
    // The whole point: hand over a job without handing over the instance.
    const rights = await administratorRights(db, manager);
    assert.equal(rights.workspaces, true);
    assert.equal(rights.instance, false, 'and not the rest of it');
  });

  test('an instance administrator holds it implicitly', async () => {
    // Rather than having a row that says so. Two sources for one answer is two
    // answers as soon as one is updated and the other is not.
    const rights = await administratorRights(db, admin);
    assert.equal(rights.instance, true);
    assert.equal(rights.workspaces, true);

    const stored = await db.query<{ can_manage_workspaces: boolean }>(
      `SELECT can_manage_workspaces FROM users WHERE id = $1`,
      [admin],
    );
    assert.equal(stored.rows[0]?.can_manage_workspaces, false, 'implied, not stored');
  });

  test('nobody has it who was not given it', async () => {
    // A right that arrives already granted to people is one nobody decided to
    // grant. The migration deliberately grants it to no one.
    const granted = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users
        WHERE can_manage_workspaces AND NOT is_instance_admin AND id <> $1`,
      [manager],
    );
    assert.equal(granted.rows[0]?.n, 0);
  });

  test('an unknown account administers nothing', async () => {
    // The failure that would matter: a lookup that finds nobody must not decide
    // there is nothing to protect.
    const rights = await administratorRights(db, '00000000-0000-0000-0000-000000000000');
    assert.equal(rights.instance, false);
    assert.equal(rights.workspaces, false);
  });

  test('promoting somebody does not clear the right they were given', async () => {
    // It is stored even for an instance administrator, who holds it implicitly.
    // Clearing it on promotion would silently take it away again on a later
    // demotion — a change nobody made.
    await db.query(
      `UPDATE users SET is_instance_admin = true WHERE id = $1`,
      [manager],
    );
    const promoted = await administratorRights(db, manager);
    assert.equal(promoted.instance, true);

    await db.query(
      `UPDATE users SET is_instance_admin = false WHERE id = $1`,
      [manager],
    );
    const demoted = await administratorRights(db, manager);
    assert.equal(demoted.instance, false);
    assert.equal(demoted.workspaces, true, 'the granted right survived');
  });
});
