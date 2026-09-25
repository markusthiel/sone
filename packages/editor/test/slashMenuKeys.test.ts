/**
 * The `/` menu gets the key, and puts the caret down (ADR-0200).
 *
 * Two faults that SOTE found in its copy of this package and this repository
 * did not. Both are about the moment after the menu is open, and neither is
 * visible to a headless test of the menu alone — they live in how the editor is
 * assembled and in what `runSlashItem` leaves behind.
 *
 * So this mounts a real `EditorView`, like `mount.test.ts` does and for the
 * same reason: a plugin can be perfectly correct and still never be asked.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { pageContent } from '@sone/core';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

let dom: JSDOM;
let createEditor: typeof import('../src/editor.js').createEditor;
let seedEmptyPage: typeof import('../src/editor.js').seedEmptyPage;
let openSlashMenu: typeof import('../src/slashMenu.js').openSlashMenu;
let slashMenuState: typeof import('../src/slashMenu.js').slashMenuState;
let runSlashItem: typeof import('../src/slashMenu.js').runSlashItem;
let SLASH_ITEMS: typeof import('../src/slashMenu.js').SLASH_ITEMS;
let slashMenuPluginKey: typeof import('../src/slashMenu.js').slashMenuPluginKey;

const DOM_GLOBALS = [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'DocumentFragment',
  'Range',
  'getComputedStyle',
  'MutationObserver',
  'DOMParser',
  'Event',
  'KeyboardEvent',
  'InputEvent',
  'CompositionEvent',
  'ClipboardEvent',
] as const;

describe('the slash menu and the keys', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    for (const key of DOM_GLOBALS) {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
    const editor = await import('../src/editor.js');
    createEditor = editor.createEditor;
    seedEmptyPage = editor.seedEmptyPage;
    const menu = await import('../src/slashMenu.js');
    openSlashMenu = menu.openSlashMenu;
    slashMenuState = menu.slashMenuState;
    runSlashItem = menu.runSlashItem;
    SLASH_ITEMS = menu.SLASH_ITEMS;
    slashMenuPluginKey = menu.slashMenuPluginKey;
  });

  after(() => {
    dom?.window.close();
  });

  const mounted = (): { view: ReturnType<typeof createEditor>; ydoc: Y.Doc } => {
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);
    const element = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(element);
    const view = createEditor(element as unknown as HTMLElement, {
      fragment,
      editable: () => true,
    });
    return { view, ydoc };
  };

  test('nothing ahead of the menu claims Enter while it is open', () => {
    /*
     * The fault this pins: the menu sat *after* `soneKeymap`, and
     * `EditorView.someProp` walks the plugins in array order and returns at the
     * first that answers — so the keymap took Enter and the menu never saw it.
     * The arrows worked, because the keymap binds none, which is how it
     * survived.
     *
     * Asked of the assembled view rather than of the source: the position in
     * that array is the entire behaviour. Plugins ahead of the menu are
     * allowed — undo binds Mod-z and belongs in front — they just may not
     * answer the key the menu is waiting for.
     */
    const { view, ydoc } = mounted();
    try {
      openSlashMenu(view);
      const plugins = view.state.plugins;
      const menuAt = plugins.findIndex((plugin) => plugin.spec.key === slashMenuPluginKey);
      assert.ok(menuAt >= 0, 'the slash menu is among the plugins');

      for (let index = 0; index < menuAt; index += 1) {
        const plugin = plugins[index];
        const handler = plugin?.props.handleKeyDown;
        if (!plugin || !handler) continue;
        const answered = handler.call(
          plugin,
          view,
          new dom.window.KeyboardEvent('keydown', { key: 'Enter' }),
        );
        assert.ok(
          !answered,
          `plugin ${index} answers Enter before the menu at ${menuAt} is asked`,
        );
      }
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('Enter picks the highlighted item instead of splitting the block', () => {
    const { view, ydoc } = mounted();
    try {
      openSlashMenu(view);
      assert.ok(slashMenuState(view.state), 'the menu is open');

      const before = view.state.doc.childCount;
      view.someProp('handleKeyDown', (handler) =>
        handler(view, new dom.window.KeyboardEvent('keydown', { key: 'Enter' })),
      );

      assert.equal(slashMenuState(view.state), null, 'the menu closed');
      assert.equal(
        view.state.doc.childCount,
        before,
        'and the block was not split behind its back',
      );
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('an inserted block takes the caret with it', () => {
    /*
     * The insert branch of `runSlashItem` was the only one of three that set no
     * selection, so a table appeared and the next keystroke went wherever the
     * caret had been left — in the paragraph above it.
     *
     * Written with the paragraph non-empty on purpose: an empty one is
     * *replaced* by the table, and the caret then lands in a cell by accident
     * of position mapping. The gap only shows when the table is inserted
     * *after* writing, which is the case somebody actually hits.
     */
    const { view, ydoc } = mounted();
    try {
      const table = SLASH_ITEMS.find((item) => item.id === 'table');
      assert.ok(table, 'there is a table item');

      view.dispatch(view.state.tr.insertText('Hallo', 1));
      openSlashMenu(view);
      runSlashItem(view, table);

      const { $from } = view.state.selection;
      let cellDepth = -1;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const name = $from.node(depth).type.name;
        if (name === 'table_cell' || name === 'table_header') cellDepth = depth;
      }
      assert.ok(cellDepth > 0, 'the caret sits in a cell of the new table');

      /*
       * And in the FIRST cell. Without the fix the caret still ended up inside
       * the table — position mapping carries it there — but in the last cell,
       * which is what was reported: "beim Ausprobieren unten rechts". So "in a
       * cell" is not the assertion; "where writing continues" is.
       */
      assert.equal($from.index(cellDepth - 1), 0, 'first cell of its row');
      assert.equal($from.index(cellDepth - 2), 0, 'first row of the table');
      assert.equal(view.state.doc.firstChild?.textContent, 'Hallo', 'and the writing is untouched');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });
});
