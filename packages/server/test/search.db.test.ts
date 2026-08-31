/**
 * Search: what matches, and what a result says (ADR-0033).
 *
 * Two reports behind these. Only whole words were found, so a folder called
 * "Testordner" needed all of it typed; and a result was a bare link, so nothing
 * said whether it was a page or a folder, where it lived, or which sentence
 * matched.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { registerWorkspaceRoutes } from '../src/http/workspaces.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

/** What `ts_headline` wraps a match in, so nothing is ever HTML (ADR-0033). */
const OPEN = '\u0002';
const CLOSE = '\u0003';

interface SimilarName {
  pageId: string;
  title: string;
  kind: string;
  trail: Array<{ pageId: string; title: string }>;
}

interface SearchResult {
  pageId: string;
  title: string;
  kind: string;
  trail: Array<{ pageId: string; title: string }>;
  titleMatch: boolean;
  snippet: string | null;
  blockId: string | null;
}

describe(
  'search (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
      });
      registerPageRoutes(router, { pool: db });
      registerWorkspaceRoutes(router, { pool: db });

      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
    });

    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    interface Session {
      cookie: string;
      workspaceId: string;
    }

    const auth = (session: Session, init: RequestInit = {}): RequestInit => ({
      ...init,
      headers: { ...(init.headers ?? {}), cookie: session.cookie },
    });

    async function setup(): Promise<Session> {
      const res = await fetch(
        `${base}/api/auth/setup`,
        json({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          workspaceName: 'Work',
        }),
      );
      const body = await expectJson<{ workspaceId: string }>(res, 201);
      const header = res.headers.get('set-cookie');
      assert.ok(header);
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
        workspaceId: body.workspaceId,
      };
    }

    async function defaultFolder(session: Session): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM pages
          WHERE workspace_id = $1 AND kind = 'folder' AND parent_page_id IS NULL
          ORDER BY idx, id LIMIT 1`,
        [session.workspaceId],
      );
      assert.ok(rows[0]);
      return rows[0]!.id;
    }

    async function create(
      session: Session,
      title: string,
      kind: 'page' | 'folder',
      parentPageId: string | null,
    ): Promise<string> {
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ title, kind, parentPageId })),
      );
      await expectStatus(res, 201);
      return ((await res.json()) as { id: string }).id;
    }

    /**
     * Give a page a paragraph.
     *
     * Written straight into the projection, with the same text folded into the
     * search vector at weight D as the materialiser would. Body text arrives over
     * the WebSocket in the running system, and standing up a sync session to test
     * a SELECT would test the wrong thing.
     */
    async function addParagraph(pageId: string, text: string): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO blocks (id, page_id, type, idx, plain_text)
         VALUES (gen_random_uuid(), $1, 'paragraph', 'a0', $2)
         RETURNING id`,
        [pageId, text],
      );
      await db.query(
        `UPDATE page_search
            SET tsv = tsv || setweight(to_tsvector('simple', $2), 'D')
          WHERE page_id = $1`,
        [pageId, text],
      );
      return rows[0]!.id;
    }

    async function both(
      session: Session,
      query: string,
    ): Promise<{ results: SearchResult[]; similar: SimilarName[] }> {
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/search?q=${encodeURIComponent(query)}`,
        auth(session),
      );
      return expectJson<{ results: SearchResult[]; similar: SimilarName[] }>(res, 200);
    }

    async function search(session: Session, query: string): Promise<SearchResult[]> {
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/search?q=${encodeURIComponent(query)}`,
        auth(session),
      );
      const body = await expectJson<{ results: SearchResult[] }>(res, 200);
      return body.results;
    }

    test('a part of a word finds it', async () => {
      // The report: a folder called "Testordner" was found by all of it and by
      // nothing less.
      const session = await setup();
      await create(session, 'Testordner', 'folder', null);

      for (const query of ['testordn', 'Testord', 'testordner']) {
        const results = await search(session, query);
        assert.deepEqual(
          results.map((result) => result.title),
          ['Testordner'],
          `"${query}" finds it`,
        );
      }
    });

    test('only the last word is a prefix', async () => {
      // "budget rep" means a document about the budget and something starting
      // with "rep". Making the earlier words prefixes too would answer the same
      // keystrokes with everything about budgeting.
      const session = await setup();
      const folder = await defaultFolder(session);
      await create(session, 'Budget report', 'page', folder);

      assert.equal((await search(session, 'budget rep')).length, 1, 'last word is a prefix');
      assert.equal((await search(session, 'bud report')).length, 0, 'the first one is not');
    });

    test('a result says whether it is a page or a folder', async () => {
      const session = await setup();
      const folder = await defaultFolder(session);
      await create(session, 'Zeta folder', 'folder', null);
      await create(session, 'Zeta page', 'page', folder);

      const results = await search(session, 'zeta');
      assert.deepEqual(
        [...results].sort((a, b) => a.title.localeCompare(b.title)).map((r) => [r.title, r.kind]),
        [
          ['Zeta folder', 'folder'],
          ['Zeta page', 'page'],
        ],
      );
    });

    test('a result carries the titles of where it lives, not only ids', async () => {
      // Ids alone are unrenderable, which is why the interface never used the
      // old field.
      const session = await setup();
      const outer = await create(session, 'Projects', 'folder', null);
      const inner = await create(session, 'Roofing', 'folder', outer);
      await create(session, 'Tender comparison', 'page', inner);

      const [result] = await search(session, 'tender');
      assert.deepEqual(
        result?.trail.map((step) => step.title),
        ['Projects', 'Roofing'],
        'outermost first',
      );
      assert.deepEqual(result?.trail.map((step) => step.pageId), [outer, inner]);
    });

    test('a title match says so, and carries no passage', async () => {
      const session = await setup();
      const folder = await defaultFolder(session);
      const pageId = await create(session, 'Heat pump costs', 'page', folder);
      await addParagraph(pageId, 'Nothing here mentions the word in the title.');

      const [result] = await search(session, 'heat');
      assert.equal(result?.titleMatch, true);
      // No block matched, so there is no passage to show. A real answer rather
      // than a gap.
      assert.equal(result?.snippet, null);
      assert.equal(result?.blockId, null);
    });

    test('a match in the text comes back as a marked passage and a block', async () => {
      const session = await setup();
      const folder = await defaultFolder(session);
      const pageId = await create(session, 'Untitled notes', 'page', folder);
      const blockId = await addParagraph(
        pageId,
        'The quarterly budget was approved in March after a long discussion.',
      );

      const [result] = await search(session, 'budget');
      assert.equal(result?.titleMatch, false, 'the title did not match');
      assert.equal(result?.blockId, blockId, 'the block the passage came from');
      assert.ok(result?.snippet, 'a passage');
      assert.match(result.snippet, /quarterly/);
      assert.equal(
        result.snippet.includes(`${OPEN}budget${CLOSE}`),
        true,
        'the match is marked with control characters, never with HTML',
      );
      assert.doesNotMatch(result.snippet, /<mark>|&lt;/, 'nothing is markup');
    });

    test('a passage is found by a prefix too', async () => {
      const session = await setup();
      const folder = await defaultFolder(session);
      const pageId = await create(session, 'Untitled', 'page', folder);
      await addParagraph(pageId, 'Wärmepumpe und Photovoltaik, beides geplant.');

      const [result] = await search(session, 'photovolt');
      assert.ok(result?.snippet?.includes(`${OPEN}Photovoltaik${CLOSE}`));
    });

    test('a query that parses to nothing returns nothing rather than failing', async () => {
      // The concatenation with ':*' is null-propagating, so an unparseable query
      // matches nothing. The route refuses one character before this, so it is
      // the boundary of a case that cannot arrive — worth pinning down anyway,
      // because a 500 here would be a stack trace in somebody's search box.
      const session = await setup();
      await create(session, 'Anything', 'folder', null);

      for (const query of ['&&', '"', '-- ', '!!!!']) {
        const res = await fetch(
          `${base}/api/workspaces/${session.workspaceId}/search?q=${encodeURIComponent(query)}`,
          auth(session),
        );
        assert.equal(res.status, 200, `"${query}" is answered`);
      }
    });

    // --- a misspelling (ADR-0036) -----------------------------------------

    test('a misspelled name comes back as a suggestion', async () => {
      // "Testordnr" found nothing at all, and the person retyped it rather than
      // learning that the search cannot spell.
      const session = await setup();
      await create(session, 'Testordner', 'folder', null);

      const answer = await both(session, 'testordnr');
      assert.deepEqual(answer.results, [], 'nothing matched, which is honest');
      assert.deepEqual(
        answer.similar.map((entry) => entry.title),
        ['Testordner'],
      );
      assert.equal(answer.similar[0]?.kind, 'folder', 'and it says what it is');
    });

    test('a suggestion carries where it lives, like a result', async () => {
      const session = await setup();
      const outer = await create(session, 'Projects', 'folder', null);
      await create(session, 'Wärmepumpe', 'folder', outer);

      const answer = await both(session, 'warmepumpe');
      assert.deepEqual(
        answer.similar[0]?.trail.map((step) => step.title),
        ['Projects'],
      );
    });

    test('a search that worked is left alone', async () => {
      // Five guesses under a good answer is a section people learn to skip,
      // which is when they will not read it on the day it holds the answer.
      const session = await setup();
      const folder = await defaultFolder(session);
      for (const title of ['Budget one', 'Budget two', 'Budget three', 'Budget four', 'Budget five']) {
        await create(session, title, 'page', folder);
      }

      const answer = await both(session, 'budget');
      assert.equal(answer.results.length, 5);
      assert.deepEqual(answer.similar, [], 'no suggestions under a full page of results');
    });

    test('a suggestion is never something already found', async () => {
      const session = await setup();
      await create(session, 'Testordner', 'folder', null);

      const answer = await both(session, 'testordner');
      assert.equal(answer.results.length, 1, 'found properly');
      assert.deepEqual(answer.similar, [], 'and not offered again below itself');
    });

    test('a different word is not a suggestion', async () => {
      // The threshold has to refuse as well as admit, or every search ends in
      // five unrelated names.
      const session = await setup();
      await create(session, 'Testordner', 'folder', null);

      const answer = await both(session, 'rechnungen');
      assert.deepEqual(answer.results, []);
      assert.deepEqual(answer.similar, []);
    });

    test('a collection row is not offered as a name', async () => {
      // A row is a page, and a table of two hundred people would otherwise fill
      // every suggestion list in the workspace.
      const session = await setup();
      const folder = await defaultFolder(session);
      const page = await create(session, 'People', 'page', folder);
      await db.query(
        `UPDATE pages SET kind = 'row', title = 'Testordnerr' WHERE id = $1`,
        [page],
      );

      const answer = await both(session, 'testordner');
      assert.deepEqual(answer.similar, []);
    });
  },
);
