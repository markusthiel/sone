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
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import * as Y from 'yjs';

import { assignMissingIds, blockIds, collectBlockIds } from '../src/blockIds.js';
import { fragmentToJSON, jsonToFragment } from '../src/editor.js';
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
