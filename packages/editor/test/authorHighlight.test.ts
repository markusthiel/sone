/**
 * Drawing one person's writing in the page (ADR-0091).
 *
 * Reported as: "Im Leute Menü soll man ja texte hervorheben können wenn man eine
 * Person anwählt. Da tut sich auch nichts im Content. man sieht nichts."
 *
 * Every link in that chain had something. The click handler, the bridge, the
 * listener that dispatches a transaction, the plugin, the per-character
 * authorship, the CSS class — all present, and `contributors.test.ts` asserts
 * each of them **as source text**: `assert.match(bridge, /export function
 * registerHighlighter/)`. Eleven tests that a wire exists, and none that
 * anything comes out of it.
 *
 * The one half with no test was the one the file's own header calls the risky
 * part: turning an index inside a `Y.XmlText` into a position in the editor.
 * It looked the text up in y-prosemirror's mapping expecting a node, and
 * y-prosemirror keys a text to an **array** of text nodes. An array is truthy,
 * so it passed the guard; no node in the document was ever identity-equal to
 * it; every range was skipped; the decoration set was always empty.
 *
 * So this file mounts a real `EditorView` and asks what is decorated. That is
 * the only question worth asking here, and it needed jsdom rather than a
 * headless state — y-prosemirror's mapping is built by the plugin's `view()`
 * method, so without a view it is empty and every lookup returns null, which is
 * indistinguishable from the bug.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { pageContent } from '@sone/core';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

import type { DecorationSet } from 'prosemirror-view';

let dom: JSDOM;
let createEditor: typeof import('../src/editor.js').createEditor;
let seedEmptyPage: typeof import('../src/editor.js').seedEmptyPage;
let authorHighlightKey: typeof import('../src/authorHighlight.js').authorHighlightKey;
let highlightClients: typeof import('../src/authorHighlight.js').highlightClients;

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

describe('highlighting one person’s writing', () => {
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
    const plugin = await import('../src/authorHighlight.js');
    authorHighlightKey = plugin.authorHighlightKey;
    highlightClients = plugin.highlightClients;
  });

  after(() => {
    dom?.window.close();
  });

  const mountPoint = (): HTMLElement => {
    const element = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(element);
    return element as unknown as HTMLElement;
  };

  /**
   * A page one person wrote and another added to, bound to a live editor.
   *
   * Two Yjs documents synced to each other, because that is the only way to get
   * two client ids into one document's item list — which is what authorship is
   * made of.
   */
  function twoAuthors(): {
    view: ReturnType<typeof createEditor>;
    mine: number;
    theirs: number;
    cleanup: () => void;
  } {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedEmptyPage(pageContent(a));
    // The seeded paragraph is empty — a paragraph with no text child — so the
    // first writer creates the text as well as filling it, which is what
    // typing into a fresh page does.
    (pageContent(a).get(0) as Y.XmlElement).insert(0, [new Y.XmlText()]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Each writes into the paragraph the other can see.
    const paragraphOf = (doc: Y.Doc): Y.XmlText =>
      (pageContent(doc).get(0) as Y.XmlElement).get(0) as Y.XmlText;

    paragraphOf(a).insert(0, 'Anna schrieb das. ');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    paragraphOf(b).insert(18, 'Bert kam dazu.');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));

    const view = createEditor(mountPoint(), {
      fragment: pageContent(a),
      editable: () => true,
    });
    return {
      view,
      mine: a.clientID,
      theirs: b.clientID,
      cleanup: () => {
        view.destroy();
        a.destroy();
        b.destroy();
      },
    };
  }

  /** The decorations the plugin is currently drawing. */
  const drawn = (view: ReturnType<typeof createEditor>): Array<{ from: number; to: number }> => {
    const state = authorHighlightKey.getState(view.state);
    const set = state?.decorations as DecorationSet | undefined;
    if (!set) return [];
    return set
      .find()
      .map((one) => ({ from: one.from, to: one.to }))
      .sort((x, y) => x.from - y.from);
  };

  test('nothing is drawn until somebody is chosen', () => {
    // A page nobody is inspecting pays nothing, which is the plugin's own
    // stated rule and the easy half to get right.
    const { view, cleanup } = twoAuthors();
    try {
      assert.deepEqual(drawn(view), []);
    } finally {
      cleanup();
    }
  });

  test('choosing a person marks what they wrote, and only that', () => {
    /*
     * The test that did not exist, and the bug it would have caught on the day
     * the feature shipped: this came back empty for every selection.
     *
     * Positions are the editor's, so the paragraph's text starts at 1. Anna
     * wrote the first 18 characters, Bert the 14 after them.
     */
    const { view, mine, theirs, cleanup } = twoAuthors();
    try {
      view.dispatch(
        view.state.tr.setMeta(authorHighlightKey, highlightClients(new Set([mine]))),
      );
      assert.deepEqual(
        drawn(view),
        [{ from: 1, to: 19 }],
        'her sentence, not his',
      );

      view.dispatch(
        view.state.tr.setMeta(authorHighlightKey, highlightClients(new Set([theirs]))),
      );
      assert.deepEqual(drawn(view), [{ from: 19, to: 33 }], 'and his, not hers');
    } finally {
      cleanup();
    }
  });

  test('choosing nobody clears it again', () => {
    // The other half of the control. A highlight that cannot be turned off is a
    // page somebody has to reload to read normally.
    const { view, mine, cleanup } = twoAuthors();
    try {
      view.dispatch(
        view.state.tr.setMeta(authorHighlightKey, highlightClients(new Set([mine]))),
      );
      assert.equal(drawn(view).length, 1);

      view.dispatch(view.state.tr.setMeta(authorHighlightKey, highlightClients(null)));
      assert.deepEqual(drawn(view), []);
    } finally {
      cleanup();
    }
  });

  test('it follows the words when somebody types above them', () => {
    /*
     * The reason the positions come from y-prosemirror rather than from
     * arithmetic here. A paragraph boundary costs a position in the editor and
     * nothing in the text, and an edit before the range moves it — so a
     * highlight computed once and kept is a confident false claim about who
     * wrote a sentence, which the plugin's header says is worse than showing
     * nothing.
     */
    const { view, theirs, cleanup } = twoAuthors();
    try {
      view.dispatch(
        view.state.tr.setMeta(authorHighlightKey, highlightClients(new Set([theirs]))),
      );
      const before = drawn(view);
      assert.equal(before.length, 1);

      // A third person's five characters, at the very start.
      view.dispatch(view.state.tr.insertText('Hmm, ', 1));

      const after = drawn(view);
      assert.equal(after.length, 1);
      assert.equal(after[0]!.from, before[0]!.from + 5, 'moved by exactly what was typed');
      assert.equal(after[0]!.to, before[0]!.to + 5);
    } finally {
      cleanup();
    }
  });
});
