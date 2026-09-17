import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from 'react';
import { forgetSoteAvailability } from '../hooks/useSoteAvailable.ts';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { NodeSelection } from 'prosemirror-state';
import { continueAfterSote } from '@sone/editor';
import { applyBlockAttrs } from './blockAttrs.ts';
import type { NodeView, EditorView } from 'prosemirror-view';
import { useT } from '../i18n/useT.tsx';
import { CheckSquareIcon, ArrowUturnIcon, PlusIcon, CalendarIcon, ClockIcon, TextIcon, PencilIcon, LinkIcon } from './icons.tsx';
type Translate = ReturnType<typeof useT>['t'];
type Project = {
    id: string;
    name: string;
    workspaceName: string;
    manageable: boolean;
};
type Task = {
    id: string;
    projectId: string;
    title: string;
    note: string;
    planned: string | null;
    plannedAllDay: boolean;
    duration: number | null;
    completed: string | null;
    priority: number;
    revision: string;
};
type Config = {
    serverId?: string;
    projectId?: string;
    taskId?: string;
    mode?: string;
};
class ConnectionError extends Error {
    constructor(public status: number, message: string, public code?: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch('/api/integrations/sote' + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const out = await res.json();
    if (!res.ok)
        throw new ConnectionError(res.status, out.error?.message ?? 'SOTE connection unavailable.', out.error?.code);
    return out as T;
}
export function SoteSettings({ workspaceId }: {
    workspaceId: string;
}) {
    const { t } = useT();
    const [state, setState] = useState<{
        admin: boolean;
        server: {
            id: string;
            baseUrl: string;
        } | null;
        connected: boolean;
        expiresAt: string | null;
    }>();
    const [mapping, setMapping] = useState<{
        manage: boolean;
        projects: Project[];
        selected: string[];
    }>(), [chosen, setChosen] = useState<string[]>([]);
    const [base, setBase] = useState(''), [client, setClient] = useState(''), [secret, setSecret] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    async function load() { const result = await request<NonNullable<typeof state>>(''); setState(result); if (result.connected) {
        const m = await request<NonNullable<typeof mapping>>('/workspaces/' + workspaceId);
        setMapping(m);
        setChosen(m.selected);
    }
    else
        setMapping(undefined); }
    useEffect(() => { void load().catch(e => setError(e.message)); if (new URLSearchParams(location.search).has('sote_error'))
        setError(t('sote.loginFailed')); }, [workspaceId]);
    async function act(fn: () => Promise<void>) { setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : t('sote.failed'));
    }
    finally {
        setBusy(false);
    } }
    return <div className="sote-settings">
  <p>{t('sote.intro')}</p>{error ? <p role="alert">{error}</p> : null}
  <section><h2>{t('sote.account')}</h2>{state?.server ? <><p>{state.server.baseUrl} · {state.connected ? t('sote.connected') : t('sote.notConnected')}</p>{state.connected ? <p>{t('sote.until')} {new Date(state.expiresAt!).toLocaleDateString()}</p> : null}
   <button className="btn" type="button" disabled={busy} onClick={() => void act(async () => { const r = await request<{
            url: string;
        }>('/connect', 'POST', {}); location.assign(r.url); })}>{state.connected ? t('sote.renew') : t('sote.connect')}</button>
   {state.connected ? <button className="btn" type="button" disabled={busy} onClick={() => void act(async () => { await request('/account', 'DELETE'); await load(); })}>{t('sote.disconnect')}</button> : null}</> : <p>{t('sote.setupRequired')}</p>}</section>
  {mapping ? <section><h2>{t('sote.projects')}</h2><p>{t('sote.projectsHint')}</p>{mapping.projects.filter(p => !mapping.manage || p.manageable).map(p => <label className="sote-check" key={p.id}><input type="checkbox" disabled={!mapping.manage || busy} checked={chosen.includes(p.id)} onChange={e => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter(id => id !== p.id))}/>{p.workspaceName} · {p.name}</label>)}{mapping.manage ? <button className="btn" disabled={busy} onClick={() => void act(async () => { await request('/workspaces/' + workspaceId, 'PUT', { projects: chosen }); await load(); })}>{t('sote.save')}</button> : null}</section> : null}
  {state?.admin ? <section><h2>{t('sote.server')}</h2>{state.server ? <><p>{t('sote.disconnectServerHint')}</p><button className="btn" disabled={busy} onClick={() => void act(async () => { await request('/server', 'DELETE'); forgetSoteAvailability(); await load(); })}>{t('sote.disconnectServer')}</button></> : <form onSubmit={e => { e.preventDefault(); void act(async () => { await request('/server', 'POST', { baseUrl: base, clientId: client, secret }); setSecret(''); forgetSoteAvailability(); await load(); }); }}>
   <p>{t('sote.setupHint')}</p><label>{t('sote.address')}<input type="url" required value={base} onChange={e => setBase(e.target.value)}/></label><label>Client-ID<input required value={client} onChange={e => setClient(e.target.value)}/></label><label>{t('sote.secret')}<input type="password" autoComplete="new-password" required value={secret} onChange={e => setSecret(e.target.value)}/></label><button className="btn" disabled={busy}>{t('sote.save')}</button>
  </form>}</section> : null}
 </div>;
}
function localDate(value: string | null, allDay: boolean) { if (!value)
    return ''; const d = new Date(value), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${allDay ? '' : `T${p(d.getHours())}:${p(d.getMinutes())}`}`; }
function TaskPopover({ anchor, title, children, close, t }: {
    anchor: HTMLElement; title: string; children: ReactNode; close: () => void; t: Translate;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const label = useId();
    const closeRef = useRef(close);
    closeRef.current = close;
    useLayoutEffect(() => {
        const element = panel.current!;
        const position = () => {
            const box = anchor.getBoundingClientRect(), popup = element.getBoundingClientRect();
            element.style.left = Math.max(12, Math.min(box.right - popup.width, window.innerWidth - popup.width - 12)) + 'px';
            const below = box.bottom + 8;
            element.style.top = Math.max(12, below + popup.height <= window.innerHeight - 12 ? below : box.top - popup.height - 8) + 'px';
        };
        position();
        element.querySelector<HTMLElement>('input, textarea, button')?.focus();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
        observer?.observe(element);
        const outside = (event: Event) => {
            if (event.target instanceof Node && !element.contains(event.target) && !anchor.contains(event.target)) closeRef.current();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); anchor.focus(); closeRef.current(); }
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        document.addEventListener('keydown', escape, true);
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        return () => {
            observer?.disconnect();
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
            document.removeEventListener('keydown', escape, true);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
        };
    }, [anchor]);
    return createPortal(<div ref={panel} className="sote-popover" role="dialog" aria-labelledby={label}>
        <strong id={label}>{title}</strong>{children}
        <button className="btn quiet" type="button" onClick={() => { anchor.focus(); close(); }}>{t('action.done')}</button>
    </div>, document.body);
}
function TaskForm({ task, current, t, save, busy }: {
    task?: Task; current?: Task; t: Translate;
    save: (fields: Record<string, unknown>, revision?: string) => Promise<void>; busy: boolean;
}) {
    const [revision, setRevision] = useState(task?.revision);
    const [title, setTitle] = useState(task?.title ?? ''), [note, setNote] = useState(task?.note ?? '');
    const [allDay, setAllDay] = useState(task?.plannedAllDay ?? false);
    const [date, setDate] = useState(localDate(task?.planned ?? null, task?.plannedAllDay ?? false));
    const [duration, setDuration] = useState(task?.duration?.toString() ?? ''), [error, setError] = useState('');
    const [popup, setPopup] = useState<{ kind: 'date' | 'duration' | 'note'; anchor: HTMLElement } | null>(null);
    const titleInput = useRef<HTMLInputElement>(null);
    const conflict = !!(task && current && current.revision !== revision);
    const field = (kind: 'date' | 'duration' | 'note', label: string, icon: ReactNode, filled: boolean) =>
        <button className="sote-icon" type="button" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={popup?.kind === kind} data-filled={filled}
            onClick={event => setPopup(popup?.kind === kind ? null : { kind, anchor: event.currentTarget })}>{icon}</button>;
    return <form className="sote-composer" onSubmit={event => {
        event.preventDefault(); if (busy || conflict || !title.trim()) return;
        void (async () => { setError(''); try {
            const parsed = date ? new Date(allDay ? date + 'T00:00' : date) : null;
            if (parsed && (!Number.isFinite(+parsed) || localDate(parsed.toISOString(), allDay) !== date)) throw new Error(t('sote.invalidDate'));
            const minutes = duration ? Number(duration) : null;
            if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)) throw new Error(t('sote.invalidDuration'));
            await save({ title: title.trim(), note, planned: parsed?.toISOString() ?? null, plannedAllDay: allDay, duration: minutes }, revision);
            if (!task) { setTitle(''); setNote(''); setDate(''); setDuration(''); setAllDay(false); setPopup(null); titleInput.current?.focus(); }
        } catch (e) { setError(e instanceof Error ? e.message : t('sote.failed')); } })();
    }}>
        <div className="sote-compose-line">
            <input ref={titleInput} className="sote-compose-title" aria-label={t('sote.title')} placeholder={t('sote.newTask')} required maxLength={1000} value={title} onChange={e => setTitle(e.target.value)}/>
            <div className="sote-compose-tools">
                {field('date', t('sote.planned'), <CalendarIcon size={17}/>, !!date)}
                {field('duration', t('sote.duration'), <ClockIcon size={17}/>, !!duration)}
                {field('note', t('sote.note'), <TextIcon size={17}/>, !!note)}
                <button className="sote-icon sote-submit" type="submit" aria-label={task ? t('sote.save') : t('sote.create')} title={task ? t('sote.save') : t('sote.create')} disabled={busy || conflict || !title.trim()}><CheckSquareIcon size={18}/></button>
            </div>
        </div>
        {date || duration || note ? <div className="sote-compose-meta">
            {date ? <span><CalendarIcon size={13}/>{date.replace('T', ' · ')}{allDay ? ' · ' + t('sote.allDay') : ''}</span> : null}
            {duration ? <span><ClockIcon size={13}/>{duration} min</span> : null}
            {note ? <span><TextIcon size={13}/>{t('sote.note')}</span> : null}
        </div> : null}
        {popup ? <TaskPopover anchor={popup.anchor} title={t(popup.kind === 'date' ? 'sote.planned' : popup.kind === 'duration' ? 'sote.duration' : 'sote.note')} close={() => setPopup(null)} t={t}>
            {popup.kind === 'date' ? <>
                <label>{t('sote.planned')}<input aria-label={t('sote.planned')} name="planned" type={allDay ? 'date' : 'datetime-local'} value={date} onInput={e => setDate(e.currentTarget.value)} onChange={e => setDate(e.target.value)}/></label>
                <label className="sote-check"><input type="checkbox" checked={allDay} onChange={e => { setAllDay(e.target.checked); setDate(date ? (e.target.checked ? date.slice(0, 10) : date + 'T09:00') : ''); }}/>{t('sote.allDay')}</label>
                <button className="btn quiet" type="button" onClick={() => { setDate(''); setAllDay(false); }}>{t('sote.clearDate')}</button>
            </> : popup.kind === 'duration' ? <>
                <div className="sote-duration-presets">{[15, 30, 60, 120].map(value => <button className="btn quiet" key={value} type="button" aria-pressed={duration === String(value)} onClick={() => setDuration(String(value))}>{value} min</button>)}</div>
                <label>{t('sote.duration')}<input aria-label={t('sote.duration')} type="number" min={1} max={10080} value={duration} onChange={e => setDuration(e.target.value)}/></label>
            </> : <label>{t('sote.note')}<textarea aria-label={t('sote.note')} rows={4} value={note} onChange={e => setNote(e.target.value)}/></label>}
        </TaskPopover> : null}
        {conflict && current ? <div role="alert"><p>{t('sote.conflict')}</p><p>{current.title}<br/>{current.planned ? new Date(current.planned).toLocaleString() : t('sote.unplanned')}{current.duration ? ' · ' + current.duration + ' min' : ''}</p><p>{current.note}</p><button className="btn quiet" type="button" onClick={() => setRevision(current.revision)}>{t('sote.reviewed')}</button></div> : null}
        {error ? <p role="alert">{error}</p> : null}
    </form>;
}
function SoteBlock({ pageId, blockId, config, change, t, editable, continueWriting }: {
    pageId: string;
    blockId: string;
    config: Config;
    change: (c: Config) => void;
    t: Translate;
    editable: () => boolean;
    continueWriting: () => void;
}) {
    const [options, setOptions] = useState<{
        serverId: string;
        projects: Project[];
        tasks?: Task[];
    }>(), [project, setProject] = useState(config.projectId ?? ''), [selected, setSelected] = useState('');
    const [data, setData] = useState<{
        tasks: Task[];
        next: number | null;
        writable: boolean;
        baseUrl: string;
    }>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [showDone, setShowDone] = useState(false), [edit, setEdit] = useState<Task | null>(null);
    const operationKey = 'sone:sote-operation:' + pageId + ':' + blockId;
    const [operation, setOperationState] = useState<string | null>(() => { try {
        return sessionStorage.getItem(operationKey);
    }
    catch {
        return null;
    } });
    const setOperation = (id: string | null) => { setOperationState(id); try {
        if (id)
            sessionStorage.setItem(operationKey, id);
        else
            sessionStorage.removeItem(operationKey);
    }
    catch { } };
    const [pendingFields, setPendingFields] = useState<Record<string, unknown> | null>(null);
    const endpoint = '/pages/' + pageId + '/blocks/' + blockId;
    const configured = !!config.serverId && !!config.projectId;
    const [loading, setLoading] = useState<'loading' | 'saving' | null>(configured ? 'loading' : null);
    const [reload, setReload] = useState(0);
    useEffect(() => { setData(undefined); }, [pageId, blockId, config.serverId, config.projectId, config.taskId]);
    useEffect(() => {
        let active = true, pendingRetries = 0;
        let timer: ReturnType<typeof setTimeout>;
        setError('');
        setLoading(configured && !data ? 'loading' : null);
        const run = async () => {
        let delay = 15000;
        try {
        if (!configured) {
            const o = await request<NonNullable<typeof options>>('/pages/' + pageId + '/options' + (project ? '?projectId=' + project : ''));
            if (active)
                setOptions(o);
        }
        else {
            if (operation) {
                const recovered = await request<{
                    task: Task | null;
                }>(endpoint + '?operationId=' + operation).catch(e => { if (e instanceof ConnectionError && [404, 410].includes(e.status)) {
                    if (active) {
                        setOperation(null);
                        setPendingFields(null);
                    }
                    return { task: null };
                } throw e; });
                if (active && recovered.task) {
                    setOperation(null);
                    setPendingFields(null);
                    if (config.mode === 'single')
                        change({ ...config, taskId: recovered.task.id });
                }
            }
            if (!active) return;
            const d = await request<NonNullable<typeof data>>(endpoint);
            if (active) {
                setData(d);
                setError('');
                setLoading(null);
                pendingRetries = 0;
            }
        }
    }
    catch (e) {
        if (active) {
            if (e instanceof ConnectionError && e.status < 500)
                setData(undefined);
            if (e instanceof ConnectionError && e.code === 'sote_block_pending') {
                if (pendingRetries++ < 10) {
                    setError('');
                    setLoading('saving');
                    delay = 1000;
                } else {
                    setLoading(null);
                    setError(t('sote.saveDelayed'));
                }
            } else {
                setLoading(null);
                setError(e instanceof Error ? e.message : t('sote.failed'));
            }
        }
    } finally {
        const next = () => {
            if (!active) return;
            if (document.visibilityState === 'visible') void run();
            else timer = setTimeout(next, 15000);
        };
        if (active) timer = setTimeout(next, delay);
    }
    }; void run(); return () => { active = false; clearTimeout(timer); }; }, [pageId, blockId, config.serverId, config.projectId, config.taskId, project, operation, reload]);
    const load = async () => { const d = await request<NonNullable<typeof data>>(endpoint); setData(d); setError(''); setLoading(null); };
    const update = async (fields: Record<string, unknown>, task?: Task) => {
        setBusy(true);
        setError('');
        const id = operation ?? crypto.randomUUID();
        if (!task) {
            setOperation(id);
            setPendingFields(pendingFields ?? fields);
        }
        try {
            const out = await request<{
                task: Task;
            }>(endpoint, 'POST', { fields: !task && pendingFields ? pendingFields : fields, ...(task ? { taskId: task.id, revision: task.revision } : { operationId: id }) });
            if (!task) {
                setOperation(null);
                setPendingFields(null);
                if (config.mode === 'single')
                    change({ ...config, taskId: out.task.id });
            }
            setEdit(null);
            await load().catch(e => { if (e instanceof ConnectionError && e.status < 500)
                setData(undefined); setError(e.message); });
        }
        catch (e) {
            if (!task && e instanceof ConnectionError && e.status < 500) {
                setOperation(null);
                setPendingFields(null);
            }
            setError(e instanceof Error ? e.message : t('sote.failed'));
            if (e instanceof ConnectionError && e.status === 409)
                await load().catch(() => { });
            throw e;
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="sote-embed"><div className="sote-embed-head"><strong><CheckSquareIcon size={16}/> SOTE</strong><a className="sote-icon" href="/settings/sote" aria-label={t('sote.settings')} title={t('sote.settings')}><LinkIcon size={16}/></a>{configured ? <button className="sote-icon" type="button" aria-label={t('sote.refresh')} title={t('sote.refresh')} onClick={() => setReload(value => value + 1)}><ArrowUturnIcon size={16}/></button> : null}</div>
  {error ? <p role="alert">{error}</p> : null}
  {loading ? <p role="status">{t(loading === 'saving' ? 'sote.savingBlock' : 'sote.loadingTasks')}</p> : null}
  {!configured && editable() ? <div className="sote-task-form"><p>{t('sote.chooseProject')}</p><label>{t('sote.project')}<select value={project} onChange={e => { setProject(e.target.value); setSelected(''); }}><option value="">—</option>{options?.projects.map(p => <option key={p.id} value={p.id}>{p.workspaceName} · {p.name}</option>)}</select></label>
   {config.mode === 'single' ? <label>{t('sote.task')}<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">{t('sote.newTask')}</option>{options?.tasks?.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label> : null}
   <button className="btn" disabled={!options || !project} onClick={() => change({ ...config, serverId: options!.serverId, projectId: project, taskId: selected })}>{t('sote.embed')}</button>
  </div> : null}
  {data ? <><div className="sote-access"><span>{data.writable && editable() ? t('sote.readWrite') : t('sote.readOnly')}</span><button className="sote-icon" type="button" aria-label={t('sote.showDone')} title={t('sote.showDone')} aria-pressed={showDone} onClick={() => setShowDone(!showDone)}><CheckSquareIcon size={16}/></button></div>
   {data.tasks.filter(task => showDone || !task.completed).map(task => <div className="sote-task" key={task.id}><div className="sote-task-row"><input type="checkbox" aria-label={task.title} disabled={busy || !data.writable || !editable()} checked={!!task.completed} onChange={e => void update({ completed: e.target.checked }, task).catch(() => { })}/><a href={data.baseUrl + '/a/' + task.id} target="_blank" rel="noopener noreferrer">{task.title}</a>{data.writable && editable() ? <button className="sote-icon" type="button" disabled={busy} aria-label={t('sote.edit')} title={t('sote.edit')} aria-expanded={edit?.id === task.id} onClick={() => setEdit(edit?.id === task.id ? null : task)}><PencilIcon size={16}/></button> : null}</div>
    {task.planned ? <small>{new Date(task.planned).toLocaleDateString()} · {task.plannedAllDay ? t('sote.allDay') : new Date(task.planned).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{task.duration ? ` · ${task.duration} min` : ''}</small> : null}
    {edit?.id === task.id ? <TaskForm key={task.id} task={edit} current={task} t={t} save={(f, revision) => update(f, { ...edit, revision: revision ?? edit.revision })} busy={busy}/> : null}
   </div>)}
   {!data.tasks.length ? <p>{t('sote.empty')}</p> : null}
   {data.next !== null && config.mode !== 'single' ? <button className="btn" disabled={busy} onClick={() => { setBusy(true); void request<NonNullable<typeof data>>(endpoint + '?offset=' + data.next).then(next => setData({ ...next, tasks: [...data.tasks, ...next.tasks] })).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{t('sote.more')}</button> : null}
   {data.writable && editable() && !config.taskId ? <div className="sote-new-task">{operation ? <p>{t('sote.retryHint')}</p> : null}<TaskForm t={t} busy={busy} save={f => update(f)}/></div> : null}
  </> : null}
  {editable() ? <button className="sote-continue" type="button" onClick={continueWriting}><PlusIcon size={16}/> {t('sote.continueWriting')}</button> : null}
  {!configured && !editable() ? <p>{t('sote.notConfigured')}</p> : null}
 </div>;
}
export function soteNodeView(pageId: string, editable: () => boolean, t: Translate): NonNullable<EditorView['props']['nodeViews']>[string] {
    return (node, view, getPos): NodeView => {
        const dom = document.createElement('div');
        dom.contentEditable = 'false';
        dom.className = 'sote-block';
        const root = createRoot(dom);
        let current = node;
        dom.addEventListener('click', event => { const target = event.target as HTMLElement | null; if (target?.closest('input,textarea,select,button,a,summary'))
            return; const pos = getPos(); if (pos !== undefined)
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); });
        const render = () => { applyBlockAttrs(dom, current.attrs); const id = String(current.attrs['id'] ?? ''); dom.dataset['blockId'] = id; root.render(<SoteBlock key={id} pageId={pageId} blockId={id} config={current.attrs as Config} t={t} editable={editable} continueWriting={() => {
            const pos = getPos();
            if (pos === undefined || !editable() || !view.editable) return;
            const tr = view.state.tr;
            if (continueAfterSote(tr, pos)) {
                view.dispatch(tr.scrollIntoView());
                view.focus();
            }
        }} change={config => { const pos = getPos(); if (pos === undefined || !editable())
            return; view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...config })); }}/>); };
        render();
        return { dom, update(next) { if (next.type !== current.type)
                return false; current = next; render(); return true; }, stopEvent: () => true, ignoreMutation: () => true, destroy() { root.unmount(); } };
    };
}
