/**
 * Following a link (ADR-0157).
 *
 * Reported as *„wenn man im Text einen Link setzt dann kann man den nicht
 * öffnen"*, and it was two absences wearing one coat: a reader had no way at
 * all, and a writer must keep a plain click for putting the caret in the word.
 *
 * A real editor is mounted and real clicks are dispatched, because every
 * interesting answer here is about a click: which view it lands in, whether a
 * modifier was held, and what the anchor's attribute actually says. A test that
 * called the handler directly would be a test that a wire exists (ADR-0091).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { pageContent } from '@sone/core';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

let dom: JSDOM;
let createEditor: typeof import('../src/editor.js').createEditor;
let schema: typeof import('../src/schema.js').schema;

const DOM_GLOBALS = [
  'window', 'document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment',
  'Range', 'getComputedStyle', 'MutationObserver', 'DOMParser',
  'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'CompositionEvent',
  'ClipboardEvent',
] as const;

describe('a link in the text', () => {
  /** Where `window.open` was asked to go, for the life of one test. */
  let opened: string[] = [];

  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    for (const key of DOM_GLOBALS) {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
    Object.defineProperty(dom.window, 'open', {
      value: (href: string) => {
        opened.push(href);
        return null;
      },
      configurable: true,
      writable: true,
    });

    createEditor = (await import('../src/editor.js')).createEditor;
    schema = (await import('../src/schema.js')).schema;
  });

  after(() => dom?.window.close());

  /**
   * An editor holding one paragraph with one link in it.
   *
   * **Written while editable, then locked.** `editGuard` filters every
   * transaction on a page somebody may not change (ADR-0049) — including the
   * one that puts the text there — so a read-only editor built this way starts
   * empty and draws no anchor at all. Which is how the first version of this
   * test passed the case it was meant to catch: no link, no opening, green.
   */
  function editorWith(href: string, editable: boolean) {
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    const mount = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(mount);

    let canEdit = true;
    const view = createEditor(mount as unknown as HTMLElement, {
      fragment,
      editable: () => canEdit,
    });
    const link = schema.marks['link']!.create({ href, title: null });
    const paragraph = schema.nodes['paragraph']!.create(
      { id: 'b1' },
      schema.text('zur Satzung', [link]),
    );
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, paragraph));

    canEdit = editable;
    // The view caches the answer; asking it to re-read is what makes the lock
    // take effect on an editor that is already up.
    view.setProps({ editable: () => canEdit });
    return { view, ydoc, mount };
  }

  /** Click the anchor the editor drew, with whatever keys were held. */
  function clickTheLink(
    mount: HTMLElement,
    keys: { metaKey?: boolean; ctrlKey?: boolean } = {},
  ): void {
    const anchor = (mount as unknown as Element).querySelector('a[href]');
    assert.ok(anchor, 'the editor drew an anchor');
    anchor.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...keys }),
    );
  }

  test('a reader clicks it and it opens', () => {
    /*
     * A page opened through a share link, or any page somebody may not edit, is
     * a document — and a link in a document is followed by clicking it. Nothing
     * was refusing this on purpose; there was simply no handler, and ProseMirror
     * does not follow links itself.
     */
    opened = [];
    const { view, ydoc, mount } = editorWith('https://example.org/satzung', false);
    try {
      clickTheLink(mount as unknown as HTMLElement);
      assert.deepEqual(opened, ['https://example.org/satzung']);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('a writer clicks it and the caret goes in', () => {
    // A link nobody can correct is worse than one nobody can follow, so the
    // plain click stays what it was. The interface answers it with a card over
    // the caret instead.
    opened = [];
    const { view, ydoc, mount } = editorWith('https://example.org/satzung', true);
    try {
      clickTheLink(mount as unknown as HTMLElement);
      assert.deepEqual(opened, [], 'nothing opened');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('and with the modifier held, it opens for them too', () => {
    // `metaKey` on a Mac and `ctrlKey` everywhere else — the pair every other
    // shortcut in this editor is built from.
    for (const keys of [{ metaKey: true }, { ctrlKey: true }]) {
      opened = [];
      const { view, ydoc, mount } = editorWith('https://example.org/satzung', true);
      try {
        clickTheLink(mount as unknown as HTMLElement, keys);
        assert.deepEqual(opened, ['https://example.org/satzung'], JSON.stringify(keys));
      } finally {
        view.destroy();
        ydoc.destroy();
      }
    }
  });

  test('an address that executes is not followed, however it got there', () => {
    /*
     * Nothing can put one in a document any more — the schema refuses it at
     * paste and `normaliseHref` refuses it at typing (ADR-0157). But a CRDT
     * keeps whatever ever reached it, and documents written before that door
     * existed are still out there. The question is asked again at the moment of
     * following, which is the moment it would matter.
     */
    opened = [];
    const { view, ydoc, mount } = editorWith('javascript:alert(1)', false);
    try {
      clickTheLink(mount as unknown as HTMLElement);
      assert.deepEqual(opened, []);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('a relative link stays relative', () => {
    /*
     * The attribute, not the property. `anchor.href` is resolved against the
     * page's own origin, so a link written to survive being read behind another
     * host would be opened at this one — and a refused scheme would come back
     * looking like something else entirely.
     */
    opened = [];
    const { view, ydoc, mount } = editorWith('/p/abc/eine-seite', false);
    try {
      clickTheLink(mount as unknown as HTMLElement);
      assert.deepEqual(opened, ['/p/abc/eine-seite']);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });
});
