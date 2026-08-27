/**
 * Links.
 *
 * There was no way to make one: the mark existed in the schema and rendered
 * correctly, and nothing could apply it. So links could arrive by paste and
 * never be created or edited.
 *
 * The normalisation tests carry most of the weight, because that is where a
 * link either works, silently points at the wrong place, or becomes a
 * script-execution vector.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import { linkAt, normaliseHref, removeLink, setLink } from '../src/links.js';
import { schema } from '../src/schema.js';

function stateWith(text: string, from?: number, to?: number): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: {
            [BLOCK_ATTRS.id]: 'a1',
            [BLOCK_ATTRS.props]: null,
            [BLOCK_ATTRS.indent]: null,
          },
          content: text ? [{ type: 'text', text }] : undefined,
        },
      ],
    }),
  });
  if (from === undefined) return state;
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, to ?? from)),
  );
}

// --- normalisation ---------------------------------------------------------

test('a bare host becomes https', () => {
  // Without a scheme a browser resolves the value against the current page, so
  // the link silently points at a path on this instance instead of the site
  // somebody meant.
  assert.equal(normaliseHref('example.org'), 'https://example.org');
  assert.equal(normaliseHref('example.org/path'), 'https://example.org/path');
  assert.equal(normaliseHref('  sub.example.org  '), 'https://sub.example.org');
});

test('an existing scheme is left alone', () => {
  assert.equal(normaliseHref('https://example.org'), 'https://example.org');
  assert.equal(normaliseHref('http://example.org'), 'http://example.org');
  assert.equal(normaliseHref('ftp://example.org'), 'ftp://example.org');
});

test('an email address becomes mailto', () => {
  assert.equal(normaliseHref('someone@example.org'), 'mailto:someone@example.org');
});

test('a relative link stays relative', () => {
  // So a shared page keeps working behind a different host.
  assert.equal(normaliseHref('/p/some-id'), '/p/some-id');
});

test('executable schemes are refused, not sanitised', () => {
  // A link in a notes app is often pasted from somewhere else. Sanitising a URL
  // scheme correctly by hand is not something to attempt, so these are refused
  // outright.
  for (const dangerous of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox',
  ]) {
    assert.equal(normaliseHref(dangerous), null, `${dangerous} must be refused`);
  }
});

test('unusable input is refused rather than stored broken', () => {
  for (const bad of ['', '   ', 'not a link', 'nodot']) {
    assert.equal(normaliseHref(bad), null);
  }
});

// --- applying --------------------------------------------------------------

test('a link is applied over the selection', () => {
  let state = stateWith('visit example', 1, 6);
  let next: EditorState | null = null;
  const applied = setLink('example.org')(state, (tr) => {
    next = state.apply(tr);
  });
  assert.ok(applied);
  state = next!;

  const link = state.doc.firstChild!.firstChild!.marks.find(
    (mark) => mark.type.name === 'link',
  );
  assert.ok(link, 'the mark must be present');
  assert.equal(link!.attrs['href'], 'https://example.org');
});

test('an unusable address applies nothing', () => {
  const state = stateWith('text', 1, 5);
  assert.equal(setLink('nonsense')(state, undefined), false);
});

test('setting a link over an existing one replaces it', () => {
  // addMark over a link with a different href leaves two marks, and the browser
  // follows whichever it finds first.
  let state = stateWith('link text', 1, 10);
  let next: EditorState | null = null;
  setLink('first.example')(state, (tr) => {
    next = state.apply(tr);
  });
  state = next!;
  setLink('second.example')(state, (tr) => {
    next = state.apply(tr);
  });
  state = next!;

  const marks = state.doc.firstChild!.firstChild!.marks.filter(
    (mark) => mark.type.name === 'link',
  );
  assert.equal(marks.length, 1, 'exactly one link mark');
  assert.equal(marks[0]!.attrs['href'], 'https://second.example');
});

test('an empty selection inserts the address as the link text', () => {
  // Otherwise the command appears to do nothing, which is worse than a
  // reasonable guess.
  let state = stateWith('', 1);
  let next: EditorState | null = null;
  const applied = setLink('example.org')(state, (tr) => {
    next = state.apply(tr);
  });
  assert.ok(applied);
  state = next!;
  assert.equal(state.doc.firstChild!.textContent, 'https://example.org');
});

test('a link can be removed', () => {
  let state = stateWith('link text', 1, 10);
  let next: EditorState | null = null;
  setLink('example.org')(state, (tr) => {
    next = state.apply(tr);
  });
  state = next!;

  const removed = removeLink(state, (tr) => {
    next = state.apply(tr);
  });
  assert.ok(removed);
  state = next!;
  assert.equal(
    state.doc.firstChild!.firstChild!.marks.length,
    0,
    'no marks should remain',
  );
});

test('the link under a collapsed cursor is found with its full extent', () => {
  // So clicking inside a link and pressing the shortcut edits that link rather
  // than creating a nested one.
  let state = stateWith('a link here', 3, 7);
  let next: EditorState | null = null;
  setLink('example.org')(state, (tr) => {
    next = state.apply(tr);
  });
  state = next!;

  // Cursor inside the linked run.
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)));
  const found = linkAt(state);
  assert.ok(found, 'a link should be found from inside it');
  assert.equal(found!.href, 'https://example.org');
  assert.equal(found!.from, 3);
  assert.equal(found!.to, 7);
});

test('no link is reported where there is none', () => {
  const state = stateWith('plain text', 3);
  assert.equal(linkAt(state), null);
});
