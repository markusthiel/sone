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
  },
);
