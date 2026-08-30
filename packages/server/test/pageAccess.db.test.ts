/**
 * What somebody may do with a page.
 *
 * Against a real tree, because the interesting part is inheritance and a test
 * with one page tests nothing about it (ADR-0026).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import {
  atLeast,
  isPathOnlyCondition,
  morePermissive,
  resolvePageAccess,
  visiblePagesCondition,
} from '../src/pages/access.js';
import { getTestPool, hasDatabase } from './support/db.js';

describe('page access (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;
  let workspace: string;
  let owner: string;
  let member: string;
  let guest: string;
  let root: string;
  let child: string;
  let grandchild: string;

  const ancestryOf = new Map<string, string[]>();

  const page = async (parent: string | null, title: string): Promise<string> => {
    // Ids are assigned by the client here, not the database — a page's id is
    // also its document's id, so it exists before the row does.
    const id = randomUUID();
    const ancestors = parent ? [...ancestryOf.get(parent)!, parent] : [];
    await db.query(
      `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids)
       VALUES ($1,$2,$3,$4,0,'page',$5)`,
      [id, workspace, parent, title, ancestors],
    );
    ancestryOf.set(id, ancestors);
    return id;
  };

  before(async () => {
    db = await getTestPool();
    const stamp = Date.now();

    const users = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES
         ($1,'Owner','x'), ($2,'Member','x'), ($3,'Guest','x')
       RETURNING id`,
      [`o-${stamp}@example.org`, `m-${stamp}@example.org`, `g-${stamp}@example.org`],
    );
    [owner, member, guest] = users.rows.map((r) => r.id) as [string, string, string];

    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('Shared', $1) RETURNING id`,
      [owner],
    );
    workspace = ws.rows[0]!.id;

    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
         ($1,$2,'owner'), ($1,$3,'member'), ($1,$4,'guest')`,
      [workspace, owner, member, guest],
    );

    root = await page(null, 'Root');
    child = await page(root, 'Child');
    grandchild = await page(child, 'Grandchild');
  });

  after(async () => {
    await db.query(`DELETE FROM workspaces WHERE id = $1`, [workspace]);
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [[owner, member, guest]]);
  });

  test('the workspace role is the default', async () => {
    assert.equal((await resolvePageAccess(db, { pageId: child, userId: owner })).access, 'admin');
    assert.equal((await resolvePageAccess(db, { pageId: child, userId: member })).access, 'editor');
  });

  test('a guest gets nothing by role alone', async () => {
    // Being in a workspace as a guest means being shown particular things, not
    // everything.
    assert.equal((await resolvePageAccess(db, { pageId: child, userId: guest })).access, null);
  });

  test('a grant on an ancestor reaches its descendants', async () => {
    // What makes setting rules once on a section work, rather than once per
    // page in it.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [child, guest],
    );

    const onChild = await resolvePageAccess(db, { pageId: child, userId: guest });
    const below = await resolvePageAccess(db, { pageId: grandchild, userId: guest });
    const above = await resolvePageAccess(db, { pageId: root, userId: guest });

    assert.equal(onChild.access, 'viewer');
    assert.equal(below.access, 'viewer', 'inherited downwards');
    assert.equal(above.access, null, 'and not upwards');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [guest]);
  });

  test('the more permissive of two grants wins', async () => {
    // Otherwise granting somebody access on a page could reduce what an
    // ancestor already gave them, which nobody setting the second grant
    // intends.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'admin'), ($3,$2,'viewer')`,
      [root, guest, grandchild],
    );

    const resolved = await resolvePageAccess(db, { pageId: grandchild, userId: guest });
    assert.equal(resolved.access, 'admin');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [guest]);
  });

  test('a grant widens an unrestricted page but never narrows it', async () => {
    // A member has edit by role. Granting them view must not take that away —
    // a rule meant to include somebody would otherwise exclude them.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [child, member],
    );
    assert.equal((await resolvePageAccess(db, { pageId: child, userId: member })).access, 'editor');
    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [member]);
  });

  test('restricting a page removes the member default, and inherits down', async () => {
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);

    assert.equal((await resolvePageAccess(db, { pageId: child, userId: member })).access, null);
    assert.equal(
      (await resolvePageAccess(db, { pageId: grandchild, userId: member })).access,
      null,
      'a page under a restricted section is restricted too',
    );
    assert.equal(
      (await resolvePageAccess(db, { pageId: root, userId: member })).access,
      'editor',
      'and the section above is untouched',
    );

    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  test('a restriction cannot lock out the people who can undo it', async () => {
    // An owner who restricted a page by mistake has to be able to unrestrict
    // it, and a workspace where that is untrue needs database access to repair.
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);
    assert.equal((await resolvePageAccess(db, { pageId: child, userId: owner })).access, 'admin');
    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  test('a named person reaches a restricted page', async () => {
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [child, member],
    );

    const resolved = await resolvePageAccess(db, { pageId: child, userId: member });
    assert.equal(resolved.access, 'viewer');
    assert.equal(resolved.reason, 'granted');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [member]);
    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  test('somebody outside the workspace gets nothing', async () => {
    const stranger = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1,'Stranger','x') RETURNING id`,
      [`s-${Date.now()}@example.org`],
    );
    const resolved = await resolvePageAccess(db, {
      pageId: child,
      userId: stranger.rows[0]!.id,
    });
    assert.equal(resolved.access, null);
    await db.query(`DELETE FROM users WHERE id = $1`, [stranger.rows[0]!.id]);
  });

  test('a missing page is refused rather than allowed', async () => {
    // The failure that matters: a resolver that cannot find a page must not
    // decide there is nothing to protect.
    const resolved = await resolvePageAccess(db, {
      pageId: '00000000-0000-0000-0000-000000000000',
      userId: owner,
    });
    assert.equal(resolved.access, null);
  });

  test('the comparisons are ordered by what they allow', () => {
    assert.equal(atLeast('admin', 'editor'), true);
    assert.equal(atLeast('viewer', 'editor'), false);
    assert.equal(atLeast(null, 'viewer'), false);
    assert.equal(morePermissive('viewer', 'admin'), 'admin');
    assert.equal(morePermissive(null, 'viewer'), 'viewer');
    assert.equal(morePermissive(null, null), null);
  });

  // --- the conditions used by every list of pages ---------------------------

  test('a restricted page is absent from a listing', async () => {
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);

    const rows = await db.query<{ id: string }>(
      `SELECT p.id FROM pages p
        WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2', '$3')}`,
      [workspace, member, false],
    );
    const ids = rows.rows.map((r) => r.id);

    assert.ok(ids.includes(root), 'the section above is untouched');
    assert.ok(!ids.includes(child), 'the restricted page');
    assert.ok(!ids.includes(grandchild), 'and what is under it');

    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  test('a page kept as the path to a granted child is identified', async () => {
    // It has to appear, or the child is reachable only by knowing its address.
    // What it must not do is carry its title, which is what was withheld.
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [grandchild, member],
    );

    const rows = await db.query<{ id: string; path_only: boolean }>(
      `SELECT p.id, NOT ${visiblePagesCondition('p', '$2', '$3')} AS path_only
         FROM pages p
        WHERE p.workspace_id = $1
          AND (${visiblePagesCondition('p', '$2', '$3')}
               OR ${isPathOnlyCondition('p', '$2')})`,
      [workspace, member, false],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.path_only]));

    assert.equal(byId.get(grandchild), false, 'the granted page, in full');
    assert.equal(byId.get(child), true, 'its parent, as a path only');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [member]);
    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  test('an owner sees a restricted page in a listing', async () => {
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);
    const rows = await db.query<{ id: string }>(
      `SELECT p.id FROM pages p
        WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2', '$3')}`,
      [workspace, owner, true],
    );
    assert.ok(rows.rows.some((r) => r.id === child));
    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  test('the condition agrees with resolving one page', async () => {
    // Two answers to one question is how a listing leaks a title the page
    // itself would refuse. This is the check that they stay the same answer.
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [child, guest],
    );

    for (const [person, pageId] of [
      [member, child],
      [guest, child],
      [guest, grandchild],
      [member, root],
    ] as const) {
      const listed = await db.query<{ id: string }>(
        `SELECT p.id FROM pages p
          WHERE p.id = $1 AND ${visiblePagesCondition('p', '$2', '$3')}`,
        [pageId, person, false],
      );
      const resolved = await resolvePageAccess(db, { pageId, userId: person });
      assert.equal(
        listed.rowCount === 1,
        resolved.access !== null,
        `${person} on ${pageId}`,
      );
    }

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [guest]);
    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  // --- every list, not only the tree ----------------------------------------

  test('a favourite does not outlive the access that created it', async () => {
    // The quietest kind of leak: somebody stars a page, is later removed from
    // it, and keeps its title in a sidebar nobody looks at closely for months.
    await db.query(
      `INSERT INTO favourites (user_id, page_id, idx) VALUES ($1,$2,0)`,
      [member, child],
    );
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);

    const rows = await db.query<{ page_id: string }>(
      `SELECT f.page_id
         FROM favourites f
         JOIN pages p ON p.id = f.page_id
        WHERE f.user_id = $1
          AND ${visiblePagesCondition('p', '$1', 'false')}`,
      [member],
    );
    assert.equal(rows.rowCount, 0);

    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
    await db.query(`DELETE FROM favourites WHERE user_id = $1`, [member]);
  });

  test('a restricted page does not occupy a search result', async () => {
    // Filtering after the query would be correct and still wrong: a restricted
    // page would take one of the limited rows, so a search returns fewer
    // results the more is hidden — which is itself a signal about what exists.
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);

    const rows = await db.query<{ id: string }>(
      `SELECT p.id FROM pages p
        WHERE p.workspace_id = $1
          AND ${visiblePagesCondition('p', '$2', 'false')}
        LIMIT 50`,
      [workspace, member],
    );
    assert.ok(!rows.rows.some((r) => r.id === child));

    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
  });

  // --- the rules the routes enforce -----------------------------------------

  test('a grant made on an ancestor is reported as inherited', async () => {
    // A panel that shows an empty list for a page somebody clearly reaches is a
    // panel that makes people set the same rule again, one level down.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [root, guest],
    );

    const rows = await db.query<{ user_id: string; inherited_from: string | null }>(
      `SELECT pp.user_id,
              CASE WHEN pp.page_id = $1 THEN NULL ELSE anc.title END AS inherited_from
         FROM pages target
         JOIN page_permissions pp
           ON pp.page_id = target.id
           OR (pp.include_subtree AND pp.page_id = ANY(target.ancestor_ids))
         LEFT JOIN pages anc ON anc.id = pp.page_id
        WHERE target.id = $1`,
      [grandchild],
    );

    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0]?.inherited_from, 'Root', 'named, so it can be found');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [guest]);
  });

  test('a grant that does not include the subtree stops at its page', async () => {
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree)
       VALUES ($1,$2,'viewer',false)`,
      [child, guest],
    );

    assert.equal((await resolvePageAccess(db, { pageId: child, userId: guest })).access, 'viewer');
    assert.equal(
      (await resolvePageAccess(db, { pageId: grandchild, userId: guest })).access,
      null,
    );

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [guest]);
  });

  test('managing a page is something a grant can give', async () => {
    // So a section can be handed to somebody who then manages access to it
    // without being an administrator of the whole workspace.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'admin')`,
      [child, member],
    );

    const resolved = await resolvePageAccess(db, { pageId: grandchild, userId: member });
    assert.equal(atLeast(resolved.access, 'admin'), true);

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [member]);
  });
});
