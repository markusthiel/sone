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
import crypto from 'node:crypto';

import * as Y from 'yjs';

import { BLOCK_ATTRS, pageContent } from '@sone/core';

import { applyToDocument } from '../src/doc/docStore.js';
import { rematerialize } from '../src/materialize/rematerialize.js';
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
        // No relay in these suites: the reset is absent, which is the
        // ordinary case for an instance without mail (ADR-0059).
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
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
    /**
     * A paragraph written the way a client writes one.
     *
     * Through the document and the materialiser, unlike `addParagraph` below,
     * which inserts a block row and patches `page_search` by hand. That
     * simulation is fine for testing the *query* — it was written before there
     * was anything else to project — but a test of what the materialiser
     * derives has to run the materialiser, or it tests the simulation.
     */
    async function writeParagraph(
      session: Session,
      pageId: string,
      text: string,
    ): Promise<void> {
      await applyToDocument(
        db,
        pageId,
        (doc) => {
          const fragment = pageContent(doc);
          const paragraph = new Y.XmlElement('paragraph');
          paragraph.setAttribute(BLOCK_ATTRS.id, crypto.randomUUID());
          const body = new Y.XmlText();
          body.insert(0, text);
          paragraph.insert(0, [body]);
          fragment.insert(fragment.length, [paragraph]);
        },
        null,
      );
      await rematerialize(db, pageId, session.workspaceId, null);
    }

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

    test('a misspelt word in the body is offered as a correction', async () => {
      // The asymmetry this closes: a misspelt *title* already found its page
      // (ADR-0036), a misspelt word in the body found nothing (ADR-0051).
      const session = await setup();
      const folder = await defaultFolder(session);
      const page = await create(session, 'Buchhaltung', 'page', folder);
      await writeParagraph(session, page, 'Die Beraternummer steht in der Kopfzeile.');

      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/search?q=beratenummer`,
        auth(session),
      );
      const body = await expectJson<{ results: SearchResult[]; corrections: string[] }>(res, 200);

      assert.deepEqual(body.results, [], 'the misspelling itself finds nothing');
      assert.ok(
        body.corrections.includes('beraternummer'),
        `the correction is offered, got ${JSON.stringify(body.corrections)}`,
      );
    });

    test('a word that is spelt correctly is not corrected back at itself', async () => {
      const session = await setup();
      const folder = await defaultFolder(session);
      const page = await create(session, 'Buchhaltung', 'page', folder);
      await writeParagraph(session, page, 'Die Beraternummer steht in der Kopfzeile.');

      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/search?q=beraternummer`,
        auth(session),
      );
      const body = await expectJson<{ results: SearchResult[]; corrections: string[] }>(res, 200);
      assert.ok(body.results.length > 0, 'it is found');
      assert.ok(
        !body.corrections.includes('beraternummer'),
        'and not suggested as a correction of itself',
      );
    });

    test('assigned:me finds the pages holding my tasks', async () => {
      // Assigning is useless if nobody can list what they were given, and the
      // assignment is already projected — so this needed a filter and an index
      // rather than a screen (ADR-0052).
      const session = await setup();
      const folder = await defaultFolder(session);
      const mine = await create(session, 'Meine Aufgaben', 'page', folder);
      const other = await create(session, 'Fremde Aufgaben', 'page', folder);

      /*
       * Whose session this is, read from the database.
       *
       * My first version used `session.userId`, which this suite's Session type
       * does not have — so `JSON.stringify` dropped it and the props went in
       * without an assignee at all. The test then asserted that a filter found
       * a task nobody had been given.
       */
      const me = await db.query<{ user_id: string }>(
        `SELECT user_id FROM workspace_members WHERE workspace_id = $1 LIMIT 1`,
        [session.workspaceId],
      );
      const myId = me.rows[0]!.user_id;

      // Straight into the projection: this is a test of the query, and the
      // block rows are what the query reads.
      await db.query(
        `INSERT INTO blocks (id, page_id, type, idx, props, plain_text)
         VALUES (gen_random_uuid(), $1, 'todo', 'a0', $2, 'Rechnung prüfen'),
                (gen_random_uuid(), $3, 'todo', 'a0', $4, 'Rechnung prüfen')`,
        [
          mine,
          JSON.stringify({ assignee: myId }),
          other,
          JSON.stringify({ assignee: '00000000-0000-4000-8000-000000000001' }),
        ],
      );

      assert.deepEqual(
        (await search(session, 'assigned:me')).map((one) => one.pageId),
        [mine],
        'mine, and not the one assigned to somebody else',
      );

      // A name that is not an id resolves to nobody, which is the honest answer
      // to a filter that cannot be resolved — not "everybody".
      assert.deepEqual(await search(session, 'assigned:anna'), []);
    });

    test('a search can be kept, replaced by name, and forgotten', async () => {
      // Per person: `assigned:me` means something different to everybody, so a
      // shared saved search would resolve differently per reader (ADR-0050).
      const session = await setup();
      const keep = (name: string, query: string): Promise<Response> =>
        fetch(`${base}/api/workspaces/${session.workspaceId}/searches`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ name, query }),
        });

      await expectJson(await keep('Offene Rechnungen', 'tag:rechnung'), 201);
      // Saving over a name replaces it, which is what refining a search and
      // saving it again means.
      await expectJson(await keep('Offene Rechnungen', 'tag:rechnung assigned:me'), 201);
      await expectStatus(await keep('', 'tag:rechnung'), 422);

      const mine = await expectJson<{
        searches: Array<{ id: string; name: string; query: string }>;
      }>(
        await fetch(`${base}/api/workspaces/${session.workspaceId}/searches`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );
      assert.deepEqual(
        mine.searches.map((one) => [one.name, one.query]),
        [['Offene Rechnungen', 'tag:rechnung assigned:me']],
        'one entry, with the newer query',
      );

      await expectJson(
        await fetch(`${base}/api/searches/${mine.searches[0]!.id}`, {
          method: 'DELETE',
          headers: { cookie: session.cookie },
        }),
        200,
      );
      const after = await expectJson<{ searches: unknown[] }>(
        await fetch(`${base}/api/workspaces/${session.workspaceId}/searches`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );
      assert.deepEqual(after.searches, []);
    });

    test('a folder filter narrows by place, and says how many folders it found', async () => {
      // ADR-0050 deferred this believing it needed an id in the query. It does
      // not: a name resolved at search time is what makes the syntax
      // shareable, and the count on the response is what keeps the ambiguity
      // visible.
      const session = await setup();
      const root = await defaultFolder(session);
      const projects = await create(session, 'Projekte', 'folder', root);
      const inside = await create(session, 'Rechnung März', 'page', projects);
      // Two levels down, because naming a folder means anywhere beneath it.
      const deeper = await create(session, 'Unterordner', 'folder', projects);
      const deepPage = await create(session, 'Rechnung April', 'page', deeper);
      const outside = await create(session, 'Rechnung Mai', 'page', root);

      /*
       * The route directly, because the suite's `search` helper returns only
       * the results and this test is about the reported filters as well.
       * Reaching past a helper is worth a sentence: rebuilding it for every
       * caller would be a bigger change than the thing being tested.
       */
      const ask = async (query: string) =>
        expectJson<{
          // `pageId`, which is what a search result calls it — `id` was a
          // field name I assumed, and it read as two nulls.
          results: Array<{ pageId: string }>;
          filters: { inMatched?: number };
        }>(
          await fetch(
            `${base}/api/workspaces/${session.workspaceId}/search?q=${encodeURIComponent(query)}`,
            auth(session),
          ),
          200,
        );

      const found = await ask('in:Projekte Rechnung');
      const ids = found.results.map((one) => one.pageId);
      assert.ok(ids.includes(inside), 'a page directly inside');
      assert.ok(ids.includes(deepPage), 'and one two levels down');
      assert.ok(!ids.includes(outside), 'not one elsewhere');
      assert.equal(found.filters.inMatched, 1, 'one folder matched that name');

      // A name nothing is called matches nothing, and says so with a zero —
      // which tells somebody the name is wrong rather than that the folder is
      // empty.
      const nowhere = await ask('in:Gibtsnicht Rechnung');
      assert.equal(nowhere.filters.inMatched, 0);
      assert.deepEqual(nowhere.results, []);
    });

    test('a tag filter narrows, and works with no words at all', async () => {
      // "Show me everything tagged X" is a question people ask constantly and
      // could not ask at all (ADR-0050). The two-character minimum is about a
      // guess, and a filter is not one.
      const session = await setup();
      const folder = await defaultFolder(session);
      const tagged = await create(session, 'Rechnung März', 'page', folder);
      const other = await create(session, 'Rechnung April', 'page', folder);

      await fetch(`${base}/api/pages/${tagged}`, {
        method: 'PATCH',
        headers: { ...auth(session).headers, 'content-type': 'application/json' },
        body: JSON.stringify({ tags: ['Buchhaltung'] }),
      });

      const filtered = await search(session, 'tag:buchhaltung');
      assert.deepEqual(
        filtered.map((one) => one.pageId),
        [tagged],
        'the tag alone is a search',
      );

      // And it narrows a text search rather than replacing it.
      const both_ = await search(session, 'tag:buchhaltung rechnung');
      assert.deepEqual(both_.map((one) => one.pageId), [tagged]);
      const unfiltered = await search(session, 'rechnung');
      assert.equal(unfiltered.length, 2, 'without the filter, both');
      void other;
    });

    test('a date filter reads the page´s last edit, and a bad date is reported', async () => {
      const session = await setup();
      const folder = await defaultFolder(session);
      const page = await create(session, 'Heute geschrieben', 'page', folder);
      void page;

      const today = new Date().toISOString().slice(0, 10);
      assert.ok(
        (await search(session, `after:${today} geschrieben`)).length > 0,
        'edited today is after today, because both ends are inclusive',
      );
      assert.equal(
        (await search(session, 'before:2020-01-01 geschrieben')).length,
        0,
        'and not before 2020',
      );

      // A filter that cannot be read narrows nothing and says so, rather than
      // being silently dropped.
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/search?q=${encodeURIComponent(
          'after:letzte-woche geschrieben',
        )}`,
        auth(session),
      );
      const body = await expectJson<{
        results: SearchResult[];
        filters: { unreadable: Array<{ prefix: string; value: string }> };
      }>(res, 200);
      assert.deepEqual(body.filters.unreadable, [
        { prefix: 'after', value: 'letzte-woche', reason: 'not_a_date' },
      ]);
      assert.ok(body.results.length > 0, 'and the rest of the search still ran');
    });

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
