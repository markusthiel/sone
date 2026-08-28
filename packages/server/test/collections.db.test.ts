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

    const makeCollection = (session: Session, pageId: string): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/collection`, {
        method: 'POST',
        headers: { cookie: session.cookie },
      });

    const read = async (session: Session, pageId: string) =>
      expectJson<{
        titleFieldId: string;
        fields: Array<{
          id: string;
          name: string;
          fieldType: string;
          config?: Record<string, unknown>;
        }>;
        rows: Array<{ id: string; title: string; values: Record<string, unknown> }>;
      }>(
        await fetch(`${base}/api/pages/${pageId}/collection`, {
          headers: { cookie: session.cookie },
        }),
      );

    const addField = (
      session: Session,
      pageId: string,
      body: Record<string, unknown>,
    ): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/collection/fields`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify(body),
      });

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

    // --- creating ----------------------------------------------------------

    test('a folder can become a collection, with a title field', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);

      await expectStatus(await makeCollection(session, folder), 201);
      const body = await read(session, folder);

      assert.equal(body.fields.length, 1);
      assert.equal(body.fields[0]!.id, body.titleFieldId);
    });

    test('a page cannot become a collection', async () => {
      // A collection's rows are the entries inside it, and a page holds
      // nothing (ADR-0019).
      const session = await setup();
      const page = await create(session, 'A page', 'page', session.rootFolder);

      const res = await makeCollection(session, page);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: 'collections_need_a_folder' });
    });

    test('making a collection twice does not reset it', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      await addField(session, folder, { name: 'Status', fieldType: 'select' });

      await expectStatus(await makeCollection(session, folder), 201);
      const body = await read(session, folder);
      assert.equal(body.fields.length, 2, 'the added column survives');
    });

    test('a folder that is not a collection reads as one', async () => {
      const session = await setup();
      const folder = await create(session, 'Ordinary', 'folder', session.rootFolder);
      const res = await fetch(`${base}/api/pages/${folder}/collection`, {
        headers: { cookie: session.cookie },
      });
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: 'not_a_collection' });
    });

    // --- fields ------------------------------------------------------------

    test('a column is added and projected', async () => {
      // The write goes to the document; this read comes from the projection.
      // If the two were not connected, this would pass on the write and fail
      // here.
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);

      const created = await expectJson<{ id: string }>(
        await addField(session, folder, { name: 'Status', fieldType: 'select' }),
        201,
      );

      const body = await read(session, folder);
      const field = body.fields.find((entry) => entry.id === created.id);
      assert.equal(field?.name, 'Status');
      assert.equal(field?.fieldType, 'select');
    });

    test('a column survives a rebuild, because it lives in the document', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      await addField(session, folder, { name: 'Status', fieldType: 'select' });

      await db.query(`DELETE FROM collection_fields`);
      const { rebuild } = await import('../src/materialize/rebuild.js');
      await rebuild(db, { workspaceId: session.workspaceId, log: () => {} });

      const body = await read(session, folder);
      assert.equal(body.fields.length, 2, 'restored from the document');
    });

    test('a field type that cannot be filled yet is refused', async () => {
      // Offering a column nobody can put anything in is worse than not
      // offering it.
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);

      for (const fieldType of ['relation', 'formula', 'rollup', 'nonsense']) {
        const res = await addField(session, folder, { name: 'X', fieldType });
        assert.equal(res.status, 422, fieldType);
      }
    });

    test('the title column cannot be removed', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const body = await read(session, folder);

      const res = await fetch(
        `${base}/api/pages/${folder}/collection/fields/${body.titleFieldId}`,
        { method: 'DELETE', headers: { cookie: session.cookie } },
      );
      assert.equal(res.status, 409);
    });

    test('a column can be renamed', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const created = await expectJson<{ id: string }>(
        await addField(session, folder, { name: 'Old', fieldType: 'text' }),
        201,
      );

      await expectStatus(
        await fetch(`${base}/api/pages/${folder}/collection/fields/${created.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ name: 'New' }),
        }),
        200,
      );

      const body = await read(session, folder);
      assert.equal(body.fields.find((f) => f.id === created.id)?.name, 'New');
    });

    // --- rows and values ---------------------------------------------------

    test('entries in the folder are the rows', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const first = await create(session, 'First task', 'page', folder);
      await create(session, 'Second task', 'page', folder);

      const body = await read(session, folder);
      assert.equal(body.rows.length, 2);
      assert.equal(body.rows[0]!.id, first);
      assert.equal(body.rows[0]!.title, 'First task');
    });

    test('an archived row does not appear', async () => {
      // A table that shows deleted rows is a table nobody trusts.
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const row = await create(session, 'Gone', 'page', folder);

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [row]);
      assert.deepEqual((await read(session, folder)).rows, []);
    });

    test('a value is stored and read back', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const field = await expectJson<{ id: string }>(
        await addField(session, folder, { name: 'Notes', fieldType: 'text' }),
        201,
      );
      const row = await create(session, 'A task', 'page', folder);

      await expectStatus(
        await setValue(session, row, field.id, { kind: 'text', value: 'hello' }),
        200,
      );

      const body = await read(session, folder);
      assert.deepEqual(body.rows[0]!.values[field.id], { kind: 'text', value: 'hello' });
    });

    test('a value follows its row out of the collection', async () => {
      // Values live on the row's document, which is what makes a row movable.
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      const elsewhere = await create(session, 'Elsewhere', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const field = await expectJson<{ id: string }>(
        await addField(session, folder, { name: 'Notes', fieldType: 'text' }),
        201,
      );
      const row = await create(session, 'A task', 'page', folder);
      await setValue(session, row, field.id, { kind: 'text', value: 'kept' });

      await fetch(`${base}/api/pages/${row}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ parentPageId: elsewhere }),
      });

      const stored = await db.query<{ value: unknown }>(
        `SELECT value FROM page_properties WHERE page_id = $1`,
        [row],
      );
      // The projection drops it, because the row is no longer in a collection
      // — but the document still has it, which is what "kept" means here.
      const { loadDoc } = await import('../src/doc/docStore.js');
      const { readPropertyValues } = await import('@sone/core');
      const loaded = await loadDoc(db, row);
      try {
        assert.deepEqual(readPropertyValues(loaded.doc).get(field.id), {
          kind: 'text',
          value: 'kept',
        });
      } finally {
        loaded.doc.destroy();
      }
      assert.ok(stored.rowCount !== null);
    });

    test('a value for a field of another collection is refused', async () => {
      // Otherwise a row accumulates values no view can show and nothing can
      // clean up.
      const session = await setup();
      const first = await create(session, 'First', 'folder', session.rootFolder);
      const second = await create(session, 'Second', 'folder', session.rootFolder);
      await makeCollection(session, first);
      await makeCollection(session, second);
      const foreign = await expectJson<{ id: string }>(
        await addField(session, second, { name: 'Theirs', fieldType: 'text' }),
        201,
      );
      const row = await create(session, 'A task', 'page', first);

      const res = await setValue(session, row, foreign.id, { kind: 'text', value: 'x' });
      assert.equal(res.status, 404);
    });

    // --- select options ----------------------------------------------------

    const setOptionsFor = (
      session: Session,
      pageId: string,
      fieldId: string,
      options: Array<{ id: string; name: string; color?: string }>,
    ): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/collection/fields/${fieldId}/options`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ options }),
      });

    async function selectColumn(session: Session): Promise<{
      folder: string;
      field: string;
      row: string;
    }> {
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const field = await expectJson<{ id: string }>(
        await addField(session, folder, { name: 'Status', fieldType: 'select' }),
        201,
      );
      const row = await create(session, 'A task', 'page', folder);
      return { folder, field: field.id, row };
    }

    test('options are stored and come back through the projection', async () => {
      // The write goes to the document; this read comes from
      // collection_fields.config. If the two were not connected the write would
      // report success and the column would have no options.
      const session = await setup();
      const { folder, field } = await selectColumn(session);

      await expectStatus(
        await setOptionsFor(session, folder, field, [
          { id: 'o1', name: 'Todo', color: 'grey' },
          { id: 'o2', name: 'Doing', color: 'blue' },
        ]),
        200,
      );

      const body = await read(session, folder);
      const column = body.fields.find((entry) => entry.id === field);
      assert.deepEqual(column?.config?.['options'], [
        { id: 'o1', name: 'Todo', color: 'grey' },
        { id: 'o2', name: 'Doing', color: 'blue' },
      ]);
    });

    test('a select value must name an option that exists', async () => {
      // Otherwise a cell comes to point at an option that was never there, and
      // no view can render it.
      const session = await setup();
      const { folder, field, row } = await selectColumn(session);
      await expectStatus(
        await setOptionsFor(session, folder, field, [
          { id: 'o1', name: 'Todo', color: 'grey' },
        ]),
        200,
      );

      await expectStatus(
        await setValue(session, row, field, { kind: 'select', optionId: 'o1' }),
        200,
      );

      const res = await setValue(session, row, field, {
        kind: 'select',
        optionId: 'never-existed',
      });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: 'unknown_option' });
    });

    test('an option removed later does not erase the rows pointing at it', async () => {
      // A row owns its values. Erasing them when an option is removed would
      // make one misclick in the option editor unrecoverable.
      const session = await setup();
      const { folder, field, row } = await selectColumn(session);
      await setOptionsFor(session, folder, field, [{ id: 'o1', name: 'Todo' }]);
      await setValue(session, row, field, { kind: 'select', optionId: 'o1' });

      await expectStatus(await setOptionsFor(session, folder, field, []), 200);

      const stored = await db.query<{ value: { optionId?: string } }>(
        `SELECT value FROM page_properties WHERE page_id = $1 AND field_id = $2`,
        [row, field],
      );
      assert.equal(stored.rows[0]?.value.optionId, 'o1', 'still there');
    });

    test('renaming an option keeps the value, because the id is kept', async () => {
      const session = await setup();
      const { folder, field, row } = await selectColumn(session);
      await setOptionsFor(session, folder, field, [{ id: 'o1', name: 'Todo' }]);
      await setValue(session, row, field, { kind: 'select', optionId: 'o1' });

      await setOptionsFor(session, folder, field, [
        { id: 'o1', name: 'To do', color: 'green' },
      ]);

      const body = await read(session, folder);
      assert.deepEqual(body.rows[0]!.values[field], { kind: 'select', optionId: 'o1' });
    });

    test('an option without an id is refused rather than given one', async () => {
      // Generating one here would break a rename: the client has to keep ids
      // stable, because a row's value points at an id.
      const session = await setup();
      const { folder, field } = await selectColumn(session);
      const res = await fetch(
        `${base}/api/pages/${folder}/collection/fields/${field}/options`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ options: [{ name: 'Todo' }] }),
        },
      );
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: 'option_needs_an_id' });
    });

    test('duplicate option ids are refused', async () => {
      const session = await setup();
      const { folder, field } = await selectColumn(session);
      const res = await setOptionsFor(session, folder, field, [
        { id: 'same', name: 'One' },
        { id: 'same', name: 'Two' },
      ]);
      assert.equal(res.status, 409);
    });

    test('options cannot be set on a column that has none', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);
      const field = await expectJson<{ id: string }>(
        await addField(session, folder, { name: 'Note', fieldType: 'text' }),
        201,
      );
      const res = await setOptionsFor(session, folder, field.id, [
        { id: 'o1', name: 'Todo' },
      ]);
      assert.equal(res.status, 409);
    });

    test('options survive a rebuild', async () => {
      const session = await setup();
      const { folder, field } = await selectColumn(session);
      await setOptionsFor(session, folder, field, [
        { id: 'o1', name: 'Todo', color: 'blue' },
      ]);

      await db.query(`UPDATE collection_fields SET config = '{}'::jsonb`);
      const { rebuild } = await import('../src/materialize/rebuild.js');
      await rebuild(db, { workspaceId: session.workspaceId, log: () => {} });

      const restored = await db.query<{ config: { options?: unknown[] } }>(
        `SELECT config FROM collection_fields WHERE id = $1`,
        [field],
      );
      assert.equal(restored.rows[0]?.config.options?.length, 1);
    });

    // --- access ------------------------------------------------------------

    test('a viewer can read but not change a collection', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);

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
        [folder, guest.rows[0]!.id, session.userId],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'v@example.org', password: PASSWORD }),
      );
      const cookie = cookieFrom(login);

      await expectStatus(
        await fetch(`${base}/api/pages/${folder}/collection`, { headers: { cookie } }),
        200,
      );

      const res = await fetch(`${base}/api/pages/${folder}/collection/fields`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Sneaky', fieldType: 'text' }),
      });
      assert.equal(res.status, 403);
    });

    test('somebody outside the workspace sees nothing', async () => {
      const session = await setup();
      const folder = await create(session, 'Tasks', 'folder', session.rootFolder);
      await makeCollection(session, folder);

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

      const res = await fetch(`${base}/api/pages/${folder}/collection`, {
        headers: { cookie: cookieFrom(login) },
      });
      assert.equal(res.status, 404);
    });
  },
);
