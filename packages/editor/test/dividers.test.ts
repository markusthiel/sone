/**
 * A divider's line, symbol and place (ADR-0189).
 *
 * Three schema attributes on the divider, each with its default stored as
 * absence, reaching the DOM as `data-rule`, `data-ornament` and
 * `data-ornament-at`; the symbol drawn into the block beside the rule; and
 * `***` typed becoming the asterism it stands for.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';
import { DOMSerializer } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';

import { DIVIDER_ORNAMENTS } from '@sone/core';

import { currentBlockStyle, setBlockStyle } from '../src/commands.js';
import { DIVIDER_ORNAMENT_PATHS } from '../src/dividerOrnaments.js';
import { soneInputRules } from '../src/inputRules.js';
import { schema } from '../src/schema.js';

function dividerState(attrs: Record<string, unknown> = {}): EditorState {
  const doc = schema.node('doc', null, [schema.node('divider', attrs)]);
  const state = EditorState.create({ doc, schema });
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
}

function apply(state: EditorState, command: ReturnType<typeof setBlockStyle>): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

function render(state: EditorState): Element {
  const { document } = new JSDOM('').window;
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content, {
    document,
  });
  return fragment.firstElementChild!;
}

test('line, symbol and place reach the DOM, and their defaults are stored as nothing', () => {
  let state = dividerState();
  state = apply(state, setBlockStyle({ rule: 'dashed', ornament: 'leaf', ornamentAt: 'start' }));
  assert.deepEqual(currentBlockStyle(state), {
    align: null,
    width: null,
    color: null,
    tone: null,
    source: null,
    rule: 'dashed',
    ornament: 'leaf',
    ornamentAt: 'start',
  });
  let dom = render(state);
  assert.equal(dom.getAttribute('data-rule'), 'dashed');
  assert.equal(dom.getAttribute('data-ornament'), 'leaf');
  assert.equal(dom.getAttribute('data-ornament-at'), 'start');
  assert.ok(dom.querySelector('hr'), 'the rule is still an hr');
  assert.ok(dom.querySelector('.divider-mark svg path'), 'and the symbol sits beside it');

  state = apply(state, setBlockStyle({ rule: 'solid', ornamentAt: 'center' }));
  assert.equal(state.doc.firstChild!.attrs['rule'], null, 'solid is the absence of a rule');
  assert.equal(state.doc.firstChild!.attrs['ornamentAt'], null, 'centre is the absence of a place');

  state = apply(state, setBlockStyle({ ornament: null }));
  dom = render(state);
  assert.equal(dom.querySelectorAll('.divider-mark').length, 0, 'no symbol, no mark');
});

test('removing the symbol also forgets where it sat', () => {
  let state = dividerState({ ornament: 'star', ornamentAt: 'end' });
  state = apply(state, setBlockStyle({ ornament: null }));
  assert.equal(state.doc.firstChild!.attrs['ornamentAt'], null);
});

test('every ornament has a drawing', () => {
  for (const ornament of DIVIDER_ORNAMENTS) {
    assert.ok(DIVIDER_ORNAMENT_PATHS[ornament].length > 0, ornament);
  }
});

test('*** typed is an asterism, --- a plain rule', () => {
  const typed = (text: string): EditorState => {
    const doc = schema.node('doc', null, [schema.node('paragraph')]);
    let state = EditorState.create({ doc, schema, plugins: [soneInputRules()] });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    for (const char of text) {
      const { from, to } = state.selection;
      const handled = state.plugins.some((plugin) => {
        const handler = plugin.props?.handleTextInput;
        if (!handler) return false;
        const view = {
          state,
          dispatch: (tr: import('prosemirror-state').Transaction) => {
            state = state.apply(tr);
          },
          composing: false,
        } as unknown as import('prosemirror-view').EditorView;
        return handler.call(plugin, view, from, to, char, () => state.tr) === true;
      });
      if (!handled) state = state.apply(state.tr.insertText(char, from, to));
    }
    return state;
  };
  // The rule leaves a fresh paragraph for the caret; the divider is the other block.
  const dividerIn = (state: EditorState) =>
    state.doc.content.content.find((node) => node.type.name === 'divider')!;
  const stars = dividerIn(typed('***'));
  assert.equal(stars.type.name, 'divider');
  assert.equal(stars.attrs['ornament'], 'asterism');
  const dashes = dividerIn(typed('---'));
  assert.equal(dashes.type.name, 'divider');
  assert.equal(dashes.attrs['ornament'], null);
});
