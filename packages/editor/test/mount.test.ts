/**
 * Editor mounting tests.
 *
 * These exist because 361 passing tests did not catch a bug that made every
 * page in the application render white.
 *
 * `dispatchTransaction` referenced the `view` const that the EditorView
 * constructor was in the middle of assigning. ySyncPlugin dispatches from
 * inside that constructor — to populate the document from the Yjs fragment — so
 * the callback ran while `view` was still in its temporal dead zone and threw
 * "Cannot access 'view' before initialization". The editor never mounted, React
 * unmounted the tree, and the page went blank.
 *
 * Nothing in the previous suite could have found it: every other test drives
 * EditorState and plugins headlessly, and the bug lived in EditorView
 * construction. A schema, a plugin and a command can all be correct while the
 * thing that assembles them is broken.
 *
 * jsdom rather than a real browser, so this runs in CI without a browser
 * harness. It does not verify rendering, layout or input events — those still
 * need a browser. It verifies that the editor mounts, receives its document,
 * accepts a transaction, and tears down.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { BLOCK_ATTRS, pageContent, readBlockTree } from '@sone/core';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

// Globals must exist before prosemirror-view is imported, so the modules are
// loaded dynamically inside `before`.
let dom: JSDOM;
let createEditor: typeof import('../src/editor.js').createEditor;
let seedEmptyPage: typeof import('../src/editor.js').seedEmptyPage;
let slashMenuState: typeof import('../src/slashMenu.js').slashMenuState;

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

describe('editor mounting', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>', {
      pretendToBeVisual: true,
    });
    for (const key of DOM_GLOBALS) {
      // defineProperty rather than assignment: some globals, `navigator` among
      // them, are getter-only on the Node global object.
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }

    const editor = await import('../src/editor.js');
    createEditor = editor.createEditor;
    seedEmptyPage = editor.seedEmptyPage;
    slashMenuState = (await import('../src/slashMenu.js')).slashMenuState;
  });

  after(() => {
    dom?.window.close();
  });

  const mountPoint = (): HTMLElement => {
    const element = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(element);
    return element as unknown as HTMLElement;
  };

  test('mounts against a seeded empty page', () => {
    // The exact path a freshly created page takes: the API creates it with an
    // empty body, the client seeds one paragraph, the editor binds to it.
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      assert.equal(view.state.doc.childCount, 1);
      assert.equal(view.state.doc.firstChild!.type.name, 'paragraph');
      assert.ok(
        typeof view.state.doc.firstChild!.attrs[BLOCK_ATTRS.id] === 'string',
        'the seeded block must carry an id',
      );
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('mounts against an unseeded empty page', () => {
    // What a viewer sees: no edit rights, so nothing seeds the fragment. It
    // must still mount rather than take the page down.
    const ydoc = new Y.Doc();
    const view = createEditor(mountPoint(), {
      fragment: pageContent(ydoc),
      editable: () => false,
    });
    try {
      assert.ok(view.state.doc.childCount >= 1, 'the schema requires at least one block');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('mounts against a page with existing content', () => {
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    ydoc.transact(() => {
      const heading = new Y.XmlElement('heading');
      heading.setAttribute(BLOCK_ATTRS.id, '00000000-0000-4000-8000-000000000101');
      heading.setAttribute('level', '2');
      heading.insert(0, [new Y.XmlText('Existing')]);
      fragment.insert(0, [heading]);
    });

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      assert.equal(view.state.doc.firstChild!.type.name, 'heading');
      assert.equal(view.state.doc.firstChild!.textContent, 'Existing');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('a transaction dispatched after mount reaches the document and Yjs', () => {
    // Proves dispatchTransaction works in normal operation as well as during
    // construction, and that edits flow back into the CRDT — which is what the
    // server materialises.
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      view.dispatch(view.state.tr.insertText('typed', 1));
      assert.equal(view.state.doc.firstChild!.textContent, 'typed');

      const { blocks } = readBlockTree(ydoc);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0]!.text, 'typed');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('onChange ignores the initial population from Yjs', () => {
    // ySyncPlugin populates the document during construction, which ProseMirror
    // reports as a document change. A consumer using onChange to track unsaved
    // work would otherwise mark every freshly opened page as edited before
    // anyone touched it.
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    let docChanges = 0;
    let stateChanges = 0;
    const view = createEditor(mountPoint(), {
      fragment,
      editable: () => true,
      onChange: () => docChanges++,
      onStateChange: () => stateChanges++,
    });

    try {
      assert.equal(docChanges, 0, 'mounting is not a local edit');

      // A selection-only transaction still reaches onStateChange, which is what
      // the slash menu depends on: it opens and filters without the document
      // changing.
      const before = stateChanges;
      view.dispatch(view.state.tr.setMeta('probe', true));
      assert.equal(stateChanges, before + 1, 'onStateChange must fire');
      assert.equal(docChanges, 0, 'a selection change is not a document change');

      // A real local edit does reach onChange.
      view.dispatch(view.state.tr.insertText('x', 1));
      assert.equal(docChanges, 1, 'a local edit must reach onChange');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('typing a slash through the editor opens the menu', () => {
    // The plugin is tested headlessly elsewhere; this checks it is actually
    // registered on a mounted editor, and in an order where it can act.
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      view.dispatch(view.state.tr.insertText('/', 1));
      const menu = slashMenuState(view.state);
      assert.ok(menu, 'the slash menu should be open');
      assert.ok(menu!.items.length > 0);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('a slash command after text adds a block instead of taking over', async () => {
    // Reported from real use: type some text, reach for /heading, and the
    // heading "jumps somewhere else". It did not jump — the paragraph the text
    // was in became the heading, so the writing turned into a title and no new
    // block appeared where the caret was.
    //
    // Driven through the whole path: type the query so the plugin opens, then
    // run the item as Enter does.
    const { runSlashItem, slashMenuState } = await import('../src/slashMenu.js');
    const { TextSelection } = await import('prosemirror-state');

    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      view.dispatch(view.state.tr.insertText('Hello world', 1));
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(view.state.doc.content.size - 1)),
        ),
      );

      // A space then the query, since a slash mid-word must not open the menu.
      for (const character of ' /h1') {
        const { from, to } = view.state.selection;
        const handled = view.state.plugins.some((plugin) => {
          const handler = plugin.props?.handleTextInput;
          return (
            handler?.call(plugin, view, from, to, character, () => view.state.tr) === true
          );
        });
        if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
      }

      const menu = slashMenuState(view.state);
      assert.ok(menu, 'the menu should be open');
      const item = menu!.items[menu!.index];
      assert.ok(item);
      runSlashItem(view, item!);

      const blocks = view.state.doc.children.map((node) => ({
        type: node.type.name,
        text: node.textContent,
      }));

      assert.equal(blocks.length, 2, `expected two blocks, got ${JSON.stringify(blocks)}`);
      assert.equal(blocks[0]!.type, 'paragraph', 'the writing stays a paragraph');
      assert.match(blocks[0]!.text, /^Hello world/);
      assert.equal(blocks[1]!.type, 'heading', 'the heading is a new block');
      assert.equal(blocks[1]!.text, '', 'and it is empty, ready to type into');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('a slash command in an empty block converts it rather than adding one', async () => {
    // The other half of the rule: in an empty block `/` means "this block is a
    // heading", so adding a second block there would leave an empty paragraph
    // above every heading.
    const { runSlashItem, slashMenuState } = await import('../src/slashMenu.js');

    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      for (const character of '/h1') {
        const { from, to } = view.state.selection;
        const handled = view.state.plugins.some((plugin) => {
          const handler = plugin.props?.handleTextInput;
          return (
            handler?.call(plugin, view, from, to, character, () => view.state.tr) === true
          );
        });
        if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
      }

      const menu = slashMenuState(view.state);
      assert.ok(menu);
      runSlashItem(view, menu!.items[menu!.index]!);

      assert.equal(view.state.doc.childCount, 1, 'still one block');
      assert.equal(view.state.doc.firstChild!.type.name, 'heading');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('the caret lands in the new block, not somewhere else', async () => {
    // The reported symptom: "I suddenly jump some lines further into a text and
    // do not know where the heading ended up." Asserted on the caret as well as
    // on the document, because the document was already right and the caret is
    // what was wrong.
    const { runSlashItem, slashMenuState, openSlashMenu } = await import(
      '../src/slashMenu.js'
    );
    const { TextSelection } = await import('prosemirror-state');

    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    ydoc.transact(() => {
      for (const [index, text] of ['first', 'middle', 'third', 'fourth'].entries()) {
        const element = new Y.XmlElement('paragraph');
        element.setAttribute(BLOCK_ATTRS.id, `0000000-0000-4000-8000-00000000000${index}`);
        element.insert(0, [new Y.XmlText(text)]);
        fragment.insert(fragment.length, [element]);
      }
    });

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      // End of the second paragraph.
      const end = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize - 1;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))),
      );

      assert.ok(openSlashMenu(view), 'the + should open the menu');
      for (const character of 'h1') {
        view.dispatch(view.state.tr.insertText(character));
      }

      const menu = slashMenuState(view.state);
      assert.ok(menu, 'the menu should be open');
      runSlashItem(view, menu!.items[menu!.index]!);

      const blocks = view.state.doc.children.map((node) => ({
        type: node.type.name,
        text: node.textContent,
      }));

      // The heading is directly after the block that was being edited, and the
      // surrounding text is untouched.
      assert.deepEqual(blocks, [
        { type: 'paragraph', text: 'first' },
        { type: 'paragraph', text: 'middle' },
        { type: 'heading', text: '' },
        { type: 'paragraph', text: 'third' },
        { type: 'paragraph', text: 'fourth' },
      ]);

      // And the caret is in it, ready to type the title.
      const $from = view.state.selection.$from;
      assert.equal($from.parent.type.name, 'heading', 'the caret must be in the heading');
      assert.equal($from.index(0), 2, 'which is the third block');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('choosing a type in an empty block converts it in place', async () => {
    // The other half: no new block, and the caret stays where it was.
    const { runSlashItem, slashMenuState } = await import('../src/slashMenu.js');

    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    try {
      for (const character of '/todo') {
        view.dispatch(view.state.tr.insertText(character));
      }
      const menu = slashMenuState(view.state);
      assert.ok(menu);
      runSlashItem(view, menu!.items[menu!.index]!);

      assert.equal(view.state.doc.childCount, 1, 'still one block');
      assert.equal(view.state.doc.firstChild!.type.name, 'todo');
      assert.equal(
        view.state.selection.$from.parent.type.name,
        'todo',
        'and the caret is in it',
      );
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('destroying the editor twice does not throw', () => {
    // React strict mode mounts, unmounts and remounts effects, so a cleanup
    // that cannot run twice shows up as a crash only in development.
    const ydoc = new Y.Doc();
    const fragment = pageContent(ydoc);
    seedEmptyPage(fragment);

    const view = createEditor(mountPoint(), { fragment, editable: () => true });
    view.destroy();
    view.destroy();
    ydoc.destroy();
  });

  test('two editors on the same document converge', () => {
    // Two tabs on one page. Both bind to the same fragment through separate
    // Y.Docs, as two clients would.
    const first = new Y.Doc();
    const firstFragment = pageContent(first);
    seedEmptyPage(firstFragment);

    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const viewA = createEditor(mountPoint(), { fragment: firstFragment, editable: () => true });
    const viewB = createEditor(mountPoint(), {
      fragment: pageContent(second),
      editable: () => true,
    });

    try {
      viewA.dispatch(viewA.state.tr.insertText('from A', 1));
      Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

      assert.equal(viewB.state.doc.firstChild!.textContent, 'from A');
    } finally {
      viewA.destroy();
      viewB.destroy();
      first.destroy();
      second.destroy();
    }
  });
});
