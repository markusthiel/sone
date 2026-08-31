/**
 * What happens to a block type a client does not know.
 *
 * Written while chasing a video block that uploaded, played, and then vanished
 * from the page. This is the mechanism that does that, and it is worth a test of
 * its own because nothing in this codebase says it out loud:
 *
 * y-prosemirror builds each node with `schema.node(el.nodeName, …)` and, when
 * that throws, **deletes the element from the shared document** — inside a
 * transaction, which syncs the deletion to everybody. A client with an older
 * schema does not ignore a block it cannot draw. It removes it, silently, for
 * everyone.
 *
 * So adding a block type is a document format change whether or not the stored
 * shape changed, and a client that predates it must be refused rather than
 * allowed to open a document containing one.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';
import { Schema } from 'prosemirror-model';
import * as Y from 'yjs';

import { pageContent } from '@sone/core';

let dom: JSDOM;

describe('a block type the schema does not know', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
      'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver', 'Event',
      'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame'] as const) {
      const value = (dom.window as unknown as Record<string, unknown>)[key];
      if (value === undefined) continue;
      try {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      } catch {
        // Getter-only on the Node global.
      }
    }
  });

  test('an old client deletes it from the document, rather than ignoring it', async () => {
    const { EditorState } = await import('prosemirror-state');
    const { EditorView } = await import('prosemirror-view');
    const { ySyncPlugin } = await import('y-prosemirror');
    const { schema } = await import('../src/schema.js');

    // A document containing a video block, as a current client writes one.
    const ydoc = new Y.Doc();
    const element = new Y.XmlElement('video');
    element.setAttribute('source', 'file');
    element.setAttribute('fileId', 'f1');
    pageContent(ydoc).insert(0, [element]);
    assert.equal(pageContent(ydoc).length, 1);

    // A client whose schema predates the block: the same schema minus `video`.
    // `spec.nodes` is an OrderedMap, not an object — and the order matters, since
    // the first node is the schema's top type.
    const older = new Schema({
      nodes: schema.spec.nodes.remove('video') as never,
      marks: schema.spec.marks as never,
    });

    const mount = dom.window.document.getElementById('root')!;
    const view = new EditorView(mount as never, {
      state: EditorState.create({
        schema: older,
        plugins: [ySyncPlugin(pageContent(ydoc))],
      }),
    });

    // Not "it renders as nothing". It is gone from the document, for everyone.
    assert.equal(
      pageContent(ydoc).length,
      0,
      'y-prosemirror deleted the element it could not turn into a node',
    );
    view.destroy();
  });

  test('a current client keeps it', async () => {
    // The other half, so the first test cannot pass because of a broken harness.
    const { EditorState } = await import('prosemirror-state');
    const { EditorView } = await import('prosemirror-view');
    const { ySyncPlugin } = await import('y-prosemirror');
    const { schema } = await import('../src/schema.js');

    const ydoc = new Y.Doc();
    const element = new Y.XmlElement('video');
    element.setAttribute('source', 'file');
    element.setAttribute('fileId', 'f1');
    pageContent(ydoc).insert(0, [element]);

    const mount = dom.window.document.createElement('div');
    dom.window.document.body.append(mount);
    const view = new EditorView(mount as never, {
      state: EditorState.create({ schema, plugins: [ySyncPlugin(pageContent(ydoc))] }),
    });

    assert.equal(pageContent(ydoc).length, 1, 'still there');
    view.destroy();
  });
});
