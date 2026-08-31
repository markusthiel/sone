/**
 * Tables.
 *
 * prosemirror-tables does the hard parts. What is tested here is what SONE adds:
 * that a table is visible to the projection, that its structure survives the
 * round trip through Yjs, and that a CRDT merge cannot leave a ragged table
 * behind.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS, pageContent, readBlockTree } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';
import * as Y from 'yjs';

import { jsonToFragment } from '../src/editor.js';
import { schema } from '../src/schema.js';
import { TABLE_ACTIONS, buildTable, insertTable } from '../src/tables.js';

let counter = 0;
const nextId = (): string =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function emptyState(): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: {
            [BLOCK_ATTRS.id]: 'start',
            [BLOCK_ATTRS.props]: null,
            [BLOCK_ATTRS.indent]: null,
          },
        },
      ],
    }),
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
}

// --- construction ----------------------------------------------------------

test('a table is built with the requested shape', () => {
  const table = buildTable({ rows: 3, columns: 4, generateId: nextId });
  assert.ok(table);
  assert.equal(table!.childCount, 3, 'three rows');
  assert.equal(table!.firstChild!.childCount, 4, 'four columns');
});

test('the first row is a header row by default', () => {
  const table = buildTable({ rows: 2, columns: 2, generateId: nextId });
  assert.equal(table!.firstChild!.firstChild!.type.name, 'table_header');
  assert.equal(table!.child(1).firstChild!.type.name, 'table_cell');
});

test('a header row can be turned off', () => {
  const table = buildTable({ rows: 2, columns: 2, headerRow: false, generateId: nextId });
  assert.equal(table!.firstChild!.firstChild!.type.name, 'table_cell');
});

test('every cell contains a paragraph', () => {
  // A cell with no block content cannot be typed into, and a table nobody can
  // type into is worse than no table.
  const table = buildTable({ rows: 2, columns: 2, generateId: nextId });
  table!.descendants((node) => {
    if (node.type.name === 'table_cell' || node.type.name === 'table_header') {
      assert.equal(node.childCount, 1, 'one child');
      assert.equal(node.firstChild!.type.name, 'paragraph');
    }
    return true;
  });
});

test('every node in a table carries a block id', () => {
  // Without one the tree reader skips an element *and everything inside it*, so
  // a table would be invisible to the projection and to search — which is
  // exactly where a table's contents most need to be findable.
  const table = buildTable({ rows: 2, columns: 2, generateId: nextId });
  const ids: string[] = [];
  table!.descendants((node) => {
    if (node.type.spec.attrs && BLOCK_ATTRS.id in node.type.spec.attrs) {
      const id = node.attrs[BLOCK_ATTRS.id];
      assert.ok(typeof id === 'string' && id.length > 0, `${node.type.name} has no id`);
      ids.push(id as string);
    }
    return true;
  });
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length, 'and every id is distinct');
});

test('absurd dimensions are clamped rather than honoured', () => {
  // A 10000-column table is a mistake or an attack, and either way it should
  // not be built.
  const huge = buildTable({ rows: 10_000, columns: 10_000, generateId: nextId });
  assert.ok(huge!.childCount <= 50);
  assert.ok(huge!.firstChild!.childCount <= 20);

  const tiny = buildTable({ rows: 0, columns: 0, generateId: nextId });
  assert.equal(tiny!.childCount, 1);
  assert.equal(tiny!.firstChild!.childCount, 1);
});

// --- inserting -------------------------------------------------------------

test('a table can be inserted at the selection', () => {
  const state = emptyState();
  let next: EditorState | null = null;
  const applied = insertTable({ rows: 2, columns: 2, generateId: nextId })(
    state,
    (tr) => {
      next = state.apply(tr);
    },
  );
  assert.ok(applied);
  assert.ok(
    next!.doc.children.some((node) => node.type.name === 'table'),
    'a table should be in the document',
  );
});

test('a table cannot be nested inside another', () => {
  // Possible in the schema and almost never intended, and unpicking one by hand
  // is unpleasant.
  let state = emptyState();
  let next: EditorState | null = null;
  insertTable({ rows: 2, columns: 2, generateId: nextId })(state, (tr) => {
    next = state.apply(tr);
  });
  state = next!;

  // Put the caret inside the first cell.
  let cellPos: number | null = null;
  state.doc.descendants((node, pos) => {
    if (cellPos === null && node.type.name === 'paragraph' && pos > 1) {
      cellPos = pos + 1;
      return false;
    }
    return true;
  });
  assert.ok(cellPos !== null);
  state = state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(cellPos!))),
  );

  assert.equal(
    insertTable({ rows: 2, columns: 2, generateId: nextId })(state, undefined),
    false,
    'inserting a table inside a table must be refused',
  );
});

// --- the projection --------------------------------------------------------

test('a table survives the round trip through Yjs and is readable', () => {
  // The contract that matters: what the editor writes is what the server
  // materialises and searches.
  const table = buildTable({ rows: 2, columns: 2, generateId: nextId })!;
  const doc = schema.topNodeType.create(null, table);

  const ydoc = new Y.Doc();
  jsonToFragment(doc, pageContent(ydoc));

  const { blocks, warnings } = readBlockTree(ydoc);
  assert.deepEqual(warnings, [], 'the reader must find nothing to complain about');

  const types = blocks.map((block) => block.type);
  assert.ok(types.includes('table'), 'the table itself');
  assert.ok(types.includes('table_row'), 'its rows');
  assert.ok(types.filter((t) => t === 'table_header').length === 2, 'two header cells');
  assert.ok(types.filter((t) => t === 'paragraph').length === 4, 'a paragraph per cell');

  // Structure is preserved as parent links, so a renderer or an export can walk
  // it without the CRDT.
  const tableBlock = blocks.find((block) => block.type === 'table')!;
  const rows = blocks.filter((block) => block.parentId === tableBlock.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.type === 'table_row'));

  ydoc.destroy();
});

test('cell text is searchable', () => {
  // A table nobody can find the contents of is a table nobody will put anything
  // important in.
  const table = buildTable({ rows: 1, columns: 2, headerRow: false, generateId: nextId })!;
  const doc = schema.topNodeType.create(null, table);

  const ydoc = new Y.Doc();
  jsonToFragment(doc, pageContent(ydoc));

  // Type into the first cell through the CRDT, as an edit would.
  const fragment = pageContent(ydoc);
  ydoc.transact(() => {
    const tableEl = fragment.get(0) as Y.XmlElement;
    const row = tableEl.get(0) as Y.XmlElement;
    const cell = row.get(0) as Y.XmlElement;
    const paragraph = cell.get(0) as Y.XmlElement;
    paragraph.insert(0, [new Y.XmlText('findable content')]);
  });

  const { blocks } = readBlockTree(ydoc);
  const texts = blocks.map((block) => block.text).filter((text) => text.length > 0);
  assert.ok(
    texts.some((text) => text.includes('findable content')),
    `cell text should be readable, got ${JSON.stringify(texts)}`,
  );
  ydoc.destroy();
});

// --- the action list -------------------------------------------------------

test('every table action has a distinct id and a label', () => {
  // The interface renders this list, so a missing label is an unusable menu
  // item and a duplicate id is a React key collision.
  const ids = new Set<string>();
  for (const action of TABLE_ACTIONS) {
    assert.ok(action.label.length > 0, `${action.id} has no label`);
    assert.ok(!ids.has(action.id), `duplicate action id ${action.id}`);
    ids.add(action.id);
  }
  assert.ok(TABLE_ACTIONS.length >= 8);
});

test('table actions refuse outside a table', () => {
  // A menu that offers something which silently does nothing is worse than one
  // that offers less, so the interface disables these — which relies on them
  // returning false rather than throwing.
  const state = emptyState();
  for (const action of TABLE_ACTIONS) {
    assert.equal(
      action.command(state, undefined),
      false,
      `${action.id} should refuse outside a table`,
    );
  }
});

test('a table carries its own block attributes through a decoration', async () => {
  // The resizing plugin installs its own node view, which builds the wrapper in
  // JavaScript and never reads the schema's toDOM — so `data-width` never
  // reached the page and "Column / Wide / Full page" did nothing to a table.
  // A node decoration is the way to add attributes to a node somebody else
  // draws.
  const { tableBlockAttrs } = await import('../src/tableAttrs.js');
  const { EditorState } = await import('prosemirror-state');
  const { schema } = await import('../src/schema.js');

  const cell = schema.nodes['table_cell']!.create(null, schema.nodes['paragraph']!.create());
  const row = schema.nodes['table_row']!.create(null, cell);
  const table = schema.nodes['table']!.create({ width: 'full', id: 'b1' }, row);
  const state = EditorState.create({
    doc: schema.node('doc', null, [table]),
    plugins: [tableBlockAttrs()],
  });

  const plugin = state.plugins[0]!;
  const decorations = plugin.props.decorations!.call(plugin, state) as unknown as {
    find: () => Array<{ type: { attrs: Record<string, string> } }>;
  };
  const found = decorations.find();
  assert.equal(found.length, 1, 'one decoration, for the table');
  assert.equal(found[0]!.type.attrs['data-width'], 'full');
  assert.equal(found[0]!.type.attrs['data-block'], 'table');
  assert.equal(found[0]!.type.attrs['data-block-id'], 'b1');
});

test('a table with no width setting carries no width attribute', async () => {
  // Absent rather than "null": the stylesheet matches on the attribute's
  // presence, so a value of the string "null" would style every table as though
  // somebody had chosen something.
  const { tableBlockAttrs } = await import('../src/tableAttrs.js');
  const { EditorState } = await import('prosemirror-state');
  const { schema } = await import('../src/schema.js');

  const cell = schema.nodes['table_cell']!.create(null, schema.nodes['paragraph']!.create());
  const row = schema.nodes['table_row']!.create(null, cell);
  const table = schema.nodes['table']!.create(null, row);
  const state = EditorState.create({
    doc: schema.node('doc', null, [table]),
    plugins: [tableBlockAttrs()],
  });

  const plugin = state.plugins[0]!;
  const decorations = plugin.props.decorations!.call(plugin, state) as unknown as {
    find: () => Array<{ type: { attrs: Record<string, string> } }>;
  };
  const attrs = decorations.find()[0]!.type.attrs;
  assert.equal(attrs['data-width'], undefined);
  assert.equal(attrs['data-block'], 'table');
});
