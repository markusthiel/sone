import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { ComponentProps } from 'react';
import { JSDOM } from 'jsdom';
import type { Sidebar } from '../src/components/Sidebar.tsx';
import type { PageNode } from '../src/api/client.ts';

let dom: JSDOM;
let render: (props: ComponentProps<typeof Sidebar>) => Promise<void>;
let act: typeof import('react').act;
let cleanup: () => void;
const originalFetch = globalThis.fetch;

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  for (const key of [
    'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
    'Event', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
  ]) {
    Object.defineProperty(globalThis, key, {
      value: (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true, writable: true,
    });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.fetch = async () => new Response(JSON.stringify({ templates: [
    { id: 'template', title: 'Meeting', kind: 'page' },
  ] }), { headers: { 'content-type': 'application/json' } });
  const react = await import('react');
  act = react.act;
  const { createRoot } = await import('react-dom/client');
  const { Sidebar } = await import('../src/components/Sidebar.tsx');
  const root = createRoot(document.getElementById('root')!);
  render = async (props) => {
    await act(async () => root.render(null));
    await act(async () => root.render(react.createElement(Sidebar, props)));
  };
  cleanup = () => root.unmount();
});

after(async () => {
  await act(async () => cleanup());
  dom.window.close();
  globalThis.fetch = originalFetch;
});

function node(id: string, parentPageId: string | null = null): PageNode {
  return {
    id, parentPageId, kind: 'folder', title: id, idx: 'a0', role: 'admin',
    icon: null, collectionId: null, archived: false, lastEditedAt: '',
    children: [], depth: parentPageId ? 1 : 0,
  };
}

async function mount(tree: PageNode[] = [node('parent')]) {
  localStorage.clear();
  localStorage.setItem('sone.collapsedPages', JSON.stringify(['parent']));
  const calls: unknown[][] = [];
  const noop = () => {};
  await render({
    mode: 'tree', searchQuery: '', onSearch: noop,
    workspaceId: 'workspace', workspaceName: 'Workspace', currentIcon: null,
    onSwitchWorkspace: noop, tree, currentPageId: null, open: true, onClose: noop,
    onCreatePage: (...args) => calls.push(args), onRename: noop, onDelete: noop,
    onStartMove: noop, onStartMoveToWorkspace: noop, onStartExport: noop,
    onStartImport: noop, onStartShare: noop, onMove: noop,
    favourites: [], favouriteIds: new Set(), onToggleFavourite: noop,
    onReloadTree: noop,
  });
  return calls;
}

async function click(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  assert.ok(element, selector);
  await act(async () => element.click());
}

function field(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('.tree-rename');
  assert.ok(input, 'a name field is visible');
  assert.equal(document.activeElement, input, 'typing goes directly into the name');
  return input;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!
      .set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function key(input: HTMLInputElement, value: string) {
  await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true,
  })));
}

test('a root folder starts with a focused name before existing folders', async () => {
  const calls = await mount();
  await click('.sidebar-section-toggle'); // Adding also reveals a closed section.
  await click('.sidebar-section-add');
  const input = field();
  assert.equal(document.querySelector('.tree-row'), input.parentElement);
  assert.deepEqual(calls, [], 'nothing is created before naming');
  await type(input, '  New folder  ');
  await key(input, 'Enter');
  assert.deepEqual(calls, [[null, 'folder', undefined, 'New folder']]);
  assert.equal(document.querySelector('.tree-rename'), null);
});

for (const [kind, item] of [['page', 1], ['canvas', 2], ['folder', 3]] as const) {
  test(`a new ${kind} opens its collapsed parent and starts before siblings`, async () => {
    const parent = node('parent');
    parent.children = [node('existing', 'parent')];
    const calls = await mount([parent]);
    await click('[data-tree-row="parent"] .tree-add');
    await click(`.tree-add-menu button:nth-child(${item})`);
    const input = field();
    assert.equal(document.querySelector('.tree-children')!.firstElementChild, input.parentElement);
    assert.deepEqual(calls, []);
    await type(input, 'New entry');
    await act(async () => input.blur());
    assert.deepEqual(calls, [['parent', kind, undefined, 'New entry']]);
  });
}

test('Escape and an empty name cancel without creating an empty entry', async () => {
  const calls = await mount([]);
  await click('.sidebar-section-add');
  await type(field(), 'Discard this');
  await key(field(), 'Escape');
  assert.equal(document.querySelector('.tree-rename'), null);
  await click('.sidebar-section-add');
  await type(field(), '   ');
  await key(field(), 'Enter');
  assert.equal(document.querySelector('.tree-rename'), null);
  assert.deepEqual(calls, []);
});

test('a template keeps its identity when named inside an empty folder', async () => {
  const calls = await mount();
  await click('[data-tree-row="parent"] .tree-add');
  await click('.tree-add-menu button:last-child');
  await type(field(), 'Weekly meeting');
  await key(field(), 'Enter');
  assert.deepEqual(calls, [['parent', 'page', 'template', 'Weekly meeting']]);
});
