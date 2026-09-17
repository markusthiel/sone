/**
 * Callout tones and quote sources (ADR-0188).
 *
 * A tone is a schema attribute that reaches the DOM as `data-tone`, together
 * with the tone's symbol; `note` is stored as its absence. A quote's source is
 * an attribute that reaches the DOM as `data-source`. Both are set through
 * `setBlockStyle`, which writes them only to blocks whose type declares them.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';
import { DOMSerializer } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import { currentBlockStyle, setBlockStyle } from '../src/commands.js';
import { schema } from '../src/schema.js';
import { SLASH_ITEMS, filterSlashItems, slashMenu, slashMenuState } from '../src/slashMenu.js';

function stateOf(type: string, text: string, attrs: Record<string, unknown> = {}): EditorState {
  const doc = schema.node('doc', null, [schema.node(type, attrs, [schema.text(text)])]);
  const state = EditorState.create({ doc, schema });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
}

function apply(state: EditorState, command: ReturnType<typeof setBlockStyle>): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

/** The block's DOM, as toDOM draws it. */
function render(state: EditorState): Element {
  const { document } = new JSDOM('').window;
  const serializer = DOMSerializer.fromSchema(schema);
  const fragment = serializer.serializeFragment(state.doc.content, { document });
  return fragment.firstElementChild!;
}

test('a tone reaches the DOM with its symbol, and note is stored as nothing', () => {
  let state = stateOf('callout', 'Mind the gap');
  state = apply(state, setBlockStyle({ tone: 'warning' }));
  assert.equal(state.doc.firstChild!.attrs['tone'], 'warning');
  assert.equal(currentBlockStyle(state).tone, 'warning');

  const outer = render(state);
  assert.equal(outer.getAttribute('data-tone'), 'warning');
  assert.ok(outer.querySelector('.callout-mark svg path'), 'the symbol is part of the block');
  assert.equal(outer.querySelector('.callout-mark')?.getAttribute('contenteditable'), 'false');
  assert.equal(outer.querySelector('.callout-body')?.textContent, 'Mind the gap');

  state = apply(state, setBlockStyle({ tone: 'note' }));
  assert.equal(state.doc.firstChild!.attrs['tone'], null, 'note is the absence of a tone');
  assert.equal(render(state).getAttribute('data-tone'), null);
});

test('a tone is not written to a block that has no tone', () => {
  const state = apply(stateOf('paragraph', 'Words'), setBlockStyle({ tone: 'info' }));
  assert.equal('tone' in state.doc.firstChild!.attrs, false);
});

test('a source reaches the DOM trimmed, and an empty one removes it', () => {
  let state = stateOf('quote', 'Less is more');
  state = apply(state, setBlockStyle({ source: '  Somebody, 1999 ' }));
  assert.equal(state.doc.firstChild!.attrs['source'], 'Somebody, 1999');
  assert.equal(render(state).getAttribute('data-source'), 'Somebody, 1999');
  state = apply(state, setBlockStyle({ source: '   ' }));
  assert.equal(state.doc.firstChild!.attrs['source'], null);
});

test('every tone but note has its own / entry, and "callout" lists the family', () => {
  const toned = SLASH_ITEMS.filter((item) => item.id.startsWith('callout-'));
  assert.equal(toned.length, 11);
  assert.ok(toned.every((item) => item.group === 'callouts'));
  const family = filterSlashItems('callout').map((item) => item.id);
  assert.ok(family.includes('callout'));
  assert.ok(family.includes('callout-warning'));
});

test('an item the instance does not offer is absent from the open menu', () => {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { id: 'a1' }, content: [] }],
  });
  let state = EditorState.create({
    schema,
    doc,
    plugins: [slashMenu(undefined, (item) => !item.id.startsWith('sote-'))],
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  state = state.apply(state.tr.insertText('/'));
  const menu = slashMenuState(state);
  assert.ok(menu);
  assert.equal(menu!.items.some((item) => item.id.startsWith('sote-')), false);
  assert.ok(menu!.items.some((item) => item.id === 'callout-warning'));
});
