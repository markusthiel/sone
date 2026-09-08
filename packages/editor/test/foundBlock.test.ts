/**
 * The flash that the editor ate (ADR-0167).
 *
 * ADR-0166 lit a block by writing `data-found` onto its DOM element. Reported
 * the day it was released: *„Übrigens leuchtet der Eintrag nicht auf wenn ich
 * ihn in der Seitenleiste anklicke, aber er springt jetzt an die richtige
 * stelle und scrollt korrekt."*
 *
 * ProseMirror owns that element. Measured, with a real mounted editor: the
 * attribute is there the instant it is written and **gone within a tick** — the
 * DOM observer reconciles the element back to what the document says.
 *
 * So the flash is a decoration now, which is the one way to put something on a
 * ProseMirror-rendered element and have it stay there. These tests mount a real
 * editor, because that is the only place the fault existed: the previous round's
 * test set the attribute on a plain jsdom element with no editor around it, and
 * agreed with itself.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { BLOCK_ATTRS, pageContent } from '@sone/core';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

let dom: JSDOM;
let createEditor: typeof import('../src/editor.js').createEditor;
let showFoundBlock: typeof import('../src/foundBlock.js').showFoundBlock;

const DOM_GLOBALS = [
  'window', 'document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment',
  'Range', 'getComputedStyle', 'MutationObserver', 'DOMParser', 'Event',
  'KeyboardEvent', 'InputEvent', 'CompositionEvent', 'ClipboardEvent',
] as const;

const ID = '00000000-0000-4000-8000-000000000101';
const OTHER = '00000000-0000-4000-8000-000000000102';

describe('lighting a block the editor owns', () => {
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
    showFoundBlock = (await import('../src/foundBlock.js')).showFoundBlock;
  });

  after(() => {
    dom?.window.close();
  });

  /** A page with two paragraphs, mounted, with the view and a way to read the DOM. */
  function mounted(): {
    view: ReturnType<typeof createEditor>;
    close: () => void;
    foundIds: () => string[];
  } {
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    ydoc.transact(() => {
      for (const [id, text] of [
        [ID, 'Überblick Räumlichkeiten'],
        [OTHER, 'Anmeldungen'],
      ] as const) {
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.setAttribute(BLOCK_ATTRS.id, id);
        paragraph.insert(0, [new Y.XmlText(text)]);
        fragment.push([paragraph]);
      }
    });

    const mount = dom.window.document.createElement('div');
    dom.window.document.body.append(mount);
    const view = createEditor(mount as unknown as HTMLElement, {
      fragment,
      editable: () => true,
    });
    return {
      view,
      close: () => {
        view.destroy();
        ydoc.destroy();
        mount.remove();
      },
      foundIds: () =>
        [...mount.querySelectorAll('[data-found]')].map(
          (element) => element.getAttribute('data-block-id') ?? '?',
        ),
    };
  }

  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

  test('the block is lit, and it is still lit a tick later', async () => {
    /*
     * The second half is the whole test. Writing the attribute directly also
     * passed the first half — for one frame, which is not long enough for
     * anybody to see and is exactly what was reported.
     */
    const page = mounted();
    try {
      showFoundBlock(page.view, ID);
      assert.deepEqual(page.foundIds(), [ID], 'lit');

      await tick();
      assert.deepEqual(page.foundIds(), [ID], 'and it survived the reconciliation');
    } finally {
      page.close();
    }
  });

  test('and it survives somebody typing in another block', async () => {
    // A decoration is mapped through the transaction; an attribute is not. The
    // panel is often clicked while a document is being written in.
    const page = mounted();
    try {
      showFoundBlock(page.view, ID);
      page.view.dispatch(page.view.state.tr.insertText('!', 3));
      await tick();

      assert.deepEqual(page.foundIds(), [ID]);
    } finally {
      page.close();
    }
  });

  test('null puts it out', async () => {
    const page = mounted();
    try {
      showFoundBlock(page.view, ID);
      showFoundBlock(page.view, null);
      await tick();

      assert.deepEqual(page.foundIds(), []);
    } finally {
      page.close();
    }
  });

  test('one at a time, so the second jump does not look like nothing happened', async () => {
    const page = mounted();
    try {
      showFoundBlock(page.view, ID);
      showFoundBlock(page.view, OTHER);
      await tick();

      assert.deepEqual(page.foundIds(), [OTHER]);
    } finally {
      page.close();
    }
  });

  test('an id no block carries lights nothing, and throws nothing', async () => {
    // It comes from a panel that reads the document; a block deleted between
    // the render and the click is an ordinary race, not a fault.
    const page = mounted();
    try {
      showFoundBlock(page.view, 'nobody');
      await tick();
      assert.deepEqual(page.foundIds(), []);
    } finally {
      page.close();
    }
  });
});
