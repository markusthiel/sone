/**
 * Addresses that become links by themselves (ADR-0198).
 *
 * Reported as: *„Links sollten im editor automatisch als links erkannt werden,
 * momentan ist es reiner text, der eingesetzt wird."*
 *
 * Most of the weight here is on what must *not* become a link. Turning an
 * address into a link is worth nothing if it also turns `z.B.` into one: that
 * is somebody's prose rewritten, in a document that syncs the mistake to
 * everyone else before they notice it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import { autoLink, looksLikeAddress, trimTrailingPunctuation } from '../src/autoLink.js';
import { schema } from '../src/schema.js';

function stateWith(text: string, caret?: number): EditorState {
  const state = EditorState.create({
    schema,
    plugins: [autoLink()],
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
  const at = caret ?? text.length + 1;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** The link mark covering `word` in the document, if there is one. */
function linkOn(state: EditorState, word: string): string | null {
  const type = schema.marks['link'];
  if (!type) return null;
  const text = state.doc.textBetween(0, state.doc.content.size, '\n', '\n');
  const index = text.indexOf(word);
  if (index === -1) return null;
  let found: string | null = null;
  state.doc.descendants((node) => {
    if (!node.isText) return true;
    if (!node.text?.includes(word)) return true;
    const mark = node.marks.find((m) => m.type === type);
    if (mark) found = String(mark.attrs['href'] ?? '');
    return true;
  });
  return found;
}

/**
 * Type a space at the caret, the way the view would.
 *
 * `handleTextInput` is a view prop, so it is invoked directly with a stand-in
 * that records what it was handed: mounting a real view needs a DOM, and what
 * is worth pinning is the transaction, not the browser.
 */
function typeSpace(state: EditorState): EditorState {
  const plugin = state.plugins.find((p) => p.props.handleTextInput);
  assert.ok(plugin, 'the plugin offers handleTextInput');
  const at = state.selection.from;
  let next = state;
  const view = {
    state,
    dispatch: (tr: unknown) => {
      next = state.apply(tr as never);
    },
  };
  // The last argument is the default transaction ProseMirror would have
  // applied. This handler does not consult it; it is passed so the call
  // matches the prop's shape.
  const handled = plugin.props.handleTextInput?.call(
    plugin,
    view as never,
    at,
    at,
    ' ',
    () => state.tr.insertText(' ', at),
  );
  if (!handled) next = state.apply(state.tr.insertText(' ', at));
  return next;
}

// --- what becomes a link ---------------------------------------------------

test('a typed address becomes a link when the space is typed', () => {
  const after = typeSpace(stateWith('Siehe https://example.org'));
  assert.equal(linkOn(after, 'https://example.org'), 'https://example.org');
});

test('www without a scheme is an address', () => {
  // It has meant "address" since before anybody typed schemes out.
  const after = typeSpace(stateWith('Siehe www.example.org'));
  assert.equal(linkOn(after, 'www.example.org'), 'https://www.example.org');
});

test('a mail address becomes mailto', () => {
  const after = typeSpace(stateWith('Schreib an markus@thiel.email'));
  assert.equal(linkOn(after, 'markus@thiel.email'), 'mailto:markus@thiel.email');
});

test('the space is inserted by the same transaction', () => {
  /*
   * One keystroke, one transaction. Two would mean undo takes two presses to
   * get back to where the person was — the kind of small wrongness nobody
   * reports and everybody feels.
   */
  const after = typeSpace(stateWith('https://example.org'));
  assert.match(after.doc.textBetween(0, after.doc.content.size), /https:\/\/example\.org $/);
});

test('what follows the address is not swallowed by the link', () => {
  // The failure everybody knows from mail clients: the rest of the sentence
  // joins the link because the mark stayed in the stored set.
  const after = typeSpace(stateWith('https://example.org'));
  const type = schema.marks['link'];
  assert.ok(type);
  assert.ok(!type.isInSet(after.storedMarks ?? []));
});

// --- what does not ---------------------------------------------------------

test('an abbreviation is not an address', () => {
  // `normaliseHref` would happily make https://z.B. of this. It is right to,
  // for a person who typed it into a link field; here nobody asked.
  for (const prose of ['Das gilt z.B.', 'Siehe Abs.2', 'Faktor 1.5x', 'example.org']) {
    const after = typeSpace(stateWith(prose));
    const word = prose.split(' ').pop() ?? '';
    assert.equal(linkOn(after, word), null, `${prose} must stay prose`);
  }
});

test('the full stop ending a sentence stays out of the address', () => {
  const after = typeSpace(stateWith('Siehe https://example.org.'));
  assert.equal(linkOn(after, 'https://example.org'), 'https://example.org');
  assert.match(after.doc.textBetween(0, after.doc.content.size), /example\.org\. $/);
});

test('brackets that belong to the address are kept', () => {
  assert.equal(
    trimTrailingPunctuation('https://example.org/x_(y)'),
    'https://example.org/x_(y)',
  );
  assert.equal(
    trimTrailingPunctuation('https://example.org/x)'),
    'https://example.org/x',
  );
  assert.equal(trimTrailingPunctuation('https://example.org/a/'), 'https://example.org/a/');
});

test('an address already linked by hand is left alone', () => {
  const type = schema.marks['link'];
  assert.ok(type);
  let state = stateWith('https://example.org');
  const tr = state.tr.addMark(1, 20, type.create({ href: 'https://elsewhere.test' }));
  state = state.apply(tr.setSelection(TextSelection.create(tr.doc, 20)));
  const after = typeSpace(state);
  assert.equal(linkOn(after, 'https://example.org'), 'https://elsewhere.test');
});

test('a scheme that executes is refused', () => {
  // The door `hrefs.ts` holds shut (ADR-0157); asked again here because this
  // is a second way into the document.
  const after = typeSpace(stateWith('javascript:alert(1)'));
  assert.equal(linkOn(after, 'javascript:alert(1)'), null);
});

// --- the shapes themselves -------------------------------------------------

test('only unmistakable addresses are pasted as links', () => {
  for (const yes of [
    'https://example.org',
    'http://example.org/a?b=c',
    'www.example.org',
    'markus@thiel.email',
  ]) {
    assert.ok(looksLikeAddress(yes), `${yes} is an address`);
  }
  for (const no of ['example.org', 'z.B.', '1.5x', 'Hallo Welt', 'https://a b', '']) {
    assert.ok(!looksLikeAddress(no), `${no} is not`);
  }
});

test('typing an address does not link it a letter at a time', () => {
  /*
   * Reported with a picture: `https://n` was a link and `atec-bw.de` was not,
   * because the condition for "the caret left the block" compared node
   * *objects* — and a node is rebuilt on every edit, so it was true on every
   * keystroke. The address was linked the moment its first character made it
   * match, and the rest of it was typed outside the mark.
   */
  let state = stateWith('https://');
  for (const character of 'natec-bw.de') {
    const at = state.selection.from;
    state = state.apply(state.tr.insertText(character, at));
    assert.equal(
      linkOn(state, 'https://'),
      null,
      `nothing is linked while "${state.doc.textBetween(1, state.selection.from)}" is still being typed`,
    );
  }

  // And then the space settles it, over the whole address.
  const after = typeSpace(state);
  assert.equal(linkOn(after, 'https://natec-bw.de'), 'https://natec-bw.de');
});

test('editing inside a block does not link', () => {
  // The same mistake from the other side: a change that is not a keystroke at
  // the end — a deletion here — must not settle anything either.
  let state = stateWith('https://example.org und mehr');
  const end = state.selection.from;
  state = state.apply(state.tr.delete(end - 5, end));
  assert.equal(linkOn(state, 'https://example.org'), null);
});

// --- leaving the block -----------------------------------------------------

test('leaving the block links the address the caret just left', () => {
  /*
   * Enter, and every other way out. Done by looking at where the caret ended
   * up rather than by taking the key: ProseMirror stops at the first plugin
   * that handles one, so a key handler here would work or not depending on
   * where this plugin sits among twenty others.
   *
   * Applied through `state.apply`, which is what runs `appendTransaction` —
   * calling the hook by hand tests the hook and not the wiring, and the wiring
   * is the half that was in doubt.
   */
  const state = stateWith('https://example.org');
  const next = state.apply(state.tr.split(state.selection.from));
  assert.equal(linkOn(next, 'https://example.org'), 'https://example.org');
  assert.equal(next.doc.childCount, 2, 'and the block is still split');
});

test('a block left without an address in it is untouched', () => {
  const state = stateWith('Nur Text');
  const next = state.apply(state.tr.split(state.selection.from));
  assert.equal(linkOn(next, 'Nur Text'), null);
});
