/**
 * Who a notification may reach, and who may see a page at all (ADR-0110).
 *
 * The last open point on `claude/durchgang-nie-gelaufen.md`: the membership and
 * visibility half of `writeNotifications`' INSERT had no test with a
 * non-member or a restricted page. Everything that reached the statement
 * satisfied both clauses the cheapest possible way — a member, on an
 * unrestricted page — so the JOIN and the WHERE were never asked a question
 * they could answer wrongly.
 *
 * They can. The first test written against a **guest** passed a notification
 * through, carrying the page's title and a quotation from its text, to
 * somebody the same instance refuses to open that page for.
 *
 * ## The two answers
 *
 *   resolvePageAccess / effectiveRole   what sync and every page fetch use
 *   visiblePagesCondition               what every *listing* uses
 *
 * They must be the same answer or a listing discloses what the page withholds
 * (ADR-0026), and they were not: the condition's first branch is "nothing on
 * this page's path is restricted", which is true of an ordinary page for
 * *anybody* — including the one role that is defined by having no access
 * unless somebody grants it.
 *
 * So this file asks both, about the same people and the same pages, and then
 * asks the notification writer — which is a listing wearing different clothes,
 * and the place where the disclosure arrives by itself rather than waiting to
 * be clicked.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { CommentThread } from '@sone/core';
import type { Pool } from 'pg';

import { writeNotifications } from '../src/notifications/fromComments.js';
import { resolvePageAccess, visiblePagesCondition } from '../src/pages/access.js';
import {
  addMember,
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';

describe(
  'who may be told about a page (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;

    /** In the workspace as a `member`: a page level, and no rights. */
    let member: string;
    /** In the workspace as a `guest`: a member row, and no page level. */
    let guest: string;
    /** In the workspace as an `admin`: a page level of admin. */
    let admin: string;
    /** In no workspace at all. */
    let outsider: string;

    /** An ordinary page. Nothing on its path is restricted. */
    let open: string;
    /** Restricted, and its child, which inherits the restriction. */
    let secret: string;
    let under: string;

    before(async () => {
      db = await getTestPool();
    });

    after(async () => {
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);

      [member, guest, admin, outsider] = await Promise.all([
        person('member'),
        person('guest'),
        person('admin'),
        person('outsider'),
      ]);
      await addMember(db, fx.workspaceId, member, 'member');
      await addMember(db, fx.workspaceId, guest, 'guest');
      await addMember(db, fx.workspaceId, admin, 'admin');

      open = await page(null, 'Die Zahlen', false);
      secret = await page(null, 'Gehaltsrunde', true);
      under = await page(secret, 'Notizen', false);
    });

    // --- what a notification may carry ---------------------------------------

    test('a member named in a comment is told', async () => {
      // The baseline, and the only shape the suite had before this file: a
      // member, an ordinary page. Everything below is the same call with one
      // thing changed.
      assert.equal(await tell(open, member), 1);
      assert.deepEqual(await told(open), [member]);
    });

    test('somebody who is not in the workspace is not told', async () => {
      /*
       * The `JOIN workspace_members` half. A name in a document is written by
       * a client, so it can be any account on the instance — a colleague from
       * another workspace, somebody who was here last year, an id typed by an
       * importer.
       */
      assert.equal(await tell(open, outsider), 0);
      assert.deepEqual(await told(open), []);
    });

    test('somebody removed from the workspace stops being told', async () => {
      assert.equal(await tell(open, member), 1);
      await db.query(`DELETE FROM notifications WHERE page_id = $1`, [open]);

      await db.query(`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, [
        fx.workspaceId,
        member,
      ]);

      // The page is reprojected on every edit, so this is not a hypothetical
      // second call: it is what happens the next time anybody types in it.
      assert.equal(await tell(open, member), 0);
      assert.deepEqual(await told(open), []);
    });

    test('a guest with no grant is not told, though they are a member', async () => {
      /*
       * **The finding.** A guest holds a role whose `page_level` is null:
       * being in a workspace as a guest means being shown particular things,
       * not everything. `sync.db.test.ts` asserts exactly this — "a guest
       * without a grant cannot open a page" — about an ordinary page like
       * this one.
       *
       * The membership JOIN matches, because a guest *is* a member. And the
       * visibility condition matched too, because its first branch asks only
       * whether anything on the path is restricted. So the same instance
       * refused to open the page and sent its title and a line of its text
       * to the same person, unprompted.
       *
       * That is the disclosure the condition exists to prevent, arriving by
       * the one route that does not wait to be clicked.
       */
      assert.equal(await tell(open, guest), 0);
      assert.deepEqual(await told(open), []);
    });

    test('a guest granted the page is told', async () => {
      // The counterweight, and the reason the fix is a page-level check rather
      // than "no guests": a grant is what a guest is for.
      await grant(open, guest, 'viewer');

      assert.equal(await tell(open, guest), 1);
      assert.deepEqual(await told(open), [guest]);
    });

    test('a member is not told about a restricted page', async () => {
      // The `WHERE` half. A restriction withholds what the role would
      // otherwise give, and a notification is the first thing that would
      // arrive from behind it.
      assert.equal(await tell(secret, member), 0);
      assert.deepEqual(await told(secret), []);
    });

    test('nor about a page under a restricted one', async () => {
      // Restriction is inherited, or a section's rules would end at its first
      // child (ADR-0026).
      assert.equal(await tell(under, member), 0);
      assert.deepEqual(await told(under), []);
    });

    test('a member granted the restricted page is told', async () => {
      await grant(secret, member, 'commenter');

      assert.equal(await tell(secret, member), 1);
      assert.deepEqual(await told(secret), [member]);
    });

    test('a workspace admin is told about a restricted page', async () => {
      // Whoever the workspace makes a page admin sees it all, restricted or
      // not — the branch `fullAccessCondition` carries, and the one that keeps
      // a restriction from locking out the people who have to be able to undo
      // it.
      assert.equal(await tell(secret, admin), 1);
      assert.deepEqual(await told(secret), [admin]);
    });

    test('an excerpt is what would have been disclosed', async () => {
      /*
       * Written out once, because "no row" is an abstract loss and this is
       * the concrete one: the row carries the sentence.
       */
      await tell(open, member);
      const rows = await db.query<{ excerpt: string }>(
        `SELECT n.excerpt FROM notifications n WHERE n.page_id = $1`,
        [open],
      );
      assert.match(rows.rows[0]!.excerpt, /Gehaltsband/);
    });

    // --- and the same question, asked of the condition itself ----------------

    test('the listing condition and the page resolver give one answer', async () => {
      /*
       * Every person against every page, which is the version of this check
       * that cannot be satisfied by choosing the pairs.
       *
       * `pageAccess.db.test.ts` has had this test since ADR-0026 with four
       * hand-picked pairs — and all four involve a restricted page, so the
       * one shape where the two answers differ was not among them. An
       * ordinary page and a guest: the resolver says no, the condition said
       * yes, and nothing compared them.
       */
      await grant(open, guest, 'viewer');

      for (const person of [fx.userId, member, guest, admin, outsider]) {
        for (const pageId of [open, secret, under]) {
          const listed = await db.query(
            `SELECT 1 FROM pages p WHERE p.id = $1 AND ${visiblePagesCondition('p', '$2')}`,
            [pageId, person],
          );
          const resolved = await resolvePageAccess(db, { pageId, userId: person });
          assert.equal(
            listed.rowCount === 1,
            resolved.access !== null,
            `${label(person)} on ${label(pageId)}: listing said ` +
              `${listed.rowCount === 1}, the resolver said ${resolved.access}`,
          );
        }
      }
    });

    test('a guest sees nothing in a workspace of ordinary pages', async () => {
      /*
       * The same fault as a list rather than as a pair, because this is how it
       * reaches somebody: search, the comment list, the template picker, the
       * export archive and the digest mail all paste this condition in and
       * add nothing to it.
       */
      const rows = await db.query<{ id: string }>(
        `SELECT p.id FROM pages p
          WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2')}`,
        [fx.workspaceId, guest],
      );
      assert.deepEqual(rows.rows, [], 'a guest is given pages, not a workspace');
    });

    test('and sees exactly what was granted, and under it', async () => {
      /*
       * A grant includes the subtree unless it says otherwise, so this is two
       * pages — and still not the ordinary one, which is the point: the guest's
       * workspace is the set of things somebody handed them, not the set of
       * things nobody hid.
       */
      await grant(secret, guest, 'viewer');

      const rows = await db.query<{ title: string }>(
        `SELECT p.title FROM pages p
          WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2')}
          ORDER BY p.title`,
        [fx.workspaceId, guest],
      );
      assert.deepEqual(
        rows.rows.map((row) => row.title),
        ['Gehaltsrunde', 'Notizen'],
      );
    });

    test('a member still sees the ordinary pages', async () => {
      // The counterweight to the two above: the fix must not turn a workspace
      // into a set of individually granted pages for everybody else.
      const rows = await db.query<{ id: string }>(
        `SELECT p.id FROM pages p
          WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2')}`,
        [fx.workspaceId, member],
      );
      assert.deepEqual(rows.rows.map((row) => row.id), [open]);
    });

    test('a group with a page level carries somebody who has none', async () => {
      /*
       * Union and maximum, never subtraction (ADR-0026): a guest put into a
       * group whose role gives `editor` holds `editor`. The condition asks
       * about the membership's role *and* the groups', for the same reason the
       * loader does — being added to a group must never reduce what somebody
       * could already do, and reading only the membership would make joining
       * one worth nothing.
       */
      const group = await db.query<{ id: string }>(
        `INSERT INTO groups (workspace_id, name, role_id)
         VALUES ($1, 'Redaktion', (SELECT id FROM roles WHERE key = 'member' AND workspace_id IS NULL))
         RETURNING id`,
        [fx.workspaceId],
      );
      await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)`, [
        group.rows[0]!.id,
        guest,
      ]);

      const rows = await db.query<{ id: string }>(
        `SELECT p.id FROM pages p
          WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2')}`,
        [fx.workspaceId, guest],
      );
      assert.deepEqual(rows.rows.map((row) => row.id), [open]);

      assert.equal(await tell(open, guest), 1, 'and is told, like any member');
    });

    // --- helpers -------------------------------------------------------------

    const names = new Map<string, string>();

    /** An account, remembered by name so a failure message reads. */
    async function person(name: string): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`,
        [`${name}-${randomUUID()}@example.org`, name],
      );
      names.set(row.rows[0]!.id, name);
      return row.rows[0]!.id;
    }

    async function page(
      parent: string | null,
      title: string,
      restricted: boolean,
    ): Promise<string> {
      // The id is the document's id, so it exists before the row does.
      const id = randomUUID();
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind,
                            restricted, ancestor_ids)
         VALUES ($1,$2,$3,$4,'a0','page',$5,$6)`,
        [id, fx.workspaceId, parent, title, restricted, parent ? [parent] : []],
      );
      names.set(id, title);
      return id;
    }

    const label = (id: string): string => names.get(id) ?? id;

    async function grant(pageId: string, userId: string, role: string): Promise<void> {
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,$3)`,
        [pageId, userId, role],
      );
    }

    /**
     * Name somebody in a comment on a page, and project it. Returns the rows
     * written, which is the number under test.
     */
    async function tell(pageId: string, who: string): Promise<number> {
      const thread: CommentThread = {
        id: `t-${who.slice(0, 8)}`,
        from: new Uint8Array(),
        to: new Uint8Array(),
        item: null,
        quote: 'das Gehaltsband',
        resolved: false,
        createdAt: 0,
        range: { from: 1, to: 2 },
        messages: [
          {
            id: `m-${who.slice(0, 8)}`,
            author: fx.userId,
            at: 0,
            text: 'Das neue Gehaltsband steht hier drin, schau bitte drüber',
            mentions: [who],
          },
        ],
      };

      const client = await db.connect();
      try {
        return await writeNotifications(client, pageId, fx.workspaceId, [thread]);
      } finally {
        client.release();
      }
    }

    /** Who was actually told about a page. */
    async function told(pageId: string): Promise<string[]> {
      const rows = await db.query<{ user_id: string }>(
        `SELECT n.user_id FROM notifications n WHERE n.page_id = $1 ORDER BY n.user_id`,
        [pageId],
      );
      return rows.rows.map((row) => row.user_id);
    }
  },
);
