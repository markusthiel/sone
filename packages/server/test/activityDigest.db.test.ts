/**
 * A mail about what changed (ADR-0062).
 *
 * The first test is the one that matters: a restricted page must not appear in
 * somebody's digest. That is the failure this feature could have that would
 * actually harm anybody, and it is prevented by using the same visibility
 * clause the tree and search use rather than writing a second one.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import { changedFor, composeDigest } from '../src/jobs/activityDigest.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';

describe(
  'activity digest',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let workspace: string;
    let member: string;
    let colleague: string;

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);

      const people = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name)
         VALUES ('mitglied@example.org', 'Mitglied'), ('kollege@example.org', 'Kollege')
         RETURNING id::text AS id`,
      );
      member = people.rows[0]!.id;
      colleague = people.rows[1]!.id;

      const ws = await db.query<{ id: string }>(
        `INSERT INTO workspaces (id, name, created_by)
         VALUES (gen_random_uuid(), 'Team', $1) RETURNING id::text AS id`,
        [member],
      );
      workspace = ws.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
        [workspace, member, colleague],
      );
    });

    after(async () => {
      await closeTestPool();
    });

    async function page(title: string, restricted: boolean, editor: string): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO pages (id, workspace_id, idx, title, kind, restricted,
                            last_edited_at, last_edited_by)
         VALUES (gen_random_uuid(), $1, $2, $3, 'page', $4, now(), $5)
         RETURNING id::text AS id`,
        [workspace, `a${title}`, title, restricted, editor],
      );
      return rows[0]!.id;
    }

    const yesterday = (): Date => new Date(Date.now() - 86_400_000);

    test('a restricted page is not in somebody else´s digest', async () => {
      const open = await page('Offene Seite', false, colleague);
      const secret = await page('Gehaltsrunde', true, colleague);

      const forMember = await changedFor(db, {
        userId: member,
        email: 'mitglied@example.org',
        isAdmin: false,
        since: yesterday(),
      });

      const titles = forMember.map((one) => one.title);
      assert.ok(titles.includes('Offene Seite'), 'the ordinary page is there');
      assert.ok(!titles.includes('Gehaltsrunde'), 'the restricted one is not');
      // And not by id either, in case a title were ever omitted.
      assert.ok(!forMember.some((one) => one.pageId === secret));
      assert.ok(forMember.some((one) => one.pageId === open));
    });

    test('somebody´s own edits alone are not news', async () => {
      // A digest listing what somebody did themselves is a receipt.
      await page('Von mir selbst', false, member);
      const mine = await changedFor(db, {
        userId: member,
        email: 'mitglied@example.org',
        isAdmin: false,
        since: yesterday(),
      });
      assert.ok(!mine.some((one) => one.title === 'Von mir selbst'));
    });

    test('nothing to say composes to nothing at all', () => {
      // A mail whose content is its own emptiness is an interruption that
      // teaches the reader to ignore the next one (ADR-0062).
      assert.equal(composeDigest([], 'title', 'https://sone.example', 'daily'), null);
    });

    test('with the instance set to workspace-only, no title leaves it', () => {
      /*
       * An operator who decided titles must not leave the instance did not make
       * an exception for a mail that happens to list more of them (ADR-0058).
       */
      const composed = composeDigest(
        [
          {
            pageId: 'p1',
            title: 'Gehaltsrunde',
            workspaceId: 'w1',
            workspaceName: 'Team',
            lastEditor: 'Kollege',
            editors: 2,
          },
        ],
        'workspace',
        'https://sone.example',
        'daily',
      );
      assert.ok(composed);
      assert.doesNotMatch(composed.body, /Gehaltsrunde/);
      assert.match(composed.body, /Team/);
      assert.match(composed.body, /1 page/);
    });

    test('a page is one line however often it was edited', () => {
      // Otherwise the mail's length is a function of how busy somebody else
      // was, which is the mail people filter into a folder they never open.
      const composed = composeDigest(
        [
          {
            pageId: 'p1',
            title: 'Vielbearbeitet',
            workspaceId: 'w1',
            workspaceName: 'Team',
            lastEditor: 'Kollege',
            editors: 3,
          },
        ],
        'title',
        'https://sone.example',
        'daily',
      );
      assert.ok(composed);
      assert.equal((composed.body.match(/Vielbearbeitet/g) ?? []).length, 1);
      assert.match(composed.body, /Kollege and 2 other/);
    });
  },
);
