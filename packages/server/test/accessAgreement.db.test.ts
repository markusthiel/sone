/**
 * The two resolvers must give the same answer (ADR-0086).
 *
 * SONE answers "may this person reach this page" in two places:
 *
 *   - `resolvePageAccess` in pages/access.ts, for the tree, search, favourites
 *     and every listing;
 *   - `effectiveRole` over the claims `resolveSessionClaims` builds, for
 *     **sync** — opening and writing the document — and for page reads and
 *     writes, files, collections, import.
 *
 * They disagreed. `resolvePageAccess` read `page_group_permissions` from the
 * day groups existed; `resolveSessionClaims` loaded only `page_permissions`. A
 * page granted to a group appeared in the tree and refused to open.
 *
 * It stayed invisible for two reasons worth keeping in mind here:
 *
 *   1. The end-to-end test written to prove group rights worked
 *      (`workspaceAccess.db.test.ts`) went through routes that use the first
 *      resolver, so it was green and proved nothing about the second.
 *   2. Every existing test of `effectiveRole` hands it a literal `grants: []`
 *      array. The pure function was well covered; the query that fills its
 *      argument was covered nowhere.
 *
 * So this file tests neither resolver on its own. It builds real rows, asks
 * both, and asserts they agree — which is the only property that actually has
 * to hold, and the one that no test of either half could see.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { resolvePageAccess, type PageAccess } from '../src/pages/access.js';
import {
  effectiveRole,
  loadPageLocation,
  resolveSessionClaims,
  revalidateClaims,
  roleIn,
} from '../src/auth/claims.js';
import { loadWorkspaceStanding } from '../src/auth/standing.js';
import { createSession } from '../src/auth/session.js';
import { getTestPool, hasDatabase } from './support/db.js';

describe('the two access resolvers agree (database)', { concurrency: 1, skip: !hasDatabase }, () => {
  let db: Awaited<ReturnType<typeof getTestPool>>;
  let workspace: string;
  let owner: string;
  let colleague: string;
  let outsider: string;
  let team: string;
  let root: string;
  let section: string;
  let below: string;

  /** The colleague's live session, so claims are resolved the way sync does. */
  let sessionToken: string;
  let sessionId: string;
  /** And the owner's, for the one case that is about not being capped. */
  let ownerToken: string;

  const ancestryOf = new Map<string, string[]>();

  const page = async (parent: string | null, title: string): Promise<string> => {
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

  /**
   * Both answers for one page, in one shape.
   *
   * `PageAccess` and `Role` are the same four words in two type aliases, which
   * is itself part of how the two paths drifted — see the ADR.
   */
  const bothFor = async (
    userId: string,
    pageId: string,
  ): Promise<{ listing: PageAccess | null; document: PageAccess | null }> => {
    const listing = (await resolvePageAccess(db, { pageId, userId })).access;

    const claims = await resolveSessionClaims(db, sessionToken, workspace);
    const location = await loadPageLocation(db, pageId);
    assert.ok(location, 'the page exists');
    const document = claims ? (effectiveRole(claims, location) as PageAccess | null) : null;

    return { listing, document };
  };

  const agree = async (pageId: string, expected: PageAccess | null, what: string): Promise<void> => {
    const { listing, document } = await bothFor(colleague, pageId);
    assert.equal(listing, expected, `${what}: the tree says ${String(listing)}`);
    assert.equal(
      document,
      expected,
      `${what}: the tree says ${String(listing)} and sync says ${String(document)}`,
    );
  };

  before(async () => {
    db = await getTestPool();
    const stamp = Date.now();

    const users = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES
         ($1,'Owner','x'), ($2,'Colleague','x'), ($3,'Outsider','x')
       RETURNING id`,
      [`o-${stamp}@example.org`, `c-${stamp}@example.org`, `x-${stamp}@example.org`],
    );
    [owner, colleague, outsider] = users.rows.map((r) => r.id) as [string, string, string];

    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('Shared', $1) RETURNING id`,
      [owner],
    );
    workspace = ws.rows[0]!.id;

    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
         ($1,$2,'owner'), ($1,$3,'guest')`,
      [workspace, owner, colleague],
    );

    // A guest, deliberately: a member reaches everything by role, so a missing
    // grant would be invisible. Everything the colleague can do below comes
    // from an explicit grant, which is exactly the case that broke.
    root = await page(null, 'Root');
    section = await page(root, 'Section');
    below = await page(section, 'Below');

    const group = await db.query<{ id: string }>(
      `INSERT INTO groups (workspace_id, name, created_by) VALUES ($1,'Team',$2) RETURNING id`,
      [workspace, owner],
    );
    team = group.rows[0]!.id;
    await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
      team,
      colleague,
    ]);

    const session = await createSession(db, colleague);
    sessionToken = session.token;
    sessionId = session.sessionId;
    ownerToken = (await createSession(db, owner)).token;
  });

  after(async () => {
    await db.query(`DELETE FROM workspaces WHERE id = $1`, [workspace]);
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [[owner, colleague, outsider]]);
  });

  test('with no grant at all, both refuse', async () => {
    await agree(section, null, 'a guest with nothing');
  });

  test('a grant to the person is seen by both', async () => {
    // The half that always worked. Here so that the group test below is a
    // comparison rather than a lone assertion.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'editor')`,
      [section, colleague],
    );

    await agree(section, 'editor', 'granted to the person');
    await agree(below, 'editor', 'and inherited downwards');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [colleague]);
  });

  test('a grant to a group is seen by both', async () => {
    /*
     * The bug. Before the fix the first assertion passed and the second
     * returned null: the page was listed in the tree and its document was
     * refused, so a page granted to a group looked broken rather than
     * forbidden.
     */
    await db.query(
      `INSERT INTO page_group_permissions (page_id, group_id, role) VALUES ($1,$2,'editor')`,
      [section, team],
    );

    await agree(section, 'editor', 'granted to a group');
    await agree(below, 'editor', 'and inherited downwards');
    await agree(root, null, 'and not upwards');

    await db.query(`DELETE FROM page_group_permissions WHERE group_id = $1`, [team]);
  });

  test('a group grant on a restricted section reaches it', async () => {
    // Restriction is where a grant is the only way in, so it is where the two
    // resolvers disagreeing hurts most: the tree shows the page and sync
    // refuses it, with no way for the reader to tell why.
    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [section]);
    await db.query(
      `INSERT INTO page_group_permissions (page_id, group_id, role) VALUES ($1,$2,'viewer')`,
      [section, team],
    );

    await agree(section, 'viewer', 'a restricted section granted to a group');
    await agree(below, 'viewer', 'and below it');

    await db.query(`DELETE FROM page_group_permissions WHERE group_id = $1`, [team]);
    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [section]);
  });

  test('the more permissive of person and group wins, in both', async () => {
    // Adding somebody to a group must never reduce what they could already do
    // (ADR-0026). Both resolvers take a maximum; this is what says so about
    // the one that only just learned about groups.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [section, colleague],
    );
    await db.query(
      `INSERT INTO page_group_permissions (page_id, group_id, role) VALUES ($1,$2,'editor')`,
      [section, team],
    );

    await agree(section, 'editor', 'group grant more permissive');

    await db.query(`UPDATE page_permissions SET role = 'admin' WHERE user_id = $1`, [colleague]);
    await agree(section, 'admin', 'personal grant more permissive');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [colleague]);
    await db.query(`DELETE FROM page_group_permissions WHERE group_id = $1`, [team]);
  });

  test('leaving the group takes the access with it, in both', async () => {
    await db.query(
      `INSERT INTO page_group_permissions (page_id, group_id, role) VALUES ($1,$2,'editor')`,
      [section, team],
    );
    await agree(section, 'editor', 'in the group');

    await db.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [
      team,
      colleague,
    ]);
    await agree(section, null, 'out of the group');

    await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
      team,
      colleague,
    ]);
    await db.query(`DELETE FROM page_group_permissions WHERE group_id = $1`, [team]);
  });

  test('a custom role is not mistaken for somebody who is not here', async () => {
    /*
     * A role is a row now (ADR-0087), and a custom role has no name in the old
     * four-word vocabulary. `roleIn` used to return that name, and half its
     * callers read null as "not in this workspace" — so the obvious version of
     * this change would have thrown every member holding a custom role out of
     * the workspace entirely.
     *
     * There is no route that creates one yet, which is exactly why this test
     * inserts the row directly: the landmine is reachable from the database
     * before it is reachable from the interface.
     */
    const role = await db.query<{ id: string }>(
      `INSERT INTO roles (workspace_id, name, page_level, rights)
       VALUES ($1, 'Lektorat', 'commenter', '{}') RETURNING id`,
      [workspace],
    );
    const custom = role.rows[0]!.id;
    await db.query(`UPDATE workspace_members SET role_id = $3 WHERE workspace_id = $1 AND user_id = $2`, [
      workspace,
      colleague,
      custom,
    ]);

    const standing = await loadWorkspaceStanding(db, colleague, workspace);
    assert.equal(standing.isMember, true, 'still a member');
    assert.equal(standing.role, null, 'and not one of the four');
    assert.equal(standing.pageLevel, 'commenter');
    assert.equal(await roleIn(db, workspace, colleague), 'custom', 'a word, not null');

    // And the level the role carries reaches both resolvers, on an ordinary
    // page, with no grant anywhere.
    await agree(section, 'commenter', 'a custom role');

    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'guest')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
    await db.query(`DELETE FROM roles WHERE id = $1`, [custom]);
  });

  test('a role held through a group raises the page level', async () => {
    // The union-and-maximum rule (ADR-0087), which is ADR-0026's "the more
    // permissive wins" applied one level up. A group can carry a role, and
    // holding one must never take anything away.
    const role = await db.query<{ id: string }>(
      `INSERT INTO roles (workspace_id, name, page_level, rights)
       VALUES ($1, 'Redaktion', 'editor', '{}') RETURNING id`,
      [workspace],
    );
    const editorRole = role.rows[0]!.id;
    await db.query(`UPDATE groups SET role_id = $2 WHERE id = $1`, [team, editorRole]);

    // The colleague is still a guest, whose role gives nothing at all.
    await agree(section, 'editor', 'a role held through a group');

    await db.query(`UPDATE groups SET role_id = NULL WHERE id = $1`, [team]);
    await db.query(`DELETE FROM roles WHERE id = $1`, [editorRole]);
    await agree(section, null, 'and gone when the group loses it');
  });

  test('a restricted page still withholds what the role gives', async () => {
    // Unchanged by roles, and the half that was once missing from the claims
    // side: the tree stopped listing a restricted page while sync went on
    // serving its document to anybody who knew the id.
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'member')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
    await agree(section, 'editor', 'an ordinary member');

    await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [section]);
    await agree(section, null, 'and nothing once the section is restricted');
    await agree(below, null, 'nor below it');

    await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [section]);
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'guest')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
  });

  test('a cap lowers what a role and a grant arrived at, in both', async () => {
    /*
     * The third layer (ADR-0087), and the only one that takes something away.
     *
     * Asked of both resolvers because a ceiling the tree honours and sync does
     * not is a page listed as read-only whose editor still writes — the exact
     * shape of ADR-0086, one layer up. This is also why the cap lives on the
     * claims beside the grants rather than on the page location: a dozen call
     * sites build a location by hand, and every one of them would have had to
     * learn to fetch a ceiling.
     */
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'member')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
    await agree(section, 'editor', 'an ordinary member');

    await db.query(
      `INSERT INTO page_caps (page_id, max_level, include_subtree) VALUES ($1,'viewer',true)`,
      [section],
    );
    await agree(section, 'viewer', 'capped');
    await agree(below, 'viewer', 'and below it');
    await agree(root, 'editor', 'and not above it');

    // A grant cannot climb over the ceiling. That is the whole difference
    // between this layer and the one before it.
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'admin')`,
      [section, colleague],
    );
    await agree(section, 'viewer', 'a grant does not climb over a ceiling');

    await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [colleague]);
    await db.query(`DELETE FROM page_caps WHERE page_id = $1`, [section]);
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'guest')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
  });

  test('the lowest ceiling on the path wins, in both', async () => {
    // A ceiling under a ceiling is the real ceiling. "The nearest one wins"
    // would let a subpage quietly undo the section above it.
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'member')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
    await db.query(
      `INSERT INTO page_caps (page_id, max_level, include_subtree) VALUES
         ($1,'commenter',true), ($2,'viewer',true)`,
      [root, section],
    );

    await agree(root, 'commenter', 'the outer ceiling');
    await agree(section, 'viewer', 'the lower one where both apply');
    await agree(below, 'viewer', 'and under it');

    await db.query(`DELETE FROM page_caps WHERE page_id = ANY($1)`, [[root, section]]);
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'guest')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
  });

  test('a cap does not apply to somebody the workspace makes a page admin', async () => {
    /*
     * The safety floor, and the reason it has to exist: without it the first
     * cap set on a workspace root could never be lifted again, by anybody,
     * without database access.
     *
     * The record proposed exempting whoever holds `roles.manage`. Asking the
     * page level is the same rule a restricted page already applies, and a cap
     * is a rule about a page — so who may override it is settled by what the
     * workspace says about pages, not by a right about the settings screen.
     */
    await db.query(
      `INSERT INTO page_caps (page_id, max_level, include_subtree) VALUES ($1,'viewer',true)`,
      [root],
    );

    const listing = (await resolvePageAccess(db, { pageId: section, userId: owner })).access;
    assert.equal(listing, 'admin', 'the owner is not capped');

    const claims = await resolveSessionClaims(db, ownerToken, workspace);
    const location = await loadPageLocation(db, section);
    assert.equal(effectiveRole(claims!, location!), 'admin', 'and sync agrees');

    await db.query(`DELETE FROM page_caps WHERE page_id = $1`, [root]);
  });

  test('a cap says so, so the interface can explain it', async () => {
    // The price ADR-0087 accepted for this layer. A capped page looks like
    // every other page and behaves differently; without a word for it, every
    // permission question becomes an investigation.
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'member')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
    await db.query(
      `INSERT INTO page_caps (page_id, max_level, include_subtree) VALUES ($1,'viewer',true)`,
      [section],
    );

    const resolved = await resolvePageAccess(db, { pageId: section, userId: colleague });
    assert.equal(resolved.access, 'viewer');
    assert.equal(resolved.reason, 'capped', 'named, not left as "role"');

    await db.query(`DELETE FROM page_caps WHERE page_id = $1`, [section]);
    await db.query(
      `UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = 'guest')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspace, colleague],
    );
  });

  test('re-resolving a live connection sees group grants too', async () => {
    /*
     * `revalidateClaims` is the other loader, and it held the second copy of
     * the query that was missing the group half. It runs on an already-open
     * WebSocket, so a version of this fix that only corrected the first would
     * work until somebody's connection was re-checked and then stop — the worst
     * shape a permission bug can take, because it is intermittent.
     */
    await db.query(
      `INSERT INTO page_group_permissions (page_id, group_id, role) VALUES ($1,$2,'commenter')`,
      [section, team],
    );

    const claims = await revalidateClaims(db, { kind: 'session', sessionId }, workspace);
    assert.ok(claims, 'the session is still good');
    const location = await loadPageLocation(db, below);
    assert.equal(effectiveRole(claims, location!), 'commenter', 'inherited through the group');

    await db.query(`DELETE FROM page_group_permissions WHERE group_id = $1`, [team]);
  });
});
