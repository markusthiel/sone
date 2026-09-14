import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { DOC_KEYS, PAGE_KEYS, META_KEYS, SCHEMA_VERSION } from '@sone/core';
import { getTestPool, closeTestPool, hasDatabase, seedWorkspace, addMember } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';
import { createSession } from '../src/auth/session.js';
import { Router } from '../src/http/router.js';
import { registerSoteRoutes } from '../src/integrations/sote.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { appendUpdate, loadDoc } from '../src/doc/docStore.js';
import { withTransaction } from '../src/db/pool.js';
test('personal SOTE grants, note scope and persisted references', { skip: !hasDatabase }, async (t) => {
    const pool = await getTestPool();
    t.after(closeTestPool);
    const fx = await seedWorkspace(pool);
    await pool.query('UPDATE users SET is_instance_admin=true WHERE id=$1', [fx.userId]);
    const project = randomUUID(), remoteWorkspace = randomUUID(), taskId = randomUUID(), clientId = randomUUID(), remoteUser = randomUUID();
    const privateTitle = 'Private task title from SOTE';
    const task = { id: taskId, projectId: project, title: privateTitle, revision: '2', note: '', planned: null, plannedAllDay: false, duration: 30, completed: null, priority: 4 };
    let writes = 0, lastBody: Record<string, unknown> = {}, challenge = '', remoteRevoked = false;
    const remote = createServer(async (req, res) => {
        const url = new URL(req.url!, 'http://localhost');
        let body = '';
        for await (const chunk of req)
            body += chunk;
        const input = body ? JSON.parse(body) : {};
        const send = (status: number, out: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); };
        if (url.pathname.endsWith('/token')) {
            assert.equal(input.client_id, clientId);
            assert.equal(input.client_secret, 'secret'.repeat(10));
            assert.equal(createHash('sha256').update(input.code_verifier).digest('base64url'), challenge);
            send(200, { access_token: 'personal-token'.repeat(5), expires_in: 3600, user_id: remoteUser });
            return;
        }
        assert.equal(req.headers.authorization, 'Bearer ' + 'personal-token'.repeat(5));
        if (url.pathname.endsWith('/revoke')) {
            remoteRevoked = true;
            send(200, { ok: true });
            return;
        }
        if (url.pathname.endsWith('/projects')) {
            send(200, { projects: [{ id: project, name: 'Tasks', workspaceId: remoteWorkspace, workspaceName: 'Team', writable: true, manageable: true }] });
            return;
        }
        if (req.method === 'POST' || req.method === 'PATCH') {
            writes++;
            lastBody = input;
            send(200, { task });
            return;
        }
        if (url.pathname.endsWith('/' + taskId)) {
            send(200, { task, writable: true });
            return;
        }
        send(200, { tasks: [task], next: null, writable: true });
    });
    await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => remote.close(() => resolve())));
    const remoteBase = 'http://127.0.0.1:' + (remote.address() as AddressInfo).port;
    const router = new Router();
    const server = createServer((req, res) => void router.handle(req, res, base).then(handled => { if (!handled)
        res.end(); }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    registerSoteRoutes(router, { pool, secretKey: 'integration-test-secret-with-sufficient-length', publicUrl: base });
    const owner = await createSession(pool, fx.userId), headers = { 'content-type': 'application/json', cookie: 'sone_session=' + owner.token };
    const root = base + '/api/integrations/sote';
    const request = (path: string, method = 'GET', body?: unknown, h: Record<string, string> = headers) => fetch(root + path, { method, headers: h, redirect: 'manual', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    await expectStatus(await request('', 'GET', undefined, {}), 401);
    await expectStatus(await request('/server', 'POST', { baseUrl: remoteBase, clientId, secret: 'secret'.repeat(10) }), 200);
    const start = await expectJson<{
        url: string;
    }>(await request('/connect', 'POST', {}));
    const auth = new URL(start.url);
    challenge = auth.searchParams.get('code_challenge')!;
    assert.equal(auth.origin, remoteBase);
    assert.equal(auth.searchParams.get('redirect_uri'), root + '/callback');
    const wrong = await request('/callback?state=wrong&code=test');
    assert.match(wrong.headers.get('location') ?? '', /sote_error/);
    const callback = await request('/callback?' + new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'test-code' }));
    assert.match(callback.headers.get('location') ?? '', /sote_connected/);
    const replay = await request('/callback?' + new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'test-code' }));
    assert.match(replay.headers.get('location') ?? '', /sote_error/);
    const account = await expectJson<{
        connected: boolean;
    }>(await request(''));
    assert.equal(account.connected, true);
    assert.ok(!JSON.stringify(account).includes('personal-token'));
    await expectStatus(await request('/workspaces/' + fx.workspaceId, 'PUT', { projects: [project] }, { ...headers, origin: 'https://attacker.example' }), 403);
    await expectStatus(await request('/workspaces/' + fx.workspaceId, 'PUT', { projects: [project] }), 200);
    const connection = (await pool.query<{
        id: string;
        secret: Buffer;
    }>('SELECT id,secret FROM sote_servers')).rows[0]!;
    assert.ok(!connection.secret.includes(Buffer.from('secret'.repeat(10))));
    const pageId = randomUUID(), blockId = randomUUID(), doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'Source note');
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.idx, 'a0');
    const block = new Y.XmlElement('soteTasks');
    block.setAttribute('id', blockId);
    block.setAttribute('serverId', connection.id);
    block.setAttribute('projectId', project);
    block.setAttribute('mode', 'list');
    doc.getXmlFragment(DOC_KEYS.content).push([block]);
    await withTransaction(pool, async (q) => { const seq = await appendUpdate(q, pageId, Y.encodeStateAsUpdate(doc), fx.userId); await materializeYDoc(q, pageId, doc, { throughSeq: seq, workspaceId: fx.workspaceId }); });
    const path = '/pages/' + pageId + '/blocks/' + blockId;
    // HTTP may see a block before the editor's configuration update is persisted.
    const persist = async () => withTransaction(pool, async q => {
        const seq = await appendUpdate(q, pageId, Y.encodeStateAsUpdate(doc), fx.userId);
        await materializeYDoc(q, pageId, doc, { throughSeq: seq, workspaceId: fx.workspaceId });
    });
    const expectPending = async (target: string) => {
        const result = await expectJson<{ error: { code: string } }>(await request(target), 409);
        assert.equal(result.error.code, 'sote_block_pending');
    };
    await expectPending('/pages/' + pageId + '/blocks/' + randomUUID());
    block.setAttribute('serverId', '');
    block.setAttribute('projectId', '');
    await persist();
    await expectPending(path);
    await expectStatus(await request(path, 'POST', { operationId: randomUUID(), fields: { title: 'Too early' } }), 409);
    assert.equal(writes, 0, 'pending configuration cannot write tasks');
    block.setAttribute('serverId', connection.id);
    await persist();
    await expectPending(path);
    block.setAttribute('serverId', randomUUID());
    block.setAttribute('projectId', project);
    await persist();
    const mismatch = await expectJson<{ error: { code: string; message: string } }>(await request(path), 409);
    assert.equal(mismatch.error.code, 'sote_integration');
    assert.match(mismatch.error.message, /anderen Verbindung/);
    block.setAttribute('serverId', connection.id);
    await persist();
    const data = await expectJson<{
        tasks: unknown[];
        writable: boolean;
    }>(await request(path));
    assert.equal(data.writable, true);
    assert.ok(JSON.stringify(data).includes(privateTitle));
    await expectStatus(await request(path, 'POST', { operationId: randomUUID(), fields: { title: 'New' } }), 200);
    assert.equal(writes, 1);
    assert.equal(lastBody['pageId'], pageId);
    assert.equal(lastBody['blockId'], blockId);
    assert.equal(lastBody['projectId'], project);
    const persisted = await loadDoc(pool, pageId);
    assert.ok(!persisted.doc.getXmlFragment(DOC_KEYS.content).toString().includes(privateTitle));
    persisted.doc.destroy();
    await pool.query('UPDATE pages SET locked=true WHERE id=$1', [pageId]);
    const locked = await expectJson<{
        writable: boolean;
    }>(await request(path));
    assert.equal(locked.writable, false);
    await expectStatus(await request(path, 'POST', { fields: { title: 'Rejected' } }), 403);
    assert.equal(writes, 1);
    await pool.query('UPDATE pages SET locked=false WHERE id=$1', [pageId]);
    // Another workspace member cannot borrow the owner's account grant.
    const other = (await pool.query<{
        id: string;
    }>("INSERT INTO users(email,display_name) VALUES($1,'Other') RETURNING id", [randomUUID() + '@example.org'])).rows[0]!.id;
    await addMember(pool, fx.workspaceId, other, 'member');
    const otherSession = await createSession(pool, other);
    await expectStatus(await request(path, 'GET', undefined, { 'content-type': 'application/json', cookie: 'sone_session=' + otherSession.token }), 401);
    await expectStatus(await request('/pages/' + pageId + '/blocks/' + randomUUID()), 409);
    await pool.query('DELETE FROM sote_projects WHERE workspace_id=$1', [fx.workspaceId]);
    await expectStatus(await request(path), 403);
    await request('/workspaces/' + fx.workspaceId, 'PUT', { projects: [project] });
    await pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [pageId]);
    await expectStatus(await request(path), 404);
    await expectStatus(await request('/pages/' + pageId + '/options'), 404);
    await expectStatus(await request('/account', 'DELETE'), 200);
    assert.equal(remoteRevoked, true);
    assert.equal((await expectJson<{
        connected: boolean;
    }>(await request(''))).connected, false);
    doc.destroy();
});
