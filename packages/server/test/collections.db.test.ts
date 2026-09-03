/**
 * Collections over HTTP.
 *
 * Reads come from the projection, writes go to the document. Most of these
 * tests exist to hold that line: a write that only touched the projection would
 * pass a naive read and vanish at the next materialisation.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { hashPassword } from '../src/auth/password.js';
import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerCollectionRoutes } from '../src/http/collections.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'collections (database)',
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
      registerCollectionRoutes(router, { pool: db });

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

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header);
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    interface Session {
      cookie: string;
      userId: string;
      workspaceId: string;
      rootFolder: string;
    }

    async function setup(): Promise<Session> {
      const res = await fetch(
        `${base}/api/auth/setup`,
        json({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          workspaceName: 'W',
        }),
      );
      const body = await expectJson<{ userId: string; workspaceId: string }>(res, 201);
      const folder = await db.query<{ id: string }>(
        `SELECT id FROM pages WHERE workspace_id = $1 AND kind = 'folder' LIMIT 1`,
        [body.workspaceId],
      );
      return {
        cookie: cookieFrom(res),
        userId: body.userId,
        workspaceId: body.workspaceId,
        rootFolder: folder.rows[0]!.id,
      };
    }

    const create = async (
      session: Session,
      title: string,
      kind: 'page' | 'folder',
      parent: string,
    ): Promise<string> => {
      const res = await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ title, kind, parentPageId: parent }),
      });
      return (await expectJson<{ id: string }>(res, 201)).id;
    };

    // --- helpers, all addressing a collection by its own id ------------------

    /** Add a collection to a page and return its id (ADR-0021). */
    const collectionOn = async (session: Session, pageId: string): Promise<string> => {
      const res = await fetch(`${base}/api/pages/${pageId}/collections`, {
        method: 'POST',
        headers: { cookie: session.cookie },
      });
      return (await expectJson<{ collectionId: string }>(res, 201)).collectionId;
    };

    /** A row is created through its collection and never appears in the tree. */
    const addRow = async (
      session: Session,
      collectionId: string,
      title: string,
    ): Promise<string> => {
      const res = await fetch(`${base}/api/collections/${collectionId}/rows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ title }),
      });
      return (await expectJson<{ id: string }>(res, 201)).id;
    };

    interface ReadCollection {
      pageId: string;
      collectionId: string;
      titleFieldId: string;
      canEdit: boolean;
      views: Array<{ id: string; viewType: string; definition: Record<string, unknown> }>;
      fields: Array<{
        id: string;
        name: string;
        fieldType: string;
        config: Record<string, unknown>;
      }>;
      rows: Array<{ id: string; title: string; values: Record<string, unknown> }>;
    }

    const read = async (
      session: Session,
      collectionId: string,
      viewId?: string,
    ): Promise<ReadCollection> =>
      expectJson<ReadCollection>(
        await fetch(
          `${base}/api/collections/${collectionId}${viewId ? `?view=${viewId}` : ''}`,
          { headers: { cookie: session.cookie } },
        ),
      );

    const addField = (
      session: Session,
      collectionId: string,
      body: Record<string, unknown>,
    ): Promise<Response> =>
      fetch(`${base}/api/collections/${collectionId}/fields`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify(body),
      });

    const fieldOf = async (
      session: Session,
      collectionId: string,
      body: Record<string, unknown>,
    ): Promise<string> =>
      (await expectJson<{ id: string }>(await addField(session, collectionId, body), 201)).id;

    const setValue = (
      session: Session,
      rowId: string,
      fieldId: string,
      value: unknown,
    ): Promise<Response> =>
      fetch(`${base}/api/pages/${rowId}/properties/${fieldId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ value }),
      });

    const addView = (
      session: Session,
      collectionId: string,
      definition: Record<string, unknown>,
    ): Promise<Response> =>
      fetch(`${base}/api/collections/${collectionId}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ viewType: 'table', definition }),
      });

    const setOptionsFor = (
      session: Session,
      collectionId: string,
      fieldId: string,
      options: Array<{ id: string; name: string; color?: string }>,
    ): Promise<Response> =>
      fetch(`${base}/api/collections/${collectionId}/fields/${fieldId}/options`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ options }),
      });

    const treeIds = async (session: Session): Promise<string[]> => {
      const res = await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, {
        headers: { cookie: session.cookie },
      });
      const body = await expectJson<{ pages: Array<{ id: string }> }>(res);
      return body.pages.map((page) => page.id);
    };

    // --- where a collection lives --------------------------------------------

    test('a relation column must say where it points', async () => {
      // Not defaulted to "anywhere": a column that can point at any page gives
      // a picker over the whole workspace and a rollup with nothing to
      // aggregate, because the other side has no fields in common (ADR-0054).
      const session = await setup();
      const invoices = await collectionOn(
        session,
        await create(session, 'Rechnungen', 'page', session.rootFolder),
      );

      await expectStatus(
        await addField(session, invoices, { name: 'Kunde', fieldType: 'relation' }),
        422,
      );

      const clients = await collectionOn(
        session,
        await create(session, 'Kunden', 'page', session.rootFolder),
      );
      await expectJson(
        await addField(session, invoices, {
          name: 'Kunde',
          fieldType: 'relation',
          config: { collectionId: clients },
        }),
        201,
      );
    });

    test('a relation cell may only point into the collection it names', async () => {
      // A relation crosses pages, so an unchecked id is a way to make a cell
      // point at another collection — and then the rollups on the other side
      // aggregate fields that are not there (ADR-0054).
      const session = await setup();
      const invoices = await collectionOn(
        session,
        await create(session, 'Rechnungen 2', 'page', session.rootFolder),
      );
      const clients = await collectionOn(
        session,
        await create(session, 'Kunden 2', 'page', session.rootFolder),
      );

      const field = await expectJson<{ id: string }>(
        await addField(session, invoices, {
          name: 'Kunde',
          fieldType: 'relation',
          config: { collectionId: clients },
        }),
        201,
      );

      const invoice = await addRow(session, invoices, 'R-001');
      const client = await addRow(session, clients, 'Acme');
      const wrongSide = await addRow(session, invoices, 'R-002');

      const setCell = (rowId: string, pageIds: string[]): Promise<Response> =>
        // `/api/pages/:rowId/properties/:fieldId` — the route that exists. My
        // first version invented `/api/rows/:id/values/:fieldId`, and both
        // calls 404'd: the one expecting a refusal *passed*, for a reason that
        // had nothing to do with what it was testing. A test that asserts a
        // failure can pass because the request never arrived.
        fetch(`${base}/api/pages/${rowId}/properties/${field.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ value: { kind: 'relation', pageIds } }),
        });

      await expectStatus(await setCell(invoice, [wrongSide]), 404);
      const good = await setCell(invoice, [client]);
      assert.ok(
        good.ok,
        `pointing at the named collection is allowed, got ${good.status}`,
      );

      // And the edge is projected, which is what makes the other side one
      // indexed lookup — from a table that has been there since 0001_init.
      const edges = await db.query<{ to_page_id: string }>(
        `SELECT to_page_id FROM page_relations WHERE from_page_id = $1`,
        [invoice],
      );
      assert.deepEqual(
        edges.rows.map((row) => row.to_page_id),
        [client],
      );
    });

    test('a rollup counts what points here, and refuses a rollup of a rollup', async () => {
      // The rule that removes cycles by construction: a rollup may aggregate a
      // stored field, never another derived one — so nothing downstream walks a
      // dependency graph or schedules a recomputation (ADR-0054).
      const session = await setup();
      const clients = await collectionOn(
        session,
        await create(session, 'Kunden 3', 'page', session.rootFolder),
      );
      const invoices = await collectionOn(
        session,
        await create(session, 'Rechnungen 3', 'page', session.rootFolder),
      );

      const link = await expectJson<{ id: string }>(
        await addField(session, invoices, {
          name: 'Kunde',
          fieldType: 'relation',
          config: { collectionId: clients },
        }),
        201,
      );

      // On the clients' side: how many invoices point at me.
      const count = await expectJson<{ id: string }>(
        await addField(session, clients, {
          name: 'Rechnungen',
          fieldType: 'rollup',
          config: { viaFieldId: link.id, aggregate: 'count' },
        }),
        201,
      );

      // A rollup over that rollup is refused rather than scheduled.
      await expectStatus(
        await addField(session, clients, {
          name: 'Unsinn',
          fieldType: 'rollup',
          config: { viaFieldId: link.id, aggregate: 'sum', fieldId: count.id },
        }),
        422,
      );

      // And the same refusal on the *update* path, which had no check at all:
      // pointing an existing rollup at another rollup was one PATCH away, so
      // the cycle rule held on one of two paths — which is not a rule.
      await expectStatus(
        await fetch(`${base}/api/collections/${clients}/fields/${count.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({
            config: { viaFieldId: link.id, aggregate: 'sum', fieldId: count.id },
          }),
        }),
        422,
      );

      // A relation that points somewhere else cannot be rolled up here either.
      await expectStatus(
        await addField(session, invoices, {
          name: 'Falsche Richtung',
          fieldType: 'rollup',
          config: { viaFieldId: link.id, aggregate: 'count' },
        }),
        422,
      );

      const acme = await addRow(session, clients, 'Acme');
      const first = await addRow(session, invoices, 'R-001');
      const second = await addRow(session, invoices, 'R-002');
      for (const invoice of [first, second]) {
        const res = await fetch(`${base}/api/pages/${invoice}/properties/${link.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ value: { kind: 'relation', pageIds: [acme] } }),
        });
        assert.ok(res.ok, `linking succeeded, got ${res.status}`);
      }

      const read = await expectJson<{
        rows: Array<{ id: string; derived: Record<string, { number?: number }> }>;
        // This suite passes the cookie inline; `auth(session)` is another
        // suite's helper, which I reached for from memory.
      }>(
        await fetch(`${base}/api/collections/${clients}`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );

      const row = read.rows.find((one) => one.id === acme);
      assert.equal(row?.derived[count.id]?.number, 2, 'two invoices point at Acme');
    });

    test("a row's page carries its own fields, and an ordinary page carries none", async () => {
      // A row opens as a page, and until this the page said nothing about the
      // row it is (ADR-0054).
      const session = await setup();
      const collectionId = await collectionOn(
        session,
        await create(session, 'Rechnungen 4', 'page', session.rootFolder),
      );
      const amount = await expectJson<{ id: string }>(
        await addField(session, collectionId, { name: 'Betrag', fieldType: 'number' }),
        201,
      );
      const rowId = await addRow(session, collectionId, 'R-100');

      await fetch(`${base}/api/pages/${rowId}/properties/${amount.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ value: { kind: 'number', value: 42 } }),
      });

      const mine = await expectJson<{
        collectionId: string | null;
        fields: Array<{ id: string; name: string }>;
        values: Record<string, { value?: number }>;
      }>(
        await fetch(`${base}/api/pages/${rowId}/properties`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );
      assert.equal(mine.collectionId, collectionId);
      assert.ok(
        mine.fields.some((field) => field.id === amount.id),
        'the collection´s columns',
      );
      assert.equal(mine.values[amount.id]?.value, 42, 'and this row´s value');

      // An ordinary page answers with an empty list rather than a 404: the panel
      // asks this of every page it opens, and "no fields" is the truthful
      // answer for most of them.
      const plain = await create(session, 'Nur eine Seite', 'page', session.rootFolder);
      const none = await expectJson<{ collectionId: string | null; fields: unknown[] }>(
        await fetch(`${base}/api/pages/${plain}/properties`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );
      assert.equal(none.collectionId, null);
      assert.deepEqual(none.fields, []);
    });

    test('a view can be sorted by a rollup', async () => {
      // Before this the sort vanished: a rollup has no shadow column, so
      // `columnFor` returned null and the whole sort was dropped without a word
      // — the view looked unsorted and nothing said why (ADR-0054).
      const session = await setup();
      const clients = await collectionOn(
        session,
        await create(session, 'Kunden 5', 'page', session.rootFolder),
      );
      const invoices = await collectionOn(
        session,
        await create(session, 'Rechnungen 5', 'page', session.rootFolder),
      );
      const link = await expectJson<{ id: string }>(
        await addField(session, invoices, {
          name: 'Kunde',
          fieldType: 'relation',
          config: { collectionId: clients },
        }),
        201,
      );
      const count = await expectJson<{ id: string }>(
        await addField(session, clients, {
          name: 'Rechnungen',
          fieldType: 'rollup',
          config: { viaFieldId: link.id, aggregate: 'count' },
        }),
        201,
      );

      const few = await addRow(session, clients, 'Wenig');
      const many = await addRow(session, clients, 'Viel');
      for (const [target, howMany] of [
        [few, 1],
        [many, 3],
      ] as const) {
        for (let n = 0; n < howMany; n += 1) {
          const invoice = await addRow(session, invoices, `R-${target.slice(0, 4)}-${n}`);
          await fetch(`${base}/api/pages/${invoice}/properties/${link.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', cookie: session.cookie },
            body: JSON.stringify({ value: { kind: 'relation', pageIds: [target] } }),
          });
        }
      }

      const view = await expectJson<{ views: Array<{ id: string }> }>(
        await fetch(`${base}/api/collections/${clients}`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );
      const viewId = view.views[0]!.id;
      await fetch(`${base}/api/collections/${clients}/views/${viewId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({
          // `sort`, not `sorts` — the key `readSorts` reads. Two guesses in one
          // test, and both failed the same way: a definition nobody reads and a
          // parameter nobody looks for both produce an unsorted list, which is
          // indistinguishable from a sort that ran and did nothing.
          definition: { sort: [{ fieldId: count.id, direction: 'desc' }] },
        }),
      });

      const sorted = await expectJson<{ rows: Array<{ id: string; title: string }> }>(
        // `view`, not `viewId` — the parameter the route reads. My first version
        // guessed, so the request named no view and the sort was never applied:
        // the test failed on an unsorted list rather than a wrong sort.
        await fetch(`${base}/api/collections/${clients}?view=${viewId}`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );
      assert.deepEqual(
        sorted.rows.map((row) => row.title),
        ['Viel', 'Wenig'],
        'most first',
      );
    });

    test('rows come a page at a time, and the cursor does not repeat one', async () => {
      // The route had no limit: every row with every cell on every load, which
      // measured at 7.1 MB of JSON for twenty thousand rows (ADR-0055).
      const session = await setup();
      const collectionId = await collectionOn(
        session,
        await create(session, 'Viele Zeilen', 'page', session.rootFolder),
      );
      for (let n = 0; n < 7; n += 1) await addRow(session, collectionId, `Z-${n}`);

      const page = (after?: string): Promise<Response> =>
        fetch(
          `${base}/api/collections/${collectionId}?limit=3${after ? `&after=${after}` : ''}`,
          { headers: { cookie: session.cookie } },
        );

      const seen: string[] = [];
      let cursor: string | null | undefined;
      for (let round = 0; round < 4; round += 1) {
        const body = await expectJson<{
          rows: Array<{ id: string; title: string }>;
          nextCursor: string | null;
        }>(await page(cursor ?? undefined), 200);
        assert.ok(body.rows.length <= 3, 'a page is at most what was asked for');
        seen.push(...body.rows.map((row) => row.title));
        cursor = body.nextCursor;
        if (!cursor) break;
      }

      // The count is of the whole filtered set, not of the page and not of
      // what is left: it has to mean the same thing on page one and page three
      // (ADR-0055).
      const first = await expectJson<{ total: number; totalIsExact: boolean }>(
        await page(),
        200,
      );
      assert.equal(first.total, 7);
      assert.equal(first.totalIsExact, true);

      // Every row once: a repeat or a gap is what an offset would have produced
      // and what the tiebreaker in the cursor exists to prevent.
      assert.deepEqual(seen, ['Z-0', 'Z-1', 'Z-2', 'Z-3', 'Z-4', 'Z-5', 'Z-6']);
      assert.equal(cursor, null, 'and it ends');
    });

    test('a formula column computes per row, and refuses to read a formula', async () => {
      // The rule that removes cycles by construction: a formula may read stored
      // fields and rollups, never another formula (ADR-0056).
      const session = await setup();
      const collectionId = await collectionOn(
        session,
        await create(session, 'Rechnungsposten', 'page', session.rootFolder),
      );
      const menge = await expectJson<{ id: string }>(
        await addField(session, collectionId, { name: 'Menge', fieldType: 'number' }),
        201,
      );
      const preis = await expectJson<{ id: string }>(
        await addField(session, collectionId, { name: 'Preis', fieldType: 'number' }),
        201,
      );
      const total = await expectJson<{ id: string }>(
        await addField(session, collectionId, {
          name: 'Summe',
          fieldType: 'formula',
          config: { formula: 'Menge * Preis' },
        }),
        201,
      );

      // A formula reading a formula is refused, so nothing downstream needs a
      // dependency graph.
      await expectStatus(
        await addField(session, collectionId, {
          name: 'Doppelt',
          fieldType: 'formula',
          config: { formula: 'Summe * 2' },
        }),
        422,
      );
      // And one that names a column nobody has.
      await expectStatus(
        await addField(session, collectionId, {
          name: 'Unsinn',
          fieldType: 'formula',
          config: { formula: 'Gewicht * 2' },
        }),
        422,
      );

      // Editing goes through the same check, or the cycle rule would hold only
      // when a column was created — the hole the rollup rule had (ADR-0056).
      await expectStatus(
        await fetch(`${base}/api/collections/${collectionId}/fields/${total.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ config: { formula: 'Summe + 1' } }),
        }),
        422,
      );
      // And a good edit is accepted, re-bound to the columns it names now.
      const edited = await fetch(
        `${base}/api/collections/${collectionId}/fields/${total.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ config: { formula: 'Menge * Preis' } }),
        },
      );
      assert.ok(edited.ok, `editing a formula is allowed, got ${edited.status}`);

      const filled = await addRow(session, collectionId, 'Mit Preis');
      const missing = await addRow(session, collectionId, 'Ohne Preis');
      const setCell = (rowId: string, fieldId: string, value: number): Promise<Response> =>
        fetch(`${base}/api/pages/${rowId}/properties/${fieldId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ value: { kind: 'number', value } }),
        });
      await setCell(filled, menge.id, 3);
      await setCell(filled, preis.id, 7);
      await setCell(missing, menge.id, 3);

      const read = await expectJson<{
        rows: Array<{ id: string; derived: Record<string, { number?: number | null }> }>;
      }>(
        await fetch(`${base}/api/collections/${collectionId}`, {
          headers: { cookie: session.cookie },
        }),
        200,
      );

      assert.equal(read.rows.find((row) => row.id === filled)?.derived[total.id]?.number, 21);
      // And the row with no price is empty, not zero: a total over a missing
      // value is empty rather than a number nobody should trust.
      assert.equal(read.rows.find((row) => row.id === missing)?.derived[total.id]?.number, null);
    });

    test('a page can hold a collection', async () => {
      // Content inside a page, not a folder wearing a different hat
      // (ADR-0021). "A folder should be a folder" was the report that led here.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const body = await read(session, collection);
      assert.equal(body.pageId, page);
      assert.equal(body.fields.length, 1, 'the title column');
      assert.equal(body.fields[0]!.id, body.titleFieldId);
    });

    test('a page can hold several collections', async () => {
      // What the folder shape could not do, and what Craft does.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);

      const first = await collectionOn(session, page);
      const second = await collectionOn(session, page);
      assert.notEqual(first, second);

      await fieldOf(session, first, { name: 'Only in the first', fieldType: 'text' });

      assert.equal((await read(session, first)).fields.length, 2);
      assert.equal(
        (await read(session, second)).fields.length,
        1,
        'the second is untouched',
      );
    });

    test('a folder can hold one too, and stays a folder', async () => {
      // Nothing stops it — a folder is a document like any other. What has
      // changed is that adding columns no longer *converts* it.
      const session = await setup();
      const folder = await create(session, 'A folder', 'folder', session.rootFolder);
      await collectionOn(session, folder);

      const row = await db.query<{ kind: string; collection_id: string | null }>(
        `SELECT kind, collection_id FROM pages WHERE id = $1`,
        [folder],
      );
      assert.equal(row.rows[0]?.kind, 'folder', 'still a folder');
      assert.equal(
        row.rows[0]?.collection_id,
        null,
        'holding a collection is not being one',
      );
    });

    test('a row cannot hold a collection', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const row = await addRow(session, collection, 'A record');

      const res = await fetch(`${base}/api/pages/${row}/collections`, {
        method: 'POST',
        headers: { cookie: session.cookie },
      });
      assert.equal(res.status, 409);
    });

    // --- rows ----------------------------------------------------------------

    test('rows do not appear in the tree', async () => {
      // The part of the folder shape that felt most wrong: a hundred-row table
      // put a hundred entries in the sidebar.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const row = await addRow(session, collection, 'A record');

      const ids = await treeIds(session);
      assert.ok(ids.includes(page), 'the page is there');
      assert.ok(!ids.includes(row), 'and the row is not');
    });

    test('a row is a real document, openable like a page', async () => {
      // The reason rows are documents at all (ADR-0021): each one can hold its
      // own writing.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const row = await addRow(session, collection, 'A record');

      const res = await fetch(`${base}/api/pages/${row}`, {
        headers: { cookie: session.cookie },
      });
      const body = await expectJson<{ id: string; title: string }>(res);
      assert.equal(body.id, row);
      assert.equal(body.title, 'A record');
    });

    test('a row belongs to its collection and sits inside the page', async () => {
      // Ancestry is what permissions and sharing are computed from, so a row
      // has to be inside the page it appears in.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const row = await addRow(session, collection, 'A record');

      const stored = await db.query<{
        kind: string;
        collection_id: string;
        parent_page_id: string;
      }>(`SELECT kind, collection_id, parent_page_id FROM pages WHERE id = $1`, [row]);

      assert.equal(stored.rows[0]?.kind, 'row');
      assert.equal(stored.rows[0]?.collection_id, collection);
      assert.equal(stored.rows[0]?.parent_page_id, page);
    });

    test('rows of one collection do not leak into another on the same page', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const first = await collectionOn(session, page);
      const second = await collectionOn(session, page);

      await addRow(session, first, 'Mine');

      assert.equal((await read(session, first)).rows.length, 1);
      assert.deepEqual((await read(session, second)).rows, []);
    });

    test('a row is not reported as a misplaced entry', async () => {
      // pages_inside_pages flags children whose parent is not a folder, which
      // before ADR-0021 could only mean a client wrote one directly. A row
      // lives inside the page holding its collection by design — and every one
      // was being reported, so the maintenance job logged the count every five
      // minutes.
      //
      // A check that reports correct data teaches people to ignore it, and the
      // next real violation goes unnoticed among the false ones.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      await addRow(session, collection, 'A record');

      const flagged = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pages_inside_pages`,
      );
      assert.equal(flagged.rows[0]?.n, 0);
    });

    test('a page inside a page is still reported', async () => {
      // The check has to keep working for what it was built for.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids)
         VALUES (gen_random_uuid(), $1, $2, 'Wrongly placed', 'a0', 'page', '{}')`,
        [session.workspaceId, page],
      );

      const flagged = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pages_inside_pages`,
      );
      assert.equal(flagged.rows[0]?.n, 1);
    });

    test('an archived row leaves the table', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const row = await addRow(session, collection, 'Gone');

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [row]);
      assert.deepEqual((await read(session, collection)).rows, []);
    });

    // --- columns -------------------------------------------------------------

    test('a column is added and projected', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const field = await fieldOf(session, collection, {
        name: 'Status',
        fieldType: 'select',
      });
      const body = await read(session, collection);
      assert.equal(body.fields.find((entry) => entry.id === field)?.name, 'Status');
    });

    test('columns survive a rebuild, because they live in the document', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      await fieldOf(session, collection, { name: 'Status', fieldType: 'select' });

      await db.query(`DELETE FROM collection_fields`);
      const { rebuild } = await import('../src/materialize/rebuild.js');
      await rebuild(db, { workspaceId: session.workspaceId, log: () => {} });

      assert.equal((await read(session, collection)).fields.length, 2);
    });

    test('a removed column disappears from the projection', async () => {
      // It did not once: a Yjs deletion does not advance the state vector, so
      // the write reported "nothing changed" and no materialisation ran.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Doomed',
        fieldType: 'text',
      });

      await expectStatus(
        await fetch(`${base}/api/collections/${collection}/fields/${field}`, {
          method: 'DELETE',
          headers: { cookie: session.cookie },
        }),
        200,
      );

      assert.deepEqual(
        (await read(session, collection)).fields.map((entry) => entry.name),
        ['Name'],
      );
    });

    test('the title column cannot be removed', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const body = await read(session, collection);

      const res = await fetch(
        `${base}/api/collections/${collection}/fields/${body.titleFieldId}`,
        { method: 'DELETE', headers: { cookie: session.cookie } },
      );
      assert.equal(res.status, 409);
    });

    test('a field type that cannot be filled yet is refused', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      for (const fieldType of ['relation', 'formula', 'rollup', 'nonsense']) {
        assert.equal(
          (await addField(session, collection, { name: 'X', fieldType })).status,
          422,
          fieldType,
        );
      }
    });

    // --- values --------------------------------------------------------------

    test('a value is stored on the row and read back', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Notes',
        fieldType: 'text',
      });
      const row = await addRow(session, collection, 'A record');

      await expectStatus(
        await setValue(session, row, field, { kind: 'text', value: 'hello' }),
        200,
      );

      const body = await read(session, collection);
      assert.deepEqual(body.rows[0]!.values[field], { kind: 'text', value: 'hello' });
    });

    test('the typed shadow columns are filled, which is what sorting uses', async () => {
      // They were not, once: the materialiser looked for a row's collection on
      // the row's own document, where nothing wrote it.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Count',
        fieldType: 'number',
      });
      const row = await addRow(session, collection, 'A record');
      await setValue(session, row, field, { kind: 'number', value: 42 });

      const stored = await db.query<{ number_value: number | null }>(
        `SELECT number_value FROM page_properties WHERE page_id = $1`,
        [row],
      );
      assert.equal(stored.rows[0]?.number_value, 42);
    });

    test('a value for a field of another collection is refused', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const mine = await collectionOn(session, page);
      const theirs = await collectionOn(session, page);
      const foreign = await fieldOf(session, theirs, {
        name: 'Theirs',
        fieldType: 'text',
      });
      const row = await addRow(session, mine, 'A record');

      const res = await setValue(session, row, foreign, { kind: 'text', value: 'x' });
      assert.equal(res.status, 404);
    });

    // --- select options ------------------------------------------------------

    test('options are stored and come back through the projection', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Status',
        fieldType: 'select',
      });

      await expectStatus(
        await setOptionsFor(session, collection, field, [
          { id: 'o1', name: 'Todo', color: 'grey' },
        ]),
        200,
      );

      const body = await read(session, collection);
      assert.deepEqual(body.fields.find((entry) => entry.id === field)?.config['options'], [
        { id: 'o1', name: 'Todo', color: 'grey' },
      ]);
    });

    test('a select value must name an option that exists', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Status',
        fieldType: 'select',
      });
      const row = await addRow(session, collection, 'A record');
      await setOptionsFor(session, collection, field, [{ id: 'o1', name: 'Todo' }]);

      await expectStatus(
        await setValue(session, row, field, { kind: 'select', optionId: 'o1' }),
        200,
      );
      assert.equal(
        (await setValue(session, row, field, { kind: 'select', optionId: 'nope' })).status,
        422,
      );
    });

    test('an option removed later does not erase the rows pointing at it', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Status',
        fieldType: 'select',
      });
      const row = await addRow(session, collection, 'A record');
      await setOptionsFor(session, collection, field, [{ id: 'o1', name: 'Todo' }]);
      await setValue(session, row, field, { kind: 'select', optionId: 'o1' });

      await expectStatus(await setOptionsFor(session, collection, field, []), 200);

      const stored = await db.query<{ value: { optionId?: string } }>(
        `SELECT value FROM page_properties WHERE page_id = $1`,
        [row],
      );
      assert.equal(stored.rows[0]?.value.optionId, 'o1');
    });

    // --- views, filtering and sorting ----------------------------------------

    test('a new collection has one table view', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const body = await read(session, collection);
      assert.equal(body.views.length, 1);
      assert.equal(body.views[0]?.viewType, 'table');
    });

    test('a view sorts numerically, and unanswered rows come last', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Count',
        fieldType: 'number',
      });

      for (const [title, value] of [
        ['nine', 9],
        ['ten', 10],
        ['two', 2],
      ] as Array<[string, number]>) {
        const row = await addRow(session, collection, title);
        await expectStatus(await setValue(session, row, field, { kind: 'number', value }), 200);
      }
      await addRow(session, collection, 'unset');

      const view = await expectJson<{ id: string }>(
        await addView(session, collection, { sort: [{ fieldId: field, direction: 'asc' }] }),
        201,
      );

      const body = await read(session, collection, view.id);
      assert.deepEqual(
        body.rows.map((row) => row.title),
        ['two', 'nine', 'ten', 'unset'],
      );
    });

    test('a view filters, and a stale filter still renders the collection', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Count',
        fieldType: 'number',
      });

      for (const [title, value] of [
        ['big', 10],
        ['small', 2],
      ] as Array<[string, number]>) {
        const row = await addRow(session, collection, title);
        await setValue(session, row, field, { kind: 'number', value });
      }

      const view = await expectJson<{ id: string }>(
        await addView(session, collection, {
          filters: [{ fieldId: field, operator: 'gte', value: 9 }],
        }),
        201,
      );
      assert.deepEqual(
        (await read(session, collection, view.id)).rows.map((row) => row.title),
        ['big'],
      );

      // The column goes; the view still names it.
      await fetch(`${base}/api/collections/${collection}/fields/${field}`, {
        method: 'DELETE',
        headers: { cookie: session.cookie },
      });
      assert.equal(
        (await read(session, collection, view.id)).rows.length,
        2,
        'unfiltered rather than unreachable',
      );
    });

    test('a view\'s rules can be changed, and take effect', async () => {
      // The query side was built and tested with no way to reach it: the rules
      // could only be set when the view was created. A half-feature looks
      // finished from the outside, which is worse than none.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Count',
        fieldType: 'number',
      });

      for (const [title, value] of [
        ['big', 10],
        ['small', 2],
      ] as Array<[string, number]>) {
        const row = await addRow(session, collection, title);
        await setValue(session, row, field, { kind: 'number', value });
      }

      const view = (await read(session, collection)).views[0]!;
      assert.deepEqual(view.definition, {}, 'no rules to begin with');

      await expectStatus(
        await fetch(`${base}/api/collections/${collection}/views/${view.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({
            definition: { filters: [{ fieldId: field, operator: 'gte', value: 9 }] },
          }),
        }),
        200,
      );

      assert.deepEqual(
        (await read(session, collection, view.id)).rows.map((row) => row.title),
        ['big'],
      );
    });

    test('clearing the rules shows every row again', async () => {
      // The definition is replaced rather than merged: removing the last filter
      // has to mean "no filters", and a merge cannot say that.
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Count',
        fieldType: 'number',
      });
      const row = await addRow(session, collection, 'only');
      await setValue(session, row, field, { kind: 'number', value: 1 });

      const view = (await read(session, collection)).views[0]!;
      const patch = (definition: Record<string, unknown>): Promise<Response> =>
        fetch(`${base}/api/collections/${collection}/views/${view.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ definition }),
        });

      await patch({ filters: [{ fieldId: field, operator: 'gte', value: 9 }] });
      assert.equal((await read(session, collection, view.id)).rows.length, 0);

      await patch({});
      assert.equal((await read(session, collection, view.id)).rows.length, 1);
    });

    test('a view that does not exist is refused', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const res = await fetch(
        `${base}/api/collections/${collection}/views/not-a-view`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ definition: {} }),
        },
      );
      assert.equal(res.status, 404);
    });

    // --- searching within a collection --------------------------------------

    async function searchable(session: Session): Promise<{
      collection: string;
      field: string;
    }> {
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Note',
        fieldType: 'text',
      });

      for (const [title, note] of [
        ['Planning meeting', 'agenda for Tuesday'],
        ['Grocery list', 'milk and bread'],
        ['Unplanned outage', 'the disk filled up'],
      ] as Array<[string, string]>) {
        const row = await addRow(session, collection, title);
        await setValue(session, row, field, { kind: 'text', value: note });
      }
      return { collection, field };
    }

    const search = async (
      session: Session,
      collectionId: string,
      query: string,
    ): Promise<string[]> => {
      const res = await fetch(
        `${base}/api/collections/${collectionId}?q=${encodeURIComponent(query)}`,
        { headers: { cookie: session.cookie } },
      );
      const body = await expectJson<{ rows: Array<{ title: string }> }>(res);
      return body.rows.map((row) => row.title).sort();
    };

    test('searching matches a row title', async () => {
      const session = await setup();
      const { collection } = await searchable(session);
      assert.deepEqual(await search(session, collection, 'grocery'), ['Grocery list']);
    });

    test('searching matches a value in a cell', async () => {
      // The point of searching a table rather than the workspace: what somebody
      // is looking for is usually in a cell, not in the row's own writing.
      const session = await setup();
      const { collection } = await searchable(session);
      assert.deepEqual(await search(session, collection, 'bread'), ['Grocery list']);
    });

    test('searching is substring, not stemming', async () => {
      // A person typing into a table's search box expects "plan" to find
      // "planning" and "unplanned" alike. A language index deliberately would
      // not, which is why this is not the workspace search.
      const session = await setup();
      const { collection } = await searchable(session);
      assert.deepEqual(await search(session, collection, 'plan'), [
        'Planning meeting',
        'Unplanned outage',
      ]);
    });

    test('a wildcard in the query stays a character', async () => {
      // Otherwise searching for "%" returns everything.
      const session = await setup();
      const { collection } = await searchable(session);
      assert.deepEqual(await search(session, collection, '%'), []);
    });

    test('an empty query changes nothing', async () => {
      const session = await setup();
      const { collection } = await searchable(session);
      assert.equal((await search(session, collection, '   ')).length, 3);
    });

    test('searching and filtering apply together', async () => {
      // They are one query, so a search inside a filtered view narrows what the
      // view already showed rather than replacing it.
      const session = await setup();
      const { collection, field } = await searchable(session);

      const view = await expectJson<{ id: string }>(
        await addView(session, collection, {
          filters: [{ fieldId: field, operator: 'contains', value: 'the disk' }],
        }),
        201,
      );

      const res = await fetch(
        `${base}/api/collections/${collection}?view=${view.id}&q=plan`,
        { headers: { cookie: session.cookie } },
      );
      const body = await expectJson<{ rows: Array<{ title: string }> }>(res);
      assert.deepEqual(
        body.rows.map((row) => row.title),
        ['Unplanned outage'],
        'both narrow, neither replaces the other',
      );
    });

    test('a hostile search value is a value, not SQL', async () => {
      const session = await setup();
      const { collection } = await searchable(session);
      assert.deepEqual(await search(session, collection, "x'; DROP TABLE pages; --"), []);

      const still = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pages`);
      assert.ok(still.rows[0]!.n > 0, 'pages still exist');
    });

    test('a hostile filter value is a value, not SQL', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Note',
        fieldType: 'text',
      });
      await addRow(session, collection, 'A record');

      const view = await expectJson<{ id: string }>(
        await addView(session, collection, {
          filters: [{ fieldId: field, operator: 'is', value: "x'; DROP TABLE pages; --" }],
        }),
        201,
      );

      assert.deepEqual((await read(session, collection, view.id)).rows, []);
      const still = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pages`);
      assert.ok(still.rows[0]!.n > 0, 'pages still exist');
    });

    // --- access --------------------------------------------------------------

    test('a viewer can read but not change a collection', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const hash = await hashPassword(PASSWORD);
      const guest = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash, is_guest)
         VALUES ('v@example.org','V',$1,true) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
        [session.workspaceId, guest.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
         VALUES ($1,$2,'viewer',true,$3)`,
        [page, guest.rows[0]!.id, session.userId],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'v@example.org', password: PASSWORD }),
      );
      const cookie = cookieFrom(login);

      await expectStatus(
        await fetch(`${base}/api/collections/${collection}`, { headers: { cookie } }),
        200,
      );
      assert.equal(
        (
          await fetch(`${base}/api/collections/${collection}/fields`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ name: 'Sneaky', fieldType: 'text' }),
          })
        ).status,
        403,
      );
    });

    test('somebody outside the workspace sees nothing', async () => {
      const session = await setup();
      const page = await create(session, 'Notes', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('out@example.org','O',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'out@example.org', password: PASSWORD }),
      );

      assert.equal(
        (
          await fetch(`${base}/api/collections/${collection}`, {
            headers: { cookie: cookieFrom(login) },
          })
        ).status,
        404,
      );
    });

    // --- pasting a grid, and emptying the table (ADR-0034) -----------------

    const bulk = (
      session: Session,
      collectionId: string,
      rows: unknown[],
    ): Promise<Response> =>
      fetch(`${base}/api/collections/${collectionId}/rows/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ rows }),
      });

    test('a grid arrives as rows in the order it was pasted', async () => {
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const pin = await fieldOf(session, collection, { name: 'PIN', fieldType: 'text' });

      await expectStatus(
        await bulk(session, collection, [
          { title: 'Barthel', values: { [pin]: { kind: 'text', value: '4516-0007' } } },
          { title: 'Eck', values: { [pin]: { kind: 'text', value: '4084-0580' } } },
        ]),
        201,
      );

      const body = await read(session, collection);
      assert.deepEqual(
        body.rows.map((row) => row.title),
        ['Barthel', 'Eck'],
      );
      assert.deepEqual(body.rows[0]!.values[pin], { kind: 'text', value: '4516-0007' });
    });

    test('a second paste is appended, not written over the first', async () => {
      // The one thing asked for that Craft does not do: the cap is a limit on an
      // operation, so pasting twice is how somebody gets past it.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      await expectStatus(await bulk(session, collection, [{ title: 'one' }]), 201);
      await expectStatus(
        await bulk(session, collection, [{ title: 'two' }, { title: 'three' }]),
        201,
      );

      assert.deepEqual(
        (await read(session, collection)).rows.map((row) => row.title),
        ['one', 'two', 'three'],
      );
    });

    test('a row and its values are one write, so no row is briefly empty', async () => {
      // Two writes would mean a row that exists and is blank for as long as the
      // second takes — and if the second fails, permanently.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const pin = await fieldOf(session, collection, { name: 'PIN', fieldType: 'text' });

      const created = await expectJson<{ created: string[] }>(
        await bulk(session, collection, [
          { title: 'Once', values: { [pin]: { kind: 'text', value: '1' } } },
        ]),
        201,
      );

      // Read from the documents rather than the projection: the projection could
      // agree with a write that never reached the CRDT (ADR-0002).
      const updates = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM doc_updates WHERE doc_id = $1`,
        [created.created[0]],
      );
      assert.equal(updates.rows[0]?.n, 1, 'one update, not two');
    });

    test('more than fifty rows is refused rather than trimmed', async () => {
      // The interface trims and says what it left. A route that silently dropped
      // rows would be a much worse thing for anything else calling it.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const rows = Array.from({ length: 51 }, (_, at) => ({ title: `row ${at}` }));
      const res = await bulk(session, collection, rows);
      const body = await expectJson<{ error: string }>(res, 422);
      assert.equal(body.error, 'too_many_rows');
      assert.equal((await read(session, collection)).rows.length, 0, 'nothing was written');
    });

    test('a field from another collection is refused before anything is written', async () => {
      // Finding that out after twenty rows exist is how a paste becomes a
      // cleanup job.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const first = await collectionOn(session, page);
      const second = await collectionOn(session, page);
      const foreign = await fieldOf(session, second, { name: 'Elsewhere', fieldType: 'text' });

      const res = await bulk(session, first, [
        { title: 'a' },
        { title: 'b', values: { [foreign]: { kind: 'text', value: 'x' } } },
      ]);
      await expectStatus(res, 404);
      assert.equal((await read(session, first)).rows.length, 0, 'including the first row');
    });

    test('emptying the table archives its rows rather than deleting them', async () => {
      // A row is a page, so this fills the trash — which is what makes it
      // reversible.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      await expectStatus(
        await bulk(session, collection, [{ title: 'one' }, { title: 'two' }]),
        201,
      );

      const cleared = await expectJson<{ archived: string[] }>(
        await fetch(`${base}/api/collections/${collection}/rows`, {
          method: 'DELETE',
          headers: { cookie: session.cookie },
        }),
        200,
      );
      assert.equal(cleared.archived.length, 2);
      assert.equal((await read(session, collection)).rows.length, 0);

      // Still there, archived, and restorable.
      const rows = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pages
          WHERE collection_id = $1 AND archived_at IS NOT NULL`,
        [collection],
      );
      assert.equal(rows.rows[0]?.n, 2);

      for (const rowId of cleared.archived) {
        await expectStatus(
          await fetch(`${base}/api/pages/${rowId}/restore`, {
            method: 'POST',
            headers: { cookie: session.cookie },
          }),
          200,
        );
      }
      assert.equal((await read(session, collection)).rows.length, 2, 'undo puts them back');
    });

    test('somebody who may only read cannot paste or empty', async () => {
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);

      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('reader@example.org','R',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'reader@example.org', password: PASSWORD }),
      );
      const outsider: Session = {
        ...session,
        cookie: cookieFrom(login),
      };

      assert.equal((await bulk(outsider, collection, [{ title: 'x' }])).status, 404);
      assert.equal(
        (
          await fetch(`${base}/api/collections/${collection}/rows`, {
            method: 'DELETE',
            headers: { cookie: outsider.cookie },
          })
        ).status,
        404,
      );
    });

    // --- a files column (ADR-0035) -----------------------------------------

    test('a files column can be created, and holds file ids', async () => {
      // One column type for every kind of file. The model has had `files` since
      // the first migration; only the interface never offered it.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, {
        name: 'Attachments',
        fieldType: 'files',
      });
      const row = await addRow(session, collection, 'Entry');

      const upload = await db.query<{ id: string }>(
        `INSERT INTO files (workspace_id, page_id, filename, mime_type, size_bytes, sha256, storage_key)
         VALUES ($1, $2, 'plan.pdf', 'application/pdf', 1024, '\\x00', 'k1') RETURNING id`,
        [session.workspaceId, row],
      );
      const fileId = upload.rows[0]!.id;

      await expectStatus(
        await setValue(session, row, field, { kind: 'files', fileIds: [fileId] }),
        200,
      );

      const body = await read(session, collection);
      assert.deepEqual(body.rows[0]!.values[field], { kind: 'files', fileIds: [fileId] });
    });

    test('the collection says what its files are, once for the table', async () => {
      // A cell stores ids: a name and a size are the file's own facts, and a copy
      // in every cell is how a renamed file keeps its old name in three places.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, { name: 'Files', fieldType: 'files' });
      const row = await addRow(session, collection, 'Entry');

      const upload = await db.query<{ id: string }>(
        `INSERT INTO files (workspace_id, page_id, filename, mime_type, size_bytes, sha256, storage_key)
         VALUES ($1, $2, 'photo.png', 'image/png', 2048, '\\x00', 'k2') RETURNING id`,
        [session.workspaceId, row],
      );
      await expectStatus(
        await setValue(session, row, field, { kind: 'files', fileIds: [upload.rows[0]!.id] }),
        200,
      );

      const body = await expectJson<{
        files: Array<{ id: string; filename: string; category: string }>;
      }>(
        await fetch(`${base}/api/collections/${collection}`, {
          headers: { cookie: session.cookie },
        }),
      );
      assert.equal(body.files.length, 1);
      assert.equal(body.files[0]!.filename, 'photo.png');
      // The category comes from the mime type, which is the server's answer to
      // "what kind of file is this" — the column does not need to declare it.
      assert.equal(body.files[0]!.category, 'image');
    });

    test('a cell cannot name a file that does not exist here', async () => {
      // A chip nobody can open is the least of it: an id from another workspace
      // would be the thing that leaks a filename.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, { name: 'Files', fieldType: 'files' });
      const row = await addRow(session, collection, 'Entry');

      const res = await setValue(session, row, field, {
        kind: 'files',
        fileIds: ['00000000-0000-4000-8000-000000000009'],
      });
      const body = await expectJson<{ error: string }>(res, 404);
      assert.equal(body.error, 'file_not_found');
    });

    test('a cell is a cell: eight files at most', async () => {
      // Somebody with twenty documents about one entry has a page to put them
      // on, which is what a row being a page is for.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const field = await fieldOf(session, collection, { name: 'Files', fieldType: 'files' });
      const row = await addRow(session, collection, 'Entry');

      const made: string[] = [];
      for (let at = 0; at < 9; at++) {
        const upload = await db.query<{ id: string }>(
          `INSERT INTO files (workspace_id, page_id, filename, mime_type, size_bytes, sha256, storage_key)
           VALUES ($1, $2, $3, 'text/plain', 10, '\\x00', $4) RETURNING id`,
          [session.workspaceId, row, `f${at}.txt`, `key-${at}`],
        );
        made.push(upload.rows[0]!.id);
      }

      const body = await expectJson<{ error: string }>(
        await setValue(session, row, field, { kind: 'files', fileIds: made }),
        422,
      );
      assert.equal(body.error, 'too_many_files');
    });

    // --- archiving a selection (ADR-0040) -----------------------------------

    test('named rows go to the trash, and the rest stay', async () => {
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const keep = await addRow(session, collection, 'Keep');
      const goA = await addRow(session, collection, 'Go A');
      const goB = await addRow(session, collection, 'Go B');

      const res = await fetch(`${base}/api/collections/${collection}/rows/archive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ rowIds: [goA, goB] }),
      });
      const body = await expectJson<{ archived: string[] }>(res, 200);
      assert.deepEqual(body.archived.sort(), [goA, goB].sort());

      const left = await read(session, collection);
      assert.deepEqual(
        left.rows.map((row) => row.id),
        [keep],
      );

      // Archived, not deleted: a row is a page, so it is in the trash.
      const archived = await db.query<{ archived_at: string | null }>(
        `SELECT archived_at FROM pages WHERE id = ANY($1::uuid[])`,
        [[goA, goB]],
      );
      for (const row of archived.rows) assert.notEqual(row.archived_at, null);
    });

    test('an id from another table archives nothing', async () => {
      // Bounded in the statement rather than checked first, so an id from
      // elsewhere simply matches no row.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const mine = await addRow(session, collection, 'Mine');

      const other = await create(session, 'Other', 'page', session.rootFolder);
      const otherCollection = await collectionOn(session, other);
      const theirs = await addRow(session, otherCollection, 'Theirs');

      const body = await expectJson<{ archived: string[] }>(
        await fetch(`${base}/api/collections/${collection}/rows/archive`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ rowIds: [theirs] }),
        }),
        200,
      );
      assert.deepEqual(body.archived, []);

      const still = await read(session, otherCollection);
      assert.deepEqual(
        still.rows.map((row) => row.id),
        [theirs],
      );
      assert.equal((await read(session, collection)).rows[0]?.id, mine);
    });

    test('an empty list is refused rather than treated as "all"', async () => {
      // The route that empties a table takes no ids at all; this one must not
      // become a second way to reach it by accident.
      const session = await setup();
      const page = await create(session, 'People', 'page', session.rootFolder);
      const collection = await collectionOn(session, page);
      const row = await addRow(session, collection, 'Still here');

      const body = await expectJson<{ error: string }>(
        await fetch(`${base}/api/collections/${collection}/rows/archive`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ rowIds: [] }),
        }),
        422,
      );
      assert.equal(body.error, 'rows_required');
      assert.equal((await read(session, collection)).rows[0]?.id, row);
    });
  },
);
