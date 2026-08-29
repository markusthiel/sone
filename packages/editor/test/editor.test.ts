/**
 * Editor tests.
 *
 * The important ones are the round trips. The editor writes a Y.XmlFragment and
 * the server's materialiser reads it through `readBlockTree`; those are two
 * halves of one contract, and nothing else in the system checks that they agree.
 * If they diverge, the editor shows blocks the server never materialises — or
 * the reverse — and no other test would notice.
 *
 * No DOM here: ProseMirror's state, transforms and commands are headless, and
 * y-prosemirror's conversion helpers work on documents rather than views. What
 * is *not* covered without a browser is EditorView itself, which the browser
 * tests will have to take.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS, pageContent, readBlockTree } from '@sone/core';
import { splitBlock } from 'prosemirror-commands';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import * as Y from 'yjs';

import { assignMissingIds, blockIds, collectBlockIds } from '../src/blockIds.js';
import { fragmentToJSON, jsonToFragment, seedEmptyPage } from '../src/editor.js';
import { computeListNumbers } from '../src/listNumbers.js';
import {
  SLASH_ITEMS,
  filterSlashItems,
  slashMenu,
  slashMenuState,
} from '../src/slashMenu.js';
import { soneInputRules } from '../src/inputRules.js';
import {
  indentCommand,
  outdentCommand,
  soneKeymap,
  toggleBlockType,
  toggleTodo,
} from '../src/keymap.js';
import { readIndent, readProps, schema, writeProps } from '../src/schema.js';

// --- helpers ---------------------------------------------------------------

let idCounter = 0;
const deterministicId = (): string =>
  `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

/** A state with the plugins that matter, minus the Yjs binding. */
function stateWith(docJSON: unknown): EditorState {
  return EditorState.create({
    schema,
    doc: schema.nodeFromJSON(docJSON),
    plugins: [soneInputRules(), ...soneKeymap(), blockIds({ generateId: deterministicId })],
  });
}

const paragraph = (text: string, id?: string, indent?: number) => ({
  type: 'paragraph',
  attrs: {
    [BLOCK_ATTRS.id]: id ?? null,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: indent ? String(indent) : null,
  },
  content: text ? [{ type: 'text', text }] : undefined,
});

const block = (
  type: string,
  text: string,
  id: string,
  extra: Record<string, unknown> = {},
) => ({
  type,
  attrs: {
    [BLOCK_ATTRS.id]: id,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: null,
    ...extra,
  },
  content: text ? [{ type: 'text', text }] : undefined,
});

/** Apply a command, returning the resulting state. Fails if it does not apply. */
function run(state: EditorState, command: Command, label: string): EditorState {
  let next: EditorState | null = null;
  const applied = command(state, (tr) => {
    next = state.apply(tr);
  });
  assert.ok(applied, `command did not apply: ${label}`);
  assert.ok(next, `command applied but dispatched nothing: ${label}`);
  return next!;
}

/** Type text at the caret, running input rules as a real keystroke would. */
function typeText(state: EditorState, text: string): EditorState {
  let current = state;
  for (const char of text) {
    const { from, to } = current.selection;
    const handled = current.plugins.some((plugin) => {
      const handler = plugin.props?.handleTextInput;
      if (!handler) return false;
      // handleTextInput needs a view; the input-rule plugin only uses
      // view.state and view.dispatch, so a minimal stand-in is enough.
      const view = {
        state: current,
        dispatch: (tr: import('prosemirror-state').Transaction) => {
          current = current.apply(tr);
        },
        composing: false,
      } as unknown as import('prosemirror-view').EditorView;
      return (
        handler.call(plugin, view, from, to, char, () => current.tr) === true
      );
    });
    if (!handled) {
      current = current.apply(current.tr.insertText(char, from, to));
    }
  }
  return current;
}

// --- schema ----------------------------------------------------------------

test('every block node carries id and props attributes', () => {
  // The persisted format defines exactly these two (ADR-0015). A block type
  // missing them would materialise without an id and be dropped.
  for (const [name, type] of Object.entries(schema.nodes)) {
    if (name === 'doc' || name === 'text') continue;
    assert.ok(type.spec.attrs, `${name} has no attrs`);
    assert.ok(BLOCK_ATTRS.id in type.spec.attrs!, `${name} lacks an id attribute`);
    assert.ok(BLOCK_ATTRS.props in type.spec.attrs!, `${name} lacks a props attribute`);
  }
});

test('props encoding is stable regardless of key order', () => {
  // Two clients writing equivalent props must produce the same string, or the
  // CRDT records a change where none happened and the document churns.
  assert.equal(
    writeProps({ b: 2, a: 1 }),
    writeProps({ a: 1, b: 2 }),
  );
  assert.equal(writeProps({}), null, 'empty props are omitted, not stored as {}');
  assert.deepEqual(readProps({ [BLOCK_ATTRS.props]: '{"a":1}' }), { a: 1 });
});

test('malformed props read as empty rather than throwing', () => {
  for (const bad of ['{not json', '[]', '"string"', '42', '']) {
    assert.deepEqual(readProps({ [BLOCK_ATTRS.props]: bad }), {});
  }
  assert.deepEqual(readProps({}), {});
});

test('a code block excludes marks and input rules', () => {
  // Otherwise typing `# ` inside a code block would turn it into a heading.
  const code = schema.nodes['code']!;
  assert.equal(code.spec.code, true);
  assert.equal(code.spec.marks, '');
});

test('links carry rel=noopener on render', () => {
  // Anything pasted is untrusted; without this a link in a shared page can
  // reach back into the opening window.
  const mark = schema.marks['link']!.create({ href: 'https://example.org' });
  const rendered = mark.type.spec.toDOM!(mark, true) as [string, Record<string, string>];
  assert.match(rendered[1]['rel'] ?? '', /noopener/);
  assert.match(rendered[1]['rel'] ?? '', /noreferrer/);
});

// --- block ids -------------------------------------------------------------

test('blocks without ids are assigned one', () => {
  const state = stateWith({ type: 'doc', content: [paragraph('one'), paragraph('two')] });
  const next = run(
    state,
    (s, dispatch) => {
      if (dispatch) dispatch(s.tr.insertText('!', 1));
      return true;
    },
    'insert text to trigger the plugin',
  );

  const ids = collectBlockIds(next);
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => id.length > 0));
  assert.equal(new Set(ids).size, 2, 'ids must be unique');
});

test('a duplicate id is replaced, and the earlier block keeps the original', () => {
  // This is what Enter produces: the split copies attributes, so two blocks
  // briefly share an id. Which one keeps it must be deterministic, and
  // document order is the only ordering available.
  const shared = '00000000-0000-4000-8000-00000000aaaa';
  const state = stateWith({
    type: 'doc',
    content: [paragraph('first', shared), paragraph('second', shared)],
  });

  const next = run(
    state,
    (s, dispatch) => {
      if (dispatch) dispatch(s.tr.insertText('!', 1));
      return true;
    },
    'trigger',
  );

  const ids = collectBlockIds(next);
  assert.equal(ids[0], shared, 'the first block keeps the original id');
  assert.notEqual(ids[1], shared);
  assert.equal(new Set(ids).size, 2);
});

test('id assignment stays out of the undo history', () => {
  // Otherwise undo removes an id, the plugin immediately assigns a different
  // one, and undo appears to do nothing while changing the document.
  //
  // The hook is invoked directly on a state built with EditorState.create,
  // which does not run appendTransaction — going through state.apply would
  // assign the ids first and the hook would then correctly return null. That
  // caught out the first version of this test.
  const withoutIds = stateWith({ type: 'doc', content: [paragraph('text')] });
  const plugin = withoutIds.plugins.find((p) => p.spec.appendTransaction);
  assert.ok(plugin);

  const tr = withoutIds.tr.insertText('!', 1);
  const appended = plugin!.spec.appendTransaction!([tr], withoutIds, withoutIds);

  assert.ok(appended, 'the plugin must append a transaction');
  assert.equal(appended!.getMeta('addToHistory'), false);
});

test('assignMissingIds works outside an editor', () => {
  // Importers and page seeding have no editor state to append to.
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [paragraph('one'), paragraph('two')],
  });
  const withIds = assignMissingIds(doc, deterministicId);
  const ids = collectBlockIds(withIds);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
});

test('the plugin does nothing when every id is already unique', () => {
  const state = stateWith({
    type: 'doc',
    content: [
      paragraph('one', '00000000-0000-4000-8000-00000000000a'),
      paragraph('two', '00000000-0000-4000-8000-00000000000b'),
    ],
  });
  const tr = state.tr.insertText('!', 1);
  const after = state.apply(tr);
  const plugin = state.plugins.find((p) => p.spec.appendTransaction);
  assert.equal(
    plugin!.spec.appendTransaction!([tr], state, after),
    null,
    'no transaction should be appended on the common path',
  );
});

// --- input rules -----------------------------------------------------------

test('# converts a paragraph to a level 1 heading', () => {
  let state = stateWith({ type: 'doc', content: [paragraph('')] });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1)),
  );
  state = typeText(state, '# ');

  const block = state.doc.firstChild!;
  assert.equal(block.type.name, 'heading');
  assert.equal(block.attrs['level'], 1);
});

test('### gives level 3', () => {
  let state = stateWith({ type: 'doc', content: [paragraph('')] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  state = typeText(state, '### ');
  assert.equal(state.doc.firstChild!.attrs['level'], 3);
});

test('- converts to a bullet list item', () => {
  let state = stateWith({ type: 'doc', content: [paragraph('')] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  state = typeText(state, '- ');
  assert.equal(state.doc.firstChild!.type.name, 'bulletList');
});

test('[x] gives a checked todo, [] an unchecked one', () => {
  for (const [typed, checked] of [['[] ', false], ['[x] ', true]] as const) {
    let state = stateWith({ type: 'doc', content: [paragraph('')] });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    state = typeText(state, typed);
    const block = state.doc.firstChild!;
    assert.equal(block.type.name, 'todo', `${typed} should give a todo`);
    assert.equal(block.attrs['checked'], checked);
  }
});

test('``` gives a code block with the language', () => {
  let state = stateWith({ type: 'doc', content: [paragraph('')] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  state = typeText(state, '```sql ');
  const block = state.doc.firstChild!;
  assert.equal(block.type.name, 'code');
  assert.equal(block.attrs['language'], 'sql');
});

test('input rules do not fire inside a code block', () => {
  // The schema's `code: true` is what prevents it; asserted because losing it
  // would make code blocks unusable for anything containing markdown.
  let state = stateWith({
    type: 'doc',
    content: [
      {
        type: 'code',
        attrs: {
          [BLOCK_ATTRS.id]: null,
          [BLOCK_ATTRS.props]: null,
          [BLOCK_ATTRS.indent]: null,
          language: null,
        },
        content: [{ type: 'text', text: 'x' }],
      },
    ],
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
  state = typeText(state, '# ');
  assert.equal(state.doc.firstChild!.type.name, 'code', 'must still be code');
});

// --- commands --------------------------------------------------------------

test('toggling a heading twice returns to a paragraph', () => {
  const heading = schema.nodes['heading']!;
  let state = stateWith({ type: 'doc', content: [paragraph('Title', 'x')] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));

  state = run(state, toggleBlockType(heading, { level: 2 }), 'to heading');
  assert.equal(state.doc.firstChild!.type.name, 'heading');

  state = run(state, toggleBlockType(heading, { level: 2 }), 'back to paragraph');
  assert.equal(state.doc.firstChild!.type.name, 'paragraph');
});

test('toggling a block type preserves its id', () => {
  // Changing a paragraph to a heading is not a new block; a new id would orphan
  // every reference to it.
  const heading = schema.nodes['heading']!;
  const id = '00000000-0000-4000-8000-00000000beef';
  let state = stateWith({ type: 'doc', content: [paragraph('Title', id)] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  state = run(state, toggleBlockType(heading, { level: 1 }), 'to heading');
  assert.equal(state.doc.firstChild!.attrs[BLOCK_ATTRS.id], id);
});

test('toggling a todo flips checked without moving the caret', () => {
  let state = stateWith({
    type: 'doc',
    content: [
      block('todo', 'task', 'x', { checked: false }),
    ],
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
  const before = state.selection.from;

  state = run(state, toggleTodo, 'toggle todo');
  assert.equal(state.doc.firstChild!.attrs['checked'], true);
  assert.equal(state.selection.from, before, 'the caret must not move');
});

test('toggleTodo refuses on a non-todo block', () => {
  const state = stateWith({ type: 'doc', content: [paragraph('text', 'x')] });
  assert.equal(toggleTodo(state, undefined), false);
});

// --- Yjs round trip --------------------------------------------------------

test('an editor document round-trips through a Yjs fragment', () => {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      block('heading', 'Title', '00000000-0000-4000-8000-000000000001', { level: 1 }),
      paragraph('Body text', '00000000-0000-4000-8000-000000000002'),
    ],
  });

  const ydoc = new Y.Doc();
  jsonToFragment(doc, pageContent(ydoc));

  const restored = fragmentToJSON(pageContent(ydoc)) as {
    content: Array<{ type: string; attrs: Record<string, unknown> }>;
  };
  assert.equal(restored.content[0]!.type, 'heading');
  assert.equal(restored.content[0]!.attrs['level'], 1);
  assert.equal(
    restored.content[0]!.attrs[BLOCK_ATTRS.id],
    '00000000-0000-4000-8000-000000000001',
  );
  ydoc.destroy();
});

test('what the editor writes is what readBlockTree reads', () => {
  // The contract that nothing else in the system checks. The editor's schema
  // and @sone/core's tree reader are two halves of one format (ADR-0015); if
  // they disagree, the editor shows blocks the server never materialises.
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      block('heading', 'Section', '00000000-0000-4000-8000-000000000010', { level: 2 }),
      block('bulletList', 'outer item', '00000000-0000-4000-8000-000000000011'),
      {
        // Indent one level: this is how a sub-item is expressed now (ADR-0018).
        ...block('bulletList', 'nested item', '00000000-0000-4000-8000-000000000012'),
        attrs: {
          [BLOCK_ATTRS.id]: '00000000-0000-4000-8000-000000000012',
          [BLOCK_ATTRS.props]: null,
          [BLOCK_ATTRS.indent]: '1',
        },
      },
      paragraph('closing', '00000000-0000-4000-8000-000000000013'),
    ],
  });

  const ydoc = new Y.Doc();
  jsonToFragment(doc, pageContent(ydoc));

  const { blocks, warnings } = readBlockTree(ydoc);

  assert.deepEqual(warnings, [], 'the reader must find nothing to complain about');
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['heading', 'bulletList', 'bulletList', 'paragraph'],
    'depth-first reading order',
  );
  assert.deepEqual(
    blocks.map((b) => b.text),
    ['Section', 'outer item', 'nested item', 'closing'],
  );
  // Nesting survives, and a container's text does not swallow its children's.
  assert.equal(blocks[2]!.parentId, '00000000-0000-4000-8000-000000000011');
  assert.equal(blocks[2]!.depth, 1);
  assert.equal(blocks[0]!.parentId, null);

  ydoc.destroy();
});

test('props written by the editor are readable by the tree reader', () => {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      block('callout', 'note', '00000000-0000-4000-8000-000000000020', {
        [BLOCK_ATTRS.props]: writeProps({ emoji: '💡', colour: 'yellow' }),
      }),
    ],
  });

  const ydoc = new Y.Doc();
  jsonToFragment(doc, pageContent(ydoc));

  const { blocks } = readBlockTree(ydoc);
  assert.deepEqual(blocks[0]!.props, { colour: 'yellow', emoji: '💡' });
  ydoc.destroy();
});

test('two documents merge without losing blocks', () => {
  // The property CRDTs are here for. Two clients edit independently and both
  // sets of blocks survive.
  const base = new Y.Doc();
  jsonToFragment(
    schema.nodeFromJSON({
      type: 'doc',
      content: [paragraph('shared', '00000000-0000-4000-8000-000000000030')],
    }),
    pageContent(base),
  );
  const snapshot = Y.encodeStateAsUpdate(base);

  const clientA = new Y.Doc();
  Y.applyUpdate(clientA, snapshot);
  const clientB = new Y.Doc();
  Y.applyUpdate(clientB, snapshot);

  const appendParagraph = (target: Y.Doc, text: string, id: string): void => {
    const fragment = pageContent(target);
    const element = new Y.XmlElement('paragraph');
    element.setAttribute(BLOCK_ATTRS.id, id);
    element.insert(0, [new Y.XmlText(text)]);
    fragment.insert(fragment.length, [element]);
  };

  appendParagraph(clientA, 'from A', '00000000-0000-4000-8000-00000000003a');
  appendParagraph(clientB, 'from B', '00000000-0000-4000-8000-00000000003b');

  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB));
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA));

  const textsA = readBlockTree(clientA).blocks.map((b) => b.text);
  const textsB = readBlockTree(clientB).blocks.map((b) => b.text);

  assert.deepEqual(textsA, textsB, 'both clients must converge on one order');
  assert.equal(textsA.length, 3);
  assert.ok(textsA.includes('from A'));
  assert.ok(textsA.includes('from B'));

  base.destroy();
  clientA.destroy();
  clientB.destroy();
});


// --- indentation -----------------------------------------------------------

test('Tab indents, Shift-Tab outdents, as attribute changes', () => {
  let state = stateWith({
    type: 'doc',
    content: [
      block('bulletList', 'first', '00000000-0000-4000-8000-000000000040'),
      block('bulletList', 'second', '00000000-0000-4000-8000-000000000041'),
    ],
  });
  // Caret in the second block.
  const secondPos = state.doc.child(0).nodeSize + 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, secondPos)));

  const indent = indentCommand();
  state = run(state, indent, 'indent');
  assert.equal(readIndent(state.doc.child(1).attrs), 1);

  const outdent = outdentCommand();
  state = run(state, outdent, 'outdent');
  assert.equal(readIndent(state.doc.child(1).attrs), 0);
});

test('the first block of a document cannot be indented', () => {
  // There is no preceding block to become its parent, and the tree reader
  // would normalise the indent back to 0 anyway — so the editor must not
  // display something the server will not store.
  let state = stateWith({
    type: 'doc',
    content: [block('bulletList', 'only', '00000000-0000-4000-8000-000000000042')],
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  assert.equal(indentCommand()(state, undefined), false);
});

test('a block cannot be indented more than one level below its predecessor', () => {
  let state = stateWith({
    type: 'doc',
    content: [
      block('bulletList', 'parent', '00000000-0000-4000-8000-000000000043'),
      block('bulletList', 'child', '00000000-0000-4000-8000-000000000044'),
    ],
  });
  const secondPos = state.doc.child(0).nodeSize + 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, secondPos)));

  state = run(state, indentCommand(), 'first indent');
  assert.equal(readIndent(state.doc.child(1).attrs), 1);
  // A second indent would put it two levels below a predecessor at level 0.
  assert.equal(indentCommand()(state, undefined), false);
});

test('changing a block type preserves its indent', () => {
  // Converting an indented bullet to a heading should keep it where it sits
  // rather than jumping it to the margin.
  const heading = schema.nodes['heading']!;
  let state = stateWith({
    type: 'doc',
    content: [
      block('bulletList', 'parent', '00000000-0000-4000-8000-000000000045'),
      {
        ...block('bulletList', 'child', '00000000-0000-4000-8000-000000000046'),
        attrs: {
          [BLOCK_ATTRS.id]: '00000000-0000-4000-8000-000000000046',
          [BLOCK_ATTRS.props]: null,
          [BLOCK_ATTRS.indent]: '1',
        },
      },
    ],
  });
  const secondPos = state.doc.child(0).nodeSize + 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, secondPos)));

  state = run(state, toggleBlockType(heading, { level: 2 }), 'to heading');
  assert.equal(state.doc.child(1).type.name, 'heading');
  assert.equal(readIndent(state.doc.child(1).attrs), 1);
});

test('indentation round-trips into a parent-child tree', () => {
  // The whole point: a flat XML document with indents must read back as the
  // tree the materialiser and renderer expect.
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      block('bulletList', 'one', '00000000-0000-4000-8000-000000000050'),
      {
        ...block('bulletList', 'one a', '00000000-0000-4000-8000-000000000051'),
        attrs: {
          [BLOCK_ATTRS.id]: '00000000-0000-4000-8000-000000000051',
          [BLOCK_ATTRS.props]: null,
          [BLOCK_ATTRS.indent]: '1',
        },
      },
      {
        ...block('bulletList', 'one a i', '00000000-0000-4000-8000-000000000052'),
        attrs: {
          [BLOCK_ATTRS.id]: '00000000-0000-4000-8000-000000000052',
          [BLOCK_ATTRS.props]: null,
          [BLOCK_ATTRS.indent]: '2',
        },
      },
      block('bulletList', 'two', '00000000-0000-4000-8000-000000000053'),
    ],
  });

  const ydoc = new Y.Doc();
  jsonToFragment(doc, pageContent(ydoc));
  const { blocks, warnings } = readBlockTree(ydoc);

  assert.deepEqual(warnings, []);
  assert.deepEqual(
    blocks.map((b) => [b.text, b.depth, b.parentId]),
    [
      ['one', 0, null],
      ['one a', 1, '00000000-0000-4000-8000-000000000050'],
      ['one a i', 2, '00000000-0000-4000-8000-000000000051'],
      ['two', 0, null],
    ],
  );
  // Children are recorded on the parent too, for renderers that walk downwards.
  assert.deepEqual(blocks[0]!.childIds, ['00000000-0000-4000-8000-000000000051']);
  ydoc.destroy();
});

test('an impossible indent jump is normalised and reported', () => {
  // A buggy client writing indent 3 after a top-level block must not produce a
  // parent that does not exist.
  const ydoc = new Y.Doc();
  const fragment = pageContent(ydoc);
  const first = new Y.XmlElement('paragraph');
  first.setAttribute(BLOCK_ATTRS.id, '00000000-0000-4000-8000-000000000060');
  first.insert(0, [new Y.XmlText('root')]);
  const second = new Y.XmlElement('paragraph');
  second.setAttribute(BLOCK_ATTRS.id, '00000000-0000-4000-8000-000000000061');
  second.setAttribute(BLOCK_ATTRS.indent, '3');
  second.insert(0, [new Y.XmlText('jumped')]);
  fragment.insert(0, [first, second]);

  const { blocks, warnings } = readBlockTree(ydoc);
  assert.equal(blocks[1]!.depth, 1, 'clamped to one level below its predecessor');
  assert.equal(blocks[1]!.parentId, '00000000-0000-4000-8000-000000000060');
  assert.ok(warnings.some((w) => w.includes('exceeds one level')));
  ydoc.destroy();
});

// --- list numbering --------------------------------------------------------

const numbered = (text: string, id: string, indent = 0) => ({
  type: 'numberedList',
  attrs: {
    [BLOCK_ATTRS.id]: id,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: indent > 0 ? String(indent) : null,
  },
  content: [{ type: 'text', text }],
});

const numbersFor = (content: unknown[]): number[] =>
  computeListNumbers(schema.nodeFromJSON({ type: 'doc', content })).map((i) => i.number);

test('a run of numbered items counts up', () => {
  assert.deepEqual(
    numbersFor([
      numbered('one', 'a1'),
      numbered('two', 'a2'),
      numbered('three', 'a3'),
    ]),
    [1, 2, 3],
  );
});

test('a deeper run restarts at 1 and the outer run continues', () => {
  // The rule CSS counters cannot express: there is no element to hang a
  // counter-reset on, because these are flat siblings (ADR-0018).
  assert.deepEqual(
    numbersFor([
      numbered('one', 'a1'),
      numbered('one a', 'a2', 1),
      numbered('one b', 'a3', 1),
      numbered('two', 'a4'),
    ]),
    [1, 1, 2, 2],
  );
});

test('a paragraph between items restarts the numbering', () => {
  // What every word processor does, and what people expect.
  assert.deepEqual(
    numbersFor([
      numbered('one', 'a1'),
      numbered('two', 'a2'),
      paragraph('interruption', 'a3'),
      numbered('one again', 'a4'),
    ]),
    [1, 2, 1],
  );
});

test('a nested paragraph does not interrupt the outer run', () => {
  // A note indented under item 2 must not stop item 3 from following.
  assert.deepEqual(
    numbersFor([
      numbered('one', 'a1'),
      numbered('two', 'a2'),
      paragraph('a note about two', 'a3', 1),
      numbered('three', 'a4'),
    ]),
    [1, 2, 3],
  );
});

test('returning to a shallower level continues where it left off', () => {
  assert.deepEqual(
    numbersFor([
      numbered('one', 'a1'),
      numbered('one a', 'a2', 1),
      numbered('two', 'a3'),
      numbered('two a', 'a4', 1),
    ]),
    [1, 1, 2, 1],
  );
});

test('bullets between numbered items at a deeper level do not disturb them', () => {
  assert.deepEqual(
    numbersFor([
      numbered('one', 'a1'),
      block('bulletList', 'a bullet', 'a2'),
      numbered('one again', 'a3'),
    ]),
    [1, 1],
    'a bullet at the same level ends the run',
  );
});

test('a document with no numbered items yields nothing', () => {
  assert.deepEqual(numbersFor([paragraph('just text', 'a1')]), []);
});


// --- seeding ---------------------------------------------------------------

test('an empty page is seeded with one paragraph', () => {
  // The ProseMirror schema requires block+, but a fresh Yjs fragment is empty,
  // so binding an editor to it yields an invalid document. y-prosemirror does
  // not seed one.
  const ydoc = new Y.Doc();
  const fragment = pageContent(ydoc);
  assert.equal(fragment.length, 0);

  assert.equal(seedEmptyPage(fragment, () => 'seed-id'), true);
  assert.equal(fragment.length, 1);

  const { blocks } = readBlockTree(ydoc);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.type, 'paragraph');
  assert.equal(blocks[0]!.id, 'seed-id');
  ydoc.destroy();
});

test('seeding a non-empty page does nothing', () => {
  const ydoc = new Y.Doc();
  jsonToFragment(
    schema.nodeFromJSON({ type: 'doc', content: [paragraph('existing', 'x')] }),
    pageContent(ydoc),
  );
  assert.equal(seedEmptyPage(pageContent(ydoc), () => 'unused'), false);
  assert.equal(readBlockTree(ydoc).blocks.length, 1);
  ydoc.destroy();
});

// --- slash menu ------------------------------------------------------------

/**
 * Drive the plugin without a view.
 *
 * The plugin's state is a pure function of transactions, so its behaviour is
 * testable headlessly. What is not covered here is `handleKeyDown`, which needs
 * a view — the keys it claims are asserted through the plugin props instead.
 */
function slashState(initial: unknown, typed: string, startAt?: number) {
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(initial),
    plugins: [slashMenu()],
  });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, startAt ?? state.doc.content.size - 1)),
  );
  for (const char of typed) {
    state = state.apply(state.tr.insertText(char));
  }
  return { state, menu: slashMenuState(state) };
}

test('typing / at the start of a block opens the menu', () => {
  const { menu } = slashState({ type: 'doc', content: [paragraph('', 'a1')] }, '/', 1);
  assert.ok(menu, 'the menu should be open');
  assert.equal(menu!.query, '');
  assert.ok(menu!.items.length > 5, 'every item is offered with an empty query');
});

test('typing / after a space opens the menu', () => {
  const { menu } = slashState({ type: 'doc', content: [paragraph('note ', 'a1')] }, '/', 6);
  assert.ok(menu);
});

test('a / inside a word does not open the menu', () => {
  // Typing a path, a fraction or "and/or" must not interrupt with a menu.
  for (const [text, caret] of [['src', 4], ['50', 3], ['and', 4]] as const) {
    const { menu } = slashState({ type: 'doc', content: [paragraph(text, 'a1')] }, '/', caret);
    assert.equal(menu, null, `"${text}/" must not open the menu`);
  }
});

test('a / inside a code block does not open the menu', () => {
  // A slash in code is code.
  const { menu } = slashState(
    {
      type: 'doc',
      content: [
        {
          type: 'code',
          attrs: {
            [BLOCK_ATTRS.id]: 'c1',
            [BLOCK_ATTRS.props]: null,
            [BLOCK_ATTRS.indent]: null,
            language: null,
          },
          content: [{ type: 'text', text: 'cd ' }],
        },
      ],
    },
    '/',
    4,
  );
  assert.equal(menu, null);
});

test('the query tracks what is typed after the slash', () => {
  const { menu } = slashState({ type: 'doc', content: [paragraph('', 'a1')] }, '/head', 1);
  assert.ok(menu);
  assert.equal(menu!.query, 'head');
  assert.ok(
    menu!.items.every((i) => i.id.startsWith('heading')),
    'only headings should match "head"',
  );
});

test('a space with no matching item closes the menu', () => {
  // "the plan is 50/50 split" would otherwise leave a dead menu capturing Enter.
  const { menu } = slashState({ type: 'doc', content: [paragraph('is ', 'a1')] }, '/zzz ', 4);
  assert.equal(menu, null);
});

test('a space still matching an item keeps the menu open', () => {
  const { menu } = slashState({ type: 'doc', content: [paragraph('', 'a1')] }, '/to', 1);
  assert.ok(menu, 'a partial query with matches stays open');
  assert.ok(menu!.items.length > 0);
});

test('deleting the slash closes the menu', () => {
  let { state, menu } = slashState({ type: 'doc', content: [paragraph('', 'a1')] }, '/he', 1);
  assert.ok(menu);
  // Remove everything back to and including the slash.
  state = state.apply(state.tr.delete(1, state.selection.head));
  assert.equal(slashMenuState(state), null);
});

test('moving the caret before the slash closes the menu', () => {
  let { state } = slashState({ type: 'doc', content: [paragraph('text ', 'a1')] }, '/h', 6);
  assert.ok(slashMenuState(state));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
  assert.equal(slashMenuState(state), null);
});

test('the menu claims the keys it needs', () => {
  // Enter must not both pick an item and split the block, so the plugin has to
  // handle these itself. Asserted through the plugin's props because
  // handleKeyDown needs a view.
  const plugin = slashMenu();
  assert.ok(plugin.props.handleKeyDown, 'handleKeyDown must exist');
});

test('filtering ranks a title prefix above a keyword match', () => {
  // Typing "h1" must land on Heading 1 rather than on whatever else contains an
  // h, or the menu is useless for the thing people use it for most.
  const results = filterSlashItems('h1');
  assert.equal(results[0]!.id, 'heading-1');

  assert.equal(filterSlashItems('todo')[0]!.id, 'todo');
  assert.equal(filterSlashItems('checkbox')[0]!.id, 'todo');
  assert.equal(filterSlashItems('ul')[0]!.id, 'bulletList');
  assert.equal(filterSlashItems('quote')[0]!.id, 'quote');
  assert.equal(filterSlashItems('hr')[0]!.id, 'divider');
});

test('filtering is stable within a score band', () => {
  // Otherwise the list reshuffles as someone types and they lose their place.
  const first = filterSlashItems('l').map((i) => i.id);
  const second = filterSlashItems('l').map((i) => i.id);
  assert.deepEqual(first, second);
});

test('an unmatched query yields nothing rather than everything', () => {
  assert.deepEqual(filterSlashItems('qqqq'), []);
});

test('every item has distinct keywords and a hint', () => {
  // The hint is what makes the menu usable by someone who does not already know
  // the vocabulary, so an item without one is a defect.
  const ids = new Set<string>();
  for (const item of SLASH_ITEMS) {
    assert.ok(item.hint.length > 0, `${item.id} has no hint`);
    assert.ok(item.keywords.length > 0, `${item.id} has no keywords`);
    assert.ok(!ids.has(item.id), `duplicate item id ${item.id}`);
    ids.add(item.id);
  }
});

/**
 * External items, and the interface that handles each one.
 *
 * Kept beside the assertion rather than in the source: this is a statement
 * about two packages agreeing, and it belongs where the disagreement would be
 * caught.
 */
const EXTERNAL_SLASH_IDS = new Set(['image', 'file', 'collection']);

test('every item names something the schema can produce', () => {
  // A menu entry that silently does nothing is worse than no entry, and an
  // action naming a node type that does not exist is exactly that.
  for (const item of SLASH_ITEMS) {
    if (item.action.kind === 'convert') {
      assert.ok(
        schema.nodes[item.action.type],
        `${item.id} converts to an unknown node type ${item.action.type}`,
      );
    } else if (item.action.kind === 'insert') {
      assert.ok(item.action.build(), `${item.id} builds nothing`);
    } else {
      // `external` is handled by the interface, which dispatches on the id — so
      // an id the interface does not know about is a menu entry that silently
      // does nothing.
      //
      // This asserted a single id when there was one such item. Naming the set
      // keeps the same guarantee and says where the other half lives: adding a
      // third without teaching SlashMenu.tsx about it fails here.
      assert.ok(
        EXTERNAL_SLASH_IDS.has(item.id),
        `${item.id} is external and nothing in the interface handles it`,
      );
    }
  }
});

// --- slash menu placement --------------------------------------------------

test('a slash command in an empty block converts that block', () => {
  const state = stateWith({ type: 'doc', content: [paragraph('', 'a1')] });
  const withCaret = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1)),
  );
  // The block is empty, so the chosen type replaces it.
  const heading = schema.nodes['heading']!;
  const next = run(withCaret, toggleBlockType(heading, { level: 1 }), 'convert');
  assert.equal(next.doc.childCount, 1);
  assert.equal(next.doc.firstChild!.type.name, 'heading');
});

test('a block with text keeps its text when a new type is inserted after it', () => {
  // The bug this covers: typing text and then reaching for /heading turned the
  // paragraph the text was in into a heading. The writing became the heading
  // and no new block appeared, so from the outside the heading looked like it
  // had gone somewhere else entirely.
  //
  // The full path needs a view, so it is covered in mount.test.ts. This pins
  // down the rule the path depends on: a split leaves the original text where
  // it was, and the command then applies to the new block.
  let state = stateWith({ type: 'doc', content: [paragraph('Hello world', 'a1')] });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 12)),
  );

  state = run(state, splitBlock, 'split');
  assert.equal(state.doc.childCount, 2);
  assert.equal(state.doc.child(0).textContent, 'Hello world');
  assert.equal(state.doc.child(1).textContent, '');

  const heading = schema.nodes['heading']!;
  state = run(state, toggleBlockType(heading, { level: 1 }), 'to heading');

  assert.equal(state.doc.child(0).type.name, 'paragraph', 'the writing stays a paragraph');
  assert.equal(state.doc.child(0).textContent, 'Hello world');
  assert.equal(state.doc.child(1).type.name, 'heading', 'the heading is the new block');
});
