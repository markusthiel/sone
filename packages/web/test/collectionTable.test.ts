/**
 * Reading a cell value.
 *
 * The one place in the table that can be quietly wrong. A column's type can be
 * changed, so a cell may hold a value of an older kind — a number where the
 * column now says text. Reading `.value` blindly would drop `42` into a text box
 * as though somebody had typed it, and the next keystroke would save it as text.
 *
 * The tag on a stored value exists precisely so that cannot happen silently;
 * TypeScript refused to let me index past it, which is how this function came
 * to exist at all.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

import { optionsOf, textOf } from '../src/components/CollectionTable.tsx';

test('text-like kinds are read', () => {
  assert.equal(textOf({ kind: 'text', value: 'hello' }), 'hello');
  assert.equal(textOf({ kind: 'url', value: 'https://example.org' }), 'https://example.org');
  assert.equal(textOf({ kind: 'email', value: 'a@example.org' }), 'a@example.org');
  assert.equal(textOf({ kind: 'phone', value: '+49 30 1234' }), '+49 30 1234');
});

test('a value of another kind reads as empty, not as its contents', () => {
  // The case that matters: the column was changed and the old value is still
  // there. Showing it as text would invite somebody to "confirm" it, and the
  // next keystroke would store a number as a string.
  assert.equal(textOf({ kind: 'number', value: 42 }), '');
  assert.equal(textOf({ kind: 'checkbox', value: true }), '');
  assert.equal(textOf({ kind: 'date', start: '2026-01-01', end: null }), '');
});

test('an absent value reads as empty', () => {
  // "No value" and "empty string" have to look the same in a text box, since a
  // box cannot show the difference — but they are stored differently, which is
  // why writing an empty box clears the value rather than storing "".
  assert.equal(textOf(null), '');
});

test('a malformed value does not become the string "undefined"', () => {
  // A document written by an older version, or by something else entirely.
  assert.equal(textOf({ kind: 'text' } as never), '');
  assert.equal(textOf({ kind: 'text', value: 5 } as never), '');
});

// --- reading a column's options ---------------------------------------------

test('options are read from the config', () => {
  assert.deepEqual(
    optionsOf({
      id: 'f',
      name: 'Status',
      description: null,
      fieldType: 'select',
      config: {
        options: [
          { id: 'o1', name: 'Todo', color: 'grey' },
          { id: 'o2', name: 'Doing', color: 'blue' },
        ],
      },
    }),
    [
      { id: 'o1', name: 'Todo', color: 'grey' },
      { id: 'o2', name: 'Doing', color: 'blue' },
    ],
  );
});

test('a column with no options reads as an empty list', () => {
  // Which the cell uses to say "add some in the column heading" rather than
  // presenting an empty dropdown that looks broken.
  const base = { id: 'f', name: 'S', description: null, fieldType: 'select' };
  assert.deepEqual(optionsOf({ ...base, config: {} }), []);
  assert.deepEqual(optionsOf({ ...base, config: { options: 'nonsense' } }), []);
});

test('an option without an id is skipped', () => {
  // It could never be read back: a row's value points at an id, so an option
  // without one can be chosen and then not displayed.
  const options = optionsOf({
    id: 'f',
    name: 'S',
    description: null,
    fieldType: 'select',
    config: {
      options: [{ name: 'No id' }, { id: '', name: 'Empty id' }, { id: 'ok', name: 'Fine' }],
    },
  });
  assert.deepEqual(options.map((option) => option.id), ['ok']);
});

test('a missing colour becomes grey rather than undefined', () => {
  // The class name is built from it, so undefined would produce "option-
  // undefined" and no colour at all.
  const options = optionsOf({
    id: 'f',
    name: 'S',
    description: null,
    fieldType: 'select',
    config: { options: [{ id: 'o1', name: 'Todo' }] },
  });
  assert.equal(options[0]!.color, 'grey');
});

// --- the collection block ---------------------------------------------------

test('the node view keeps ProseMirror out of the table', () => {
  // Two libraries owning one subtree is a bug factory. The boundary is
  // explicit: ProseMirror owns the div, React owns everything inside it.
  const source = codeOf(new URL('../src/components/CollectionNodeView.tsx', import.meta.url));

  // Without this, typing in a cell is handled as typing in the document.
  assert.match(source, /stopEvent\(\): boolean \{\s*return true;/);
  // Without this, ProseMirror tries to reconcile what React rendered.
  assert.match(source, /ignoreMutation\(\): boolean \{\s*return true;/);
  assert.match(source, /contentEditable = 'false'/);
});

test('an update in place does not remount the table', () => {
  // Returning false would have ProseMirror destroy and rebuild the node view,
  // unmounting React and losing whatever was half-typed in a cell.
  const source = codeOf(new URL('../src/components/CollectionNodeView.tsx', import.meta.url));
  assert.match(source, /update\(node: PMNodeLike\): boolean/);
  assert.match(source, /if \(next !== this\.collectionId\)/);
});

test('the block is created after the collection exists', () => {
  // The block carries the collection's id, and there is no id until the
  // collection is created. Inserting first would need a placeholder node and a
  // way to repair one whose request failed.
  const source = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
  const created = source.indexOf('await api.createCollection(pageId)');
  const inserted = source.indexOf('replaceSelectionWith(node)');
  assert.ok(created > 0 && inserted > created, 'the request comes first');
});

test('the interface handles every external slash item', () => {
  // The editor package asserts the same set from its side. This is the half
  // that would otherwise drift: an item marked external whose id nothing here
  // dispatches on is a menu entry that silently does nothing.
  const source = codeOf(new URL('../src/components/SlashMenu.tsx', import.meta.url));
  assert.match(source, /item\.id === 'collection'/);
  assert.match(source, /onPickImage\(\)/);
});

// --- view rules -------------------------------------------------------------

test('only operators that mean something for the type are offered', () => {
  // "Greater than" on text is not a stricter filter, it is a string comparison
  // that returns the wrong rows quietly. The server skips such a filter, so
  // offering it here would be a control that appears to do nothing.
  const source = codeOf(new URL('../src/components/ViewRules.tsx', import.meta.url));
  assert.match(source, /case 'number':/);
  assert.match(source, /case 'date':/);
  // multiSelect deliberately has no "is": the stored value is the whole set.
  const multi = source.slice(source.indexOf("case 'multiSelect':"));
  const untilNext = multi.slice(0, multi.indexOf('default:'));
  assert.doesNotMatch(untilNext, /id: 'is'/);
  assert.match(untilNext, /id: 'contains'/);
});

test('a rule that carries no value does not send one', () => {
  // "is empty" asks whether a value exists at all; sending a value with it
  // would be a rule the server reads as something else.
  const source = codeOf(new URL('../src/components/ViewRules.tsx', import.meta.url));
  assert.match(source, /operator !== 'isEmpty' && operator !== 'isNotEmpty'/);
});

test('saving rules keeps what else the view carried', () => {
  // The definition is replaced wholesale, so dropping the rest would silently
  // un-group a board the moment somebody sorted it.
  const source = codeOf(new URL('../src/components/ViewRules.tsx', import.meta.url));
  assert.match(source, /key !== 'filters' && key !== 'sort'/);
});

// --- searching a collection -------------------------------------------------

test('searching is debounced, and asks with what settled', () => {
  // A request per keystroke would put a query per character through the
  // database. Two values: what is typed, and what has been asked for.
  const source = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(source, /setTimeout\(\(\) => setAsked\(query\), 250\)/);
  assert.match(source, /clearTimeout\(timer\)/, 'and the pending one is cancelled');
});

test('the search goes to the server, not through the rows in hand', () => {
  // Filtering after fetching everything stops working at the size a collection
  // is for — the same reason filters and sorting are in the database.
  const source = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(source, /api\.collection\(collectionId, viewRef\.current \?\? undefined, askedRef\.current\)/);
});
