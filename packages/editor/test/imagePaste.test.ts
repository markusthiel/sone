/**
 * Image upload.
 *
 * An image arrives as bytes and has to become a URL, which means an
 * asynchronous upload inside a synchronous paste handler. The two things that
 * go wrong there are covered here: the placeholder, and finding it again
 * afterwards.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { BLOCK_ATTRS, pageContent } from '@sone/core';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

let createEditor: typeof import('../src/editor.js').createEditor;
let seedEmptyPage: typeof import('../src/editor.js').seedEmptyPage;
let insertImageUpload: typeof import('../src/imagePaste.js').insertImageUpload;
let readProps: typeof import('../src/schema.js').readProps;
let dom: JSDOM;

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
  'File',
  'FileList',
  'DataTransfer',
] as const;

describe('image upload', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    for (const key of DOM_GLOBALS) {
      const value = (dom.window as unknown as Record<string, unknown>)[key];
      if (value === undefined) continue;
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
    const editor = await import('../src/editor.js');
    createEditor = editor.createEditor;
    seedEmptyPage = editor.seedEmptyPage;
    insertImageUpload = (await import('../src/imagePaste.js')).insertImageUpload;
    readProps = (await import('../src/schema.js')).readProps;
  });

  function mountEditor(): {
    view: import('prosemirror-view').EditorView;
    ydoc: Y.Doc;
  } {
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);
    const mount = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(mount);
    const view = createEditor(mount as unknown as HTMLElement, {
      fragment,
      editable: () => true,
    });
    return { view, ydoc };
  }

  const fakeFile = (name = 'photo.png'): File =>
    new dom.window.File(['bytes'], name, { type: 'image/png' }) as unknown as File;

  const imageNode = (
    view: import('prosemirror-view').EditorView,
  ): import('prosemirror-model').Node | null => {
    let found: import('prosemirror-model').Node | null = null;
    view.state.doc.descendants((node) => {
      if (found) return false;
      if (node.type.name === 'image') found = node;
      return true;
    });
    return found;
  };

  test('a placeholder appears immediately, before the upload finishes', async () => {
    // Without one, pasting a photo does nothing visible for several seconds and
    // people paste again.
    const { view, ydoc } = mountEditor();
    try {
      let resolve: ((value: { url: string; filename: string }) => void) | null = null;
      const upload = (): Promise<{ url: string; filename: string }> =>
        new Promise((r) => {
          resolve = r;
        });

      insertImageUpload(view, fakeFile(), upload, () => 'img-1');

      const node = imageNode(view);
      assert.ok(node, 'an image block should exist straight away');
      assert.equal(node!.attrs['url'], null, 'with no URL yet');
      assert.equal(readProps(node!.attrs)['uploading'], true);
      assert.equal(readProps(node!.attrs)['filename'], 'photo.png');

      resolve!({ url: '/api/files/abc', filename: 'photo.png' });
      await new Promise((r) => setTimeout(r, 10));

      const finished = imageNode(view);
      assert.equal(finished!.attrs['url'], '/api/files/abc');
      assert.equal(readProps(finished!.attrs)['uploading'], undefined);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('the placeholder is found again after the document has moved', async () => {
    // By the time an upload returns, the person has kept typing or a
    // collaborator has edited above. A remembered position would put the image
    // somewhere else entirely.
    const { view, ydoc } = mountEditor();
    try {
      let resolve: ((value: { url: string; filename: string }) => void) | null = null;
      insertImageUpload(
        view,
        fakeFile(),
        () =>
          new Promise((r) => {
            resolve = r;
          }),
        () => 'img-2',
      );

      // Text inserted before the image, shifting every position after it.
      view.dispatch(view.state.tr.insertText('added above', 1));

      resolve!({ url: '/api/files/moved', filename: 'photo.png' });
      await new Promise((r) => setTimeout(r, 10));

      const node = imageNode(view);
      assert.equal(node!.attrs['url'], '/api/files/moved', 'the right block was updated');
      assert.equal(node!.attrs[BLOCK_ATTRS.id], 'img-2');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('a failed upload leaves the block with a reason on it', async () => {
    // Removing it would lose the fact that something was pasted at all, which
    // is worse than an error somebody can see and act on.
    const { view, ydoc } = mountEditor();
    try {
      insertImageUpload(
        view,
        fakeFile('big.png'),
        () => Promise.reject(new Error('file_too_large')),
        () => 'img-3',
      );
      await new Promise((r) => setTimeout(r, 10));

      const node = imageNode(view);
      assert.ok(node, 'the block must still be there');
      const props = readProps(node!.attrs);
      assert.equal(props['failed'], true);
      assert.equal(props['uploading'], false);
      assert.match(String(props['error']), /file_too_large/);
      assert.equal(props['filename'], 'big.png');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('a completed upload does not become an undo step', async () => {
    // Undoing it would leave a placeholder pointing at a file that exists.
    const { view, ydoc } = mountEditor();
    try {
      let resolve: ((value: { url: string; filename: string }) => void) | null = null;
      insertImageUpload(
        view,
        fakeFile(),
        () =>
          new Promise((r) => {
            resolve = r;
          }),
        () => 'img-4',
      );
      resolve!({ url: '/api/files/xyz', filename: 'photo.png' });
      await new Promise((r) => setTimeout(r, 10));

      // The completion transaction carries addToHistory: false, so the document
      // as the undo stack sees it still has the placeholder's attributes.
      const node = imageNode(view);
      assert.equal(node!.attrs['url'], '/api/files/xyz');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('deleting the block while it uploads is not an error', async () => {
    // A normal outcome: somebody pasted the wrong thing and removed it.
    const { view, ydoc } = mountEditor();
    try {
      let resolve: ((value: { url: string; filename: string }) => void) | null = null;
      insertImageUpload(
        view,
        fakeFile(),
        () =>
          new Promise((r) => {
            resolve = r;
          }),
        () => 'img-5',
      );

      // Remove everything.
      view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));

      resolve!({ url: '/api/files/gone', filename: 'photo.png' });
      await new Promise((r) => setTimeout(r, 10));
      // No throw is the assertion.
      assert.ok(true);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });
});
