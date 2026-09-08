/**
 * What `[[` leaves behind (ADR-0173).
 *
 * A mention is an atom: one node carrying an id and a cached label. A page link
 * is **ordinary words wearing a link mark**, which is the whole decision of
 * ADR-0170 — a relative address survives an export, a copy into an email, and
 * being read behind another host, and the page uuid inside it is what a
 * backlink index will read.
 *
 * So this does what `insertMention` does, with a different thing on the other
 * side of the replacement, and one deliberate difference: no trailing space.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import { insertPageLink, pageLinkMenu, pageLinkMenuState } from '../src/pageLinkMenu.js';
import { schema } from '../src/schema.js';

const PAGE = '/p/00000000-0000-4000-8000-000000000001/satzung';

/** A mounted-enough editor: a view is needed, so a fake one dispatches. */
function open(text: string): { state: () => EditorState; view: never } {
  let current = EditorState.create({
    doc: schema.nodes['doc']!.create(null, [
      schema.nodes['paragraph']!.create({ [BLOCK_ATTRS.id]: 'p1' }),
    ]),
    plugins: [pageLinkMenu()],
  });
  current = current.apply(
    current.tr.setSelection(TextSelection.near(current.doc.resolve(current.doc.content.size))),
  );
  for (const character of text) {
    current = current.apply(current.tr.insertText(character, current.selection.head));
  }
  /*
   * A stand-in for the view, because `insertPageLink` needs one to dispatch
   * against and a real `EditorView` needs a DOM. What it uses is `state`,
   * `dispatch` and `focus` — so those are what this has, and the state moves
   * forward exactly as ProseMirror would move it.
   */
  const view = {
    get state() {
      return current;
    },
    dispatch: (tr: ReturnType<EditorState['tr']['setMeta']>) => {
      current = current.apply(tr as never);
    },
    focus: () => undefined,
  };
  return { state: () => current, view: view as never };
}

test('the trigger and the query are replaced by the page title', () => {
  const { state, view } = open('siehe [[Satz');
  assert.ok(pageLinkMenuState(state()), 'the menu is open');

  assert.equal(insertPageLink(view, { href: PAGE, label: 'Satzung' }), true);
  assert.equal(state().doc.textBetween(1, state().doc.content.size), 'siehe Satzung');
});

test('and the words carry the link', () => {
  const { state, view } = open('[[Satz');
  insertPageLink(view, { href: PAGE, label: 'Satzung' });

  const type = schema.marks['link']!;
  const marks = state().doc.resolve(2).marks();
  const link = marks.find((mark) => mark.type === type);
  assert.ok(link, 'the title is a link');
  assert.equal(link.attrs['href'], PAGE);
});

test('the whole title is linked, not the first character of it', () => {
  const { state, view } = open('[[Satz');
  insertPageLink(view, { href: PAGE, label: 'Satzung' });

  const type = schema.marks['link']!;
  const linked: string[] = [];
  state().doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type === type)) linked.push(node.text ?? '');
  });
  assert.deepEqual(linked, ['Satzung']);
});

test('no trailing space, because the mark does not reach past its words', () => {
  /*
   * `insertMention` adds one, and it is right there: a mention is an atom and a
   * caret directly after one has nowhere ordinary to be.
   *
   * The link mark is `inclusive: false` (see the schema), so the caret after it
   * is already outside the link and what gets typed next is ordinary text. A
   * space here would be a word the person did not type — and the sentence they
   * are writing may want a comma.
   */
  const { state, view } = open('[[Satz');
  insertPageLink(view, { href: PAGE, label: 'Satzung' });
  assert.equal(state().doc.textBetween(1, state().doc.content.size), 'Satzung');
});

test('it closes the menu', () => {
  const { state, view } = open('[[Satz');
  insertPageLink(view, { href: PAGE, label: 'Satzung' });
  assert.equal(pageLinkMenuState(state()), null);
});

test('and does nothing at all when no menu is open', () => {
  const { state, view } = open('siehe ');
  assert.equal(insertPageLink(view, { href: PAGE, label: 'Satzung' }), false);
  assert.equal(state().doc.textBetween(1, state().doc.content.size), 'siehe ');
});

test('an address that executes is refused, whatever it is labelled', () => {
  // The same door as everywhere else (ADR-0157). Nothing in this application
  // builds such an address for this call, and the guard is at the door rather
  // than at the callers, because that is the arrangement that survives a new
  // caller.
  const { state, view } = open('[[Satz');
  assert.equal(insertPageLink(view, { href: 'javascript:alert(1)', label: 'Satzung' }), false);
  assert.equal(state().doc.textBetween(1, state().doc.content.size), '[[Satz');
});
