/** Delegated SOTE access. Document data never contains credentials or task text. */
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { readBlockTree } from '@sone/core';
import { queryOne, queryRows } from '../db/pool.js';
import { loadDoc } from '../doc/docStore.js';
import { encryptShareToken, decryptShareToken } from '../auth/shareTokenStore.js';
import { requireSession, claimsOrNull } from '../http/auth.js';
import { effectiveRole, loadPageLocation, canEdit } from '../auth/claims.js';
import { holdsRight } from '../auth/rights.js';
import { administratorRights } from '../admin/rights.js';
import { type Router, type RequestContext } from '../http/router.js';
const ROOT = '/api/integrations/sote';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
class Rejected extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const need = (ok: unknown, message = 'Kein Zugriff.', status = 403) => { if (!ok)
    throw new Rejected(status, message); };
type Server = {
    id: string;
    base_url: string;
    client_id: string;
    secret: Buffer;
};
type Project = {
    id: string;
    name: string;
    workspaceId: string;
    workspaceName: string;
    writable: boolean;
    manageable: boolean;
};
type Task = {
    id: string;
    projectId: string;
    revision: string;
    title: string;
    completed: string | null;
    planned: string | null;
    plannedAllDay: boolean;
    duration: number | null;
    note: string;
    priority: number;
};
export function registerSoteRoutes(router: Router, { pool, secretKey, publicUrl }: {
    pool: Pool;
    secretKey: string;
    publicUrl: string;
}) {
    const seal = (value: string) => encryptShareToken('sote:' + value, secretKey);
    const open = (value: Buffer) => { const result = decryptShareToken(value, secretKey); need(result?.startsWith('sote:'), 'Verbindung bitte neu einrichten.', 401); return result!.slice(5); };
    const server = async () => { const s = await queryOne<Server>(pool, 'SELECT * FROM sote_servers'); need(s, 'SOTE wurde noch nicht eingerichtet.', 409); return s!; };
    const call = async <T>(s: Server, path: string, token: string | null, method = 'GET', body?: unknown): Promise<T> => {
        let res: Response;
        try {
            res = await fetch(s.base_url + '/api/integrations/sone/' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15000) });
        }
        catch {
            throw new Rejected(503, 'SOTE ist derzeit nicht erreichbar.');
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        const reader = res.body?.getReader();
        if (reader)
            for (;;) {
                const p = await reader.read();
                if (p.done)
                    break;
                length += p.value.length;
                if (length > 2 * 1024 * 1024) {
                    await reader.cancel();
                    throw new Rejected(502, 'Antwort von SOTE zu groß.');
                }
                chunks.push(p.value);
            }
        let out: Record<string, unknown>;
        try {
            out = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        catch {
            throw new Rejected(502, 'SOTE liefert keine gültige Antwort.');
        }
        if (!res.ok)
            throw new Rejected(res.status >= 500 ? 503 : res.status === 401 ? 401 : res.status === 409 ? 409 : res.status === 404 ? 404 : res.status === 410 ? 410 : 400, res.status === 401 ? 'Bitte dein SOTE-Konto erneut verbinden.' : res.status === 409 ? 'Die Aufgabe wurde inzwischen geändert. Lade den aktuellen Stand; dein Entwurf bleibt erhalten.' : res.status === 404 ? 'Die verknüpften Aufgaben sind nicht verfügbar.' : 'SOTE hat die Änderung abgelehnt.');
        return out as T;
    };
    const access = async (user: string, s: Server) => { const a = await queryOne<{
        token: Buffer;
    }>(pool, 'SELECT token FROM sote_accounts WHERE user_id=$1 AND server_id=$2 AND expires_at>now()', [user, s.id]); need(a, 'Bitte dein SOTE-Konto verbinden.', 401); return open(a!.token); };
    const wrap = (fn: (ctx: RequestContext) => Promise<void>) => async (ctx: RequestContext) => {
        ctx.res.setHeader('cache-control', 'no-store');
        try {
            if (!['GET', 'HEAD'].includes(ctx.req.method ?? '')) {
                need(ctx.req.headers['content-type']?.startsWith('application/json'), 'JSON erforderlich.', 415);
                const origin = ctx.req.headers.origin;
                need(!origin || origin === new URL(publicUrl).origin, 'Ungültige Herkunft.');
            }
            await fn(ctx);
        }
        catch (e) {
            if (e instanceof Rejected)
                ctx.send(e.status, { error: { code: 'sote_integration', message: e.message } });
            else
                throw e;
        }
    };
    const session = async (ctx: RequestContext) => requireSession(pool, ctx);
    router.get(ROOT, wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        const s = await queryOne<Server>(pool, 'SELECT * FROM sote_servers');
        const a = s ? await queryOne<{
            expires_at: Date;
        }>(pool, 'SELECT expires_at FROM sote_accounts WHERE user_id=$1 AND server_id=$2', [who.userId, s.id]) : undefined;
        ctx.send(200, { admin: (await administratorRights(pool, who.userId)).instance, server: s ? { id: s.id, baseUrl: s.base_url } : null, connected: !!a && +a.expires_at > Date.now(), expiresAt: a?.expires_at ?? null });
    }));
    router.post(ROOT + '/server', wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        need((await administratorRights(pool, who.userId)).instance);
        need(!(await queryOne(pool, 'SELECT id FROM sote_servers')), 'Bitte zuerst die bestehende Instanz trennen.', 409);
        const b = await ctx.json<{
            baseUrl: string;
            clientId: string;
            secret: string;
        }>();
        let u: URL;
        try {
            u = new URL(b.baseUrl);
        }
        catch {
            throw new Rejected(400, 'Ungültige SOTE-Adresse.');
        }
        need((u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password, 'Bitte eine HTTPS-Basisadresse ohne Pfad eingeben.', 400);
        need(uuid(b.clientId) && typeof b.secret === 'string' && b.secret.length >= 32 && b.secret.length <= 200, 'Client-ID und Geheimnis fehlen.', 400);
        await pool.query('INSERT INTO sote_servers(base_url,client_id,secret) VALUES($1,$2,$3)', [u.origin, b.clientId, seal(b.secret)]);
        ctx.send(200, { ok: true });
    }));
    router.delete(ROOT + '/server', wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        need((await administratorRights(pool, who.userId)).instance);
        await pool.query('DELETE FROM sote_servers');
        ctx.send(200, { ok: true });
    }));
    router.post(ROOT + '/connect', wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        const s = await server(), state = random(), verifier = random() + random();
        await pool.query('DELETE FROM sote_login_flows WHERE expires_at<now() OR user_id=$1', [who.userId]);
        await pool.query(`INSERT INTO sote_login_flows(state_hash,user_id,session_id,server_id,verifier,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`, [hash(state), who.userId, who.sessionId, s.id, seal(verifier)]);
        const url = new URL(s.base_url + '/einstellungen/verbindungen');
        url.search = new URLSearchParams({ client_id: s.client_id, redirect_uri: new URL(ROOT + '/callback', publicUrl).href, state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
        ctx.send(200, { url: url.href });
    }));
    router.get(ROOT + '/callback', async (ctx) => {
        ctx.res.setHeader('cache-control', 'no-store');
        ctx.res.setHeader('referrer-policy', 'no-referrer');
        let error = false;
        try {
            const who = await session(ctx);
            if (!who)
                return;
            const s = await server();
            const state = ctx.url.searchParams.get('state') ?? '', code = ctx.url.searchParams.get('code') ?? '';
            need(state.length <= 200 && code.length <= 200, 'Ungültige Anmeldung.', 400);
            const f = await queryOne<{
                verifier: Buffer;
            }>(pool, 'DELETE FROM sote_login_flows WHERE state_hash=$1 AND user_id=$2 AND session_id=$3 AND server_id=$4 AND expires_at>now() RETURNING verifier', [hash(state), who.userId, who.sessionId, s.id]);
            need(f, 'Anmeldung abgelaufen.', 400);
            const token = await call<{
                access_token: string;
                expires_in: number;
                user_id: string;
            }>(s, 'token', null, 'POST', { client_id: s.client_id, client_secret: open(s.secret), grant_type: 'authorization_code', code, code_verifier: open(f!.verifier), redirect_uri: new URL(ROOT + '/callback', publicUrl).href });
            need(typeof token.access_token === 'string' && uuid(token.user_id) && Number.isFinite(token.expires_in) && token.expires_in > 0 && token.expires_in <= 31 * 86400, 'Ungültiger Zugang.', 502);
            await pool.query(`INSERT INTO sote_accounts(user_id,server_id,token,remote_user,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,server_id) DO UPDATE SET token=$3,remote_user=$4,expires_at=$5`, [who.userId, s.id, seal(token.access_token), token.user_id, new Date(Date.now() + token.expires_in * 1000)]);
        }
        catch {
            error = true;
        }
        ctx.res.writeHead(303, { location: '/settings/sote' + (error ? '?sote_error=1' : '?sote_connected=1') });
        ctx.res.end();
    });
    router.delete(ROOT + '/account', wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        const s = await server();
        const a = await queryOne<{
            token: Buffer;
        }>(pool, 'SELECT token FROM sote_accounts WHERE user_id=$1 AND server_id=$2', [who.userId, s.id]);
        if (a) {
            await call(s, 'v1/revoke', open(a.token), 'POST', {}).catch(e => { if (!(e instanceof Rejected) || e.status !== 401)
                throw e; });
        }
        await pool.query('DELETE FROM sote_accounts WHERE user_id=$1', [who.userId]);
        ctx.send(200, { ok: true });
    }));
    router.get(ROOT + '/workspaces/:workspaceId', wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        const workspace = ctx.params['workspaceId']!;
        need(uuid(workspace), 'Arbeitsbereich nicht verfügbar.', 404);
        const rights = await holdsRight(pool, workspace, who.userId, 'people.manage');
        need(rights.member || rights.held, 'Arbeitsbereich nicht verfügbar.', 404);
        const s = await server(), token = await access(who.userId, s), remote = await call<{
            projects: Project[];
        }>(s, 'v1/projects', token);
        const mapped = await queryRows<{
            project_id: string;
        }>(pool, 'SELECT project_id FROM sote_projects WHERE workspace_id=$1 AND server_id=$2', [workspace, s.id]);
        ctx.send(200, { manage: rights.held, projects: remote.projects.filter(p => rights.held || mapped.some(m => m.project_id === p.id)), selected: mapped.map(m => m.project_id) });
    }));
    router.put(ROOT + '/workspaces/:workspaceId', wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        const workspace = ctx.params['workspaceId']!;
        need(uuid(workspace));
        need((await holdsRight(pool, workspace, who.userId, 'people.manage')).held);
        const s = await server(), token = await access(who.userId, s), b = await ctx.json<{
            projects: string[];
        }>(), remote = await call<{
            projects: Project[];
        }>(s, 'v1/projects', token);
        need(Array.isArray(b.projects) && b.projects.length <= 100 && b.projects.every(id => remote.projects.some(p => p.id === id && p.manageable)), 'Du brauchst die Verwaltungsberechtigung für die ausgewählten SOTE-Projekte.', 403);
        const workspaces = new Set(remote.projects.filter(p => b.projects.includes(p.id)).map(p => p.workspaceId));
        need(workspaces.size <= 1, 'Bitte Projekte aus einem SOTE-Arbeitsbereich auswählen.', 400);
        const q = await pool.connect();
        try {
            await q.query('BEGIN');
            await q.query('DELETE FROM sote_projects WHERE workspace_id=$1 AND server_id=$2', [workspace, s.id]);
            for (const id of new Set(b.projects)) {
                const p = remote.projects.find(p => p.id === id)!;
                await q.query('INSERT INTO sote_projects(workspace_id,server_id,project_id,remote_workspace,created_by) VALUES($1,$2,$3,$4,$5)', [workspace, s.id, id, p.workspaceId, who.userId]);
            }
            await q.query('COMMIT');
        }
        catch (e) {
            await q.query('ROLLBACK');
            throw e;
        }
        finally {
            q.release();
        }
        ctx.send(200, { ok: true });
    }));
    const livePage = async (id: string) => queryOne<{
        locked: boolean;
    }>(pool, `SELECT p.locked FROM pages p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=$1 AND p.archived_at IS NULL AND w.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM pages a WHERE a.id=ANY(p.ancestor_ids) AND a.archived_at IS NOT NULL)`, [id]);
    router.get(ROOT + '/pages/:pageId/options', wrap(async (ctx) => {
        const who = await session(ctx);
        if (!who)
            return;
        const pageId = ctx.params['pageId']!;
        need(uuid(pageId), 'Seite nicht verfügbar.', 404);
        const page = await loadPageLocation(pool, pageId);
        need(page, 'Seite nicht verfügbar.', 404);
        const claims = await claimsOrNull(pool, ctx, page!.workspaceId);
        need(claims && effectiveRole(claims, page!), 'Seite nicht verfügbar.', 404);
        need(await livePage(pageId), 'Seite nicht verfügbar.', 404);
        const s = await server(), token = await access(who.userId, s), remote = await call<{
            projects: Project[];
        }>(s, 'v1/projects', token);
        const allowed = await queryRows<{
            project_id: string;
        }>(pool, 'SELECT project_id FROM sote_projects WHERE workspace_id=$1 AND server_id=$2', [page!.workspaceId, s.id]);
        const projects = remote.projects.filter(p => allowed.some(a => a.project_id === p.id));
        const chosen = ctx.url.searchParams.get('projectId');
        let tasks: Task[] = [];
        if (chosen) {
            need(projects.some(p => p.id === chosen), 'Projekt nicht verfügbar.', 404);
            tasks = (await call<{
                tasks: Task[];
            }>(s, 'v1/tasks?' + new URLSearchParams({ projectId: chosen }), token)).tasks;
        }
        ctx.send(200, { serverId: s.id, projects, tasks });
    }));
    async function blockAccess(ctx: RequestContext, write: boolean) {
        const who = await session(ctx);
        if (!who)
            return null;
        const pageId = ctx.params['pageId']!, blockId = ctx.params['blockId']!;
        need(uuid(pageId) && uuid(blockId), 'Block nicht verfügbar.', 404);
        const page = await loadPageLocation(pool, pageId);
        need(page, 'Seite nicht verfügbar.', 404);
        const claims = await claimsOrNull(pool, ctx, page!.workspaceId), role = claims ? effectiveRole(claims, page!) : null;
        need(role, 'Seite nicht verfügbar.', 404);
        const live = await livePage(pageId);
        need(live, 'Seite nicht verfügbar.', 404);
        need(!write || (canEdit(claims!, page!) && !live!.locked), 'Die Seite ist schreibgeschützt.');
        const loaded = await loadDoc(pool, pageId);
        let props: Record<string, unknown>;
        try {
            const tree = readBlockTree(loaded.doc).blocks;
            const b = tree.find(b => b.id === blockId && b.type === 'soteTasks');
            need(b, 'Der Aufgabenblock wird noch gespeichert. Bitte erneut versuchen.', 409);
            let parent = b!.parentId;
            while (parent) {
                const ancestor = tree.find(item => item.id === parent);
                need(ancestor?.type !== 'protectedSection', 'Aufgabenblöcke in geschützten Abschnitten werden noch nicht unterstützt.', 403);
                parent = ancestor?.parentId ?? null;
            }
            props = b!.props;
        }
        finally {
            loaded.doc.destroy();
        }
        const s = await server();
        need(props['serverId'] === s.id, 'Dieser Block gehört zu einer anderen Verbindung.', 409);
        const project = props['projectId'];
        need(uuid(project), 'Bitte ein Projekt auswählen.', 409);
        need(await queryOne(pool, 'SELECT 1 FROM sote_projects WHERE workspace_id=$1 AND server_id=$2 AND project_id=$3', [page!.workspaceId, s.id, project]), 'Dieses Projekt ist hier nicht freigegeben.');
        return { who, s, token: await access(who.userId, s), props, pageId, blockId, project: String(project), editable: canEdit(claims!, page!) && !live!.locked };
    }
    router.get(ROOT + '/pages/:pageId/blocks/:blockId', wrap(async (ctx) => {
        const b = await blockAccess(ctx, false);
        if (!b)
            return;
        const operation = ctx.url.searchParams.get('operationId');
        if (operation) {
            need(uuid(operation), 'Ungültiger Vorgang.', 400);
            const result = await call<{
                task: Task | null;
            }>(b.s, 'v1/operations/' + operation, b.token);
            need(!result.task || result.task.projectId === b.project, 'Aufgabe wurde verschoben.', 404);
            ctx.send(200, result);
            return;
        }
        const one = b.props['taskId'];
        if (uuid(one)) {
            const data = await call<{
                task: Task;
                writable: boolean;
            }>(b.s, 'v1/tasks/' + one, b.token);
            need(data.task.projectId === b.project, 'Aufgabe wurde in ein anderes Projekt verschoben.', 404);
            ctx.send(200, { tasks: [data.task], next: null, writable: b.editable && data.writable, baseUrl: b.s.base_url });
        }
        else {
            const offset = ctx.url.searchParams.get('offset') ?? '0';
            need(/^\d{1,6}$/.test(offset), 'Ungültige Seite.', 400);
            const data = await call<{
                tasks: Task[];
                next: number | null;
                writable: boolean;
            }>(b.s, 'v1/tasks?' + new URLSearchParams({ projectId: b.project, offset }), b.token);
            ctx.send(200, { ...data, ...(b.props['mode'] === 'single' ? { tasks: [], next: null } : {}), writable: b.editable && data.writable, baseUrl: b.s.base_url });
        }
    }));
    router.post(ROOT + '/pages/:pageId/blocks/:blockId', wrap(async (ctx) => {
        const b = await blockAccess(ctx, true);
        if (!b)
            return;
        const input = await ctx.json<{
            taskId?: string;
            operationId?: string;
            revision?: string;
            fields: Record<string, unknown>;
        }>();
        if (input.taskId) {
            need(uuid(input.taskId));
            const t = await call<{
                task: Task;
            }>(b.s, 'v1/tasks/' + input.taskId, b.token);
            need(t.task.projectId === b.project && (!b.props['taskId'] || b.props['taskId'] === input.taskId), 'Aufgabe gehört nicht zu diesem Block.', 404);
        }
        else
            need(!b.props['taskId'], 'Dieser Block zeigt eine einzelne Aufgabe.', 409);
        const result = await call(b.s, 'v1/tasks' + (input.taskId ? '/' + input.taskId : ''), b.token, input.taskId ? 'PATCH' : 'POST', { fields: input.fields, projectId: b.project, operationId: input.operationId, revision: input.revision, pageId: b.pageId, blockId: b.blockId });
        ctx.send(200, result);
    }));
}
