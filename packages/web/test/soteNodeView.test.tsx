import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
const originalFetch = globalThis.fetch;
before(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver', 'DOMParser', 'Event', 'KeyboardEvent', 'MouseEvent', 'sessionStorage']) {
    Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
  }
  (globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;
  globalThis.fetch = async () => new Response(JSON.stringify({ tasks: [], next: null, writable: false, baseUrl: 'https://tasks.example.org' }), { headers: { 'content-type': 'application/json' } });
});
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

for (const following of ['none', 'paragraph', 'sote']) {
  test('deleting a rendered SOTE list stays deleted, with following paragraph: ' + following, async () => {
    const { act } = await import('react');
    const Y = await import('yjs');
    const { createEditor, deleteBlockSubtree, schema } = await import('@sone/editor');
    const { pageContent, readBlockTree } = await import('@sone/core');
    const { NodeSelection } = await import('prosemirror-state');
    const { soteNodeView } = await import('../src/components/SoteIntegration.tsx');
    const ydoc = new Y.Doc();
    const mount = document.createElement('div');
    document.body.append(mount);
    const view = createEditor(mount, { fragment: pageContent(ydoc), editable: () => true,
      nodeViews: { soteTasks: soteNodeView('page', () => true, ((key: string) => key) as never) } });
    try {
      await act(async () => {
        const block = schema.nodes['soteTasks']!.create({ id: 'sote-block', serverId: 'server', projectId: 'project', mode: 'list' });
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [block, ...(following === 'none' ? [] : [following === 'sote' ? block.type.create({ ...block.attrs, id: 'second-sote-block' }) : schema.nodes['paragraph']!.create(null, schema.text('Keep me'))])]));
      });
      assert.ok(mount.querySelector('.sote-block'));
      await act(async () => {
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
        assert.equal(deleteBlockSubtree(view.state, view.dispatch), true);
        view.focus();
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(view.state.doc.children.some(node => node.attrs['id'] === 'sote-block'), false, 'editor stays deleted');
      assert.equal(readBlockTree(ydoc).blocks.some(block => block.id === 'sote-block'), false, 'shared document stays deleted');
      assert.equal(mount.querySelector('[data-block-id="sote-block"]'), null, 'rendered block stays deleted');
      if (following === 'paragraph') assert.equal(view.state.doc.textContent, 'Keep me');
    } finally {
      await act(async () => view.destroy());
      ydoc.destroy();
      mount.remove();
    }
  });
}

test('deleting a task list with another open editor does not recreate it', async () => {
  const { act } = await import('react');
  const Y = await import('yjs');
  const { createEditor, deleteBlockSubtree } = await import('@sone/editor');
  const { pageContent, readBlockTree } = await import('@sone/core');
  const { NodeSelection } = await import('prosemirror-state');
  const { soteNodeView } = await import('../src/components/SoteIntegration.tsx');
  const first = new Y.Doc(), second = new Y.Doc();
  const block = new Y.XmlElement('soteTasks');
  for (const [key, value] of Object.entries({ id: 'shared-task', serverId: 'server', projectId: 'project', mode: 'list' })) block.setAttribute(key, value);
  pageContent(first).insert(0, [block]);
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  first.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'peer') Y.applyUpdate(second, update, 'peer'); });
  second.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'peer') Y.applyUpdate(first, update, 'peer'); });
  const mounts = [document.createElement('div'), document.createElement('div')];
  mounts.forEach(mount => document.body.append(mount));
  const views: ReturnType<typeof createEditor>[] = [];
  try {
    await act(async () => {
      for (const [index, doc] of [first, second].entries()) views.push(createEditor(mounts[index]!, { fragment: pageContent(doc), editable: () => true, nodeViews: { soteTasks: soteNodeView('page', () => true, ((key: string) => key) as never) } }));
      views.forEach(view => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    });
    await act(async () => { deleteBlockSubtree(views[0]!.state, views[0]!.dispatch); views[0]!.focus(); });
    await act(async () => { views[1]!.dispatch(views[1]!.state.tr.insertText('Continue after deletion')); });
    for (const doc of [first, second]) assert.equal(readBlockTree(doc).blocks.some(b => b.type === 'soteTasks'), false);
    for (const view of views) assert.equal(view.state.doc.children.some(n => n.type.name === 'soteTasks'), false);
  } finally {
    await act(async () => views.forEach(view => view.destroy()));
    first.destroy(); second.destroy(); mounts.forEach(mount => mount.remove());
  }
});

test('deleting a selected task shared by two surfaces of the same document stays deleted', async () => {
  const { act } = await import('react');
  const Y = await import('yjs');
  const { createEditor, deleteBlockSubtree } = await import('@sone/editor');
  const { pageContent, readBlockTree } = await import('@sone/core');
  const { NodeSelection } = await import('prosemirror-state');
  const { soteNodeView } = await import('../src/components/SoteIntegration.tsx');
  const first = new Y.Doc(), second = first;
  const block = new Y.XmlElement('soteTasks');
  for (const [key, value] of Object.entries({ id: 'shared-task', serverId: 'server', projectId: 'project', mode: 'list' })) block.setAttribute(key, value);
  pageContent(first).insert(0, [block]);
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));


  const mounts = [document.createElement('div'), document.createElement('div')];
  mounts.forEach(mount => document.body.append(mount));
  const views: ReturnType<typeof createEditor>[] = [];
  try {
    await act(async () => {
      for (const [index, doc] of [first, second].entries()) views.push(createEditor(mounts[index]!, { fragment: pageContent(doc), editable: () => true, nodeViews: { soteTasks: soteNodeView('page', () => true, ((key: string) => key) as never) } }));
      views.forEach(view => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    });
    await act(async () => { deleteBlockSubtree(views[0]!.state, views[0]!.dispatch); views[0]!.focus(); });
    await act(async () => { views[1]!.dispatch(views[1]!.state.tr.insertText('Continue after deletion')); });
    for (const doc of [first, second]) assert.equal(readBlockTree(doc).blocks.some(b => b.type === 'soteTasks'), false);
    for (const view of views) assert.equal(view.state.doc.children.some(n => n.type.name === 'soteTasks'), false);
  } finally {
    await act(async () => views.forEach(view => view.destroy()));
    first.destroy(); mounts.forEach(mount => mount.remove());
  }
});

test('a late recovery response cannot restore a deleted task block', async () => {
  const { act } = await import('react');
  const Y = await import('yjs');
  const { createEditor, deleteBlockSubtree } = await import('@sone/editor');
  const { pageContent, readBlockTree } = await import('@sone/core');
  const { NodeSelection } = await import('prosemirror-state');
  const { soteNodeView } = await import('../src/components/SoteIntegration.tsx');
  const savedFetch = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  globalThis.fetch = () => new Promise<Response>(resolve => { release = resolve; });
  sessionStorage.setItem('sone:sote-operation:page:pending-task', 'pending-operation');
  const doc = new Y.Doc();
  const block = new Y.XmlElement('soteTasks');
  for (const [key, value] of Object.entries({ id: 'pending-task', serverId: 'server', projectId: 'project', mode: 'single' })) block.setAttribute(key, value);
  pageContent(doc).insert(0, [block]);
  const mount = document.createElement('div'); document.body.append(mount);
  const view = createEditor(mount, { fragment: pageContent(doc), editable: () => true, nodeViews: { soteTasks: soteNodeView('page', () => true, ((key: string) => key) as never) } });
  try {
    await act(async () => { view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))); });
    assert.ok(release);
    await act(async () => { deleteBlockSubtree(view.state, view.dispatch); });
    globalThis.fetch = savedFetch;
    await act(async () => { release!(new Response(JSON.stringify({ task: { id: 'recovered-task' } }), { headers: { 'content-type': 'application/json' } })); });
    assert.equal(readBlockTree(doc).blocks.some(b => b.type === 'soteTasks'), false);
    assert.equal(mount.querySelector('.sote-block'), null);
  } finally {
    await act(async () => view.destroy());
    doc.destroy(); mount.remove(); globalThis.fetch = savedFetch; sessionStorage.clear();
  }
});

for (const scenario of ['saved', 'wrong-connection', 'timeout', 'deleted']) {
  test('new task block loading: ' + scenario, async (t) => {
    const { act } = await import('react');
    const Y = await import('yjs');
    const { createEditor, schema, deleteBlockSubtree } = await import('@sone/editor');
    const { pageContent } = await import('@sone/core');
    const { NodeSelection } = await import('prosemirror-state');
    const { soteNodeView } = await import('../src/components/SoteIntegration.tsx');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const savedFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (scenario === 'saved' && calls > 1) return new Response(JSON.stringify({ tasks: [{ id: 'task', title: 'Ready task' }], writable: false, next: null, baseUrl: 'https://tasks.example.org' }));
      return new Response(JSON.stringify({ error: { code: scenario === 'wrong-connection' ? 'sote_integration' : 'sote_block_pending', message: scenario === 'wrong-connection' ? 'Different connection' : 'Still saving' } }), { status: 409 });
    };
    const doc = new Y.Doc(), mount = document.createElement('div');
    document.body.append(mount);
    const view = createEditor(mount, { fragment: pageContent(doc), editable: () => true, nodeViews: { soteTasks: soteNodeView('page', () => true, ((key: string) => key) as never) } });
    try {
      await act(async () => {
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.nodes['soteTasks']!.create({ id: 'new-block', serverId: 'server', projectId: 'project' })));
      });
      assert.equal(calls, 1);
      if (scenario === 'wrong-connection') {
        assert.equal(mount.querySelector('[role="alert"]')?.textContent, 'Different connection');
        assert.equal(mount.querySelector('[role="status"]'), null);
        await act(async () => { t.mock.timers.tick(1000); });
        assert.equal(calls, 1, 'real conflicts do not trigger saving retries');
      } else {
        assert.equal(mount.querySelector('[role="alert"]'), null);
        assert.equal(mount.querySelector('[role="status"]')?.textContent, 'sote.savingBlock');
        if (scenario === 'deleted') {
          await act(async () => {
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
            deleteBlockSubtree(view.state, view.dispatch);
            t.mock.timers.tick(30000);
          });
          assert.equal(calls, 1, 'deleting the block cancels its retry');
        } else if (scenario === 'saved') {
          await act(async () => { t.mock.timers.tick(1000); });
          assert.equal(calls, 2);
          assert.equal(mount.querySelector('[role="alert"]'), null);
          assert.equal(mount.querySelector('[role="status"]'), null);
          assert.ok(mount.textContent?.includes('Ready task'));
        } else {
          for (let i = 0; i < 10; i++) await act(async () => { t.mock.timers.tick(1000); });
          assert.equal(mount.querySelector('[role="status"]'), null);
          assert.equal(mount.querySelector('[role="alert"]')?.textContent, 'sote.saveDelayed');
          assert.equal(calls, 11);
          await act(async () => { t.mock.timers.tick(1000); });
          assert.equal(calls, 11, 'quick retries stop after ten seconds');
        }
      }
    } finally {
      await act(async () => view.destroy());
      doc.destroy(); mount.remove(); globalThis.fetch = savedFetch;
    }
  });
}

test('compact composer keeps popup fields after closing and retries the draft after an error', async () => {
  const { act } = await import('react');
  const Y = await import('yjs');
  const { createEditor, schema } = await import('@sone/editor');
  const { pageContent } = await import('@sone/core');
  const { soteNodeView } = await import('../src/components/SoteIntegration.tsx');
  const savedFetch = globalThis.fetch;
  const sent: Array<{ fields: Record<string, unknown> }> = [];
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)));
      return sent.length === 1
        ? new Response(JSON.stringify({ error: { message: 'Please retry' } }), { status: 400 })
        : new Response(JSON.stringify({ task: { id: 'new-task' } }));
    }
    return new Response(JSON.stringify({ task: null, tasks: [], next: null, writable: true, baseUrl: 'https://tasks.example.org' }));
  };
  const doc = new Y.Doc(), mount = document.createElement('div'); document.body.append(mount);
  const view = createEditor(mount, { fragment: pageContent(doc), editable: () => true, nodeViews: { soteTasks: soteNodeView('page', () => true, ((key: string) => key) as never) } });
  const click = async (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector); assert.ok(element, selector);
    await act(async () => element.click());
  };
  const fill = async (selector: string, value: string) => {
    const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector); assert.ok(element, selector);
    await act(async () => {
      const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  try {
    await act(async () => view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.nodes['soteTasks']!.create({ id: 'compose', serverId: 'server', projectId: 'project', mode: 'list' }))));
    await fill('.sote-compose-title', 'My task');
    await click('button[aria-label="sote.planned"]');
    assert.ok(document.querySelector('[role="dialog"]'));
    await fill('input[name="planned"]', '2026-09-16T14:30');
    await click('.sote-popover .sote-check input');
    assert.equal(document.querySelector<HTMLInputElement>('input[name="planned"]')!.value, '2026-09-16');
    await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'sote.planned');
    await click('button[aria-label="sote.duration"]');
    await click('.sote-duration-presets button:nth-child(2)');
    await click('.sote-popover > button:last-child');
    await click('button[aria-label="sote.note"]');
    await fill('.sote-popover textarea', 'Keep this note');
    await click('.sote-popover > button:last-child');
    await click('button[aria-label="sote.create"]');
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.fields['title'], 'My task');
    assert.equal(sent[0]!.fields['duration'], 30);
    assert.equal(sent[0]!.fields['plannedAllDay'], true);
    assert.equal(sent[0]!.fields['planned'], new Date('2026-09-16T00:00').toISOString());
    assert.equal(sent[0]!.fields['note'], 'Keep this note');
    assert.equal(document.querySelector<HTMLInputElement>('.sote-compose-title')!.value, 'My task');
    await click('button[aria-label="sote.create"]');
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1]!.fields, sent[0]!.fields);
    assert.equal(document.querySelector<HTMLInputElement>('.sote-compose-title')!.value, '');
    assert.equal(document.querySelector('.sote-compose-meta'), null);
    await click('button[aria-label="sote.note"]');
    await act(async () => view.destroy());
    assert.equal(document.querySelector('[role="dialog"]'), null, 'removing the block cleans up its portal');
  } finally {
    if (!view.isDestroyed) await act(async () => view.destroy());
    doc.destroy(); mount.remove(); globalThis.fetch = savedFetch;
  }
});
