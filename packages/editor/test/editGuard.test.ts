/**
 * The other half of the page lock's one predicate (ADR-0049).
 *
 * ADR-0049 claimed a locked page went through one predicate, so that no command
 * had to remember the lock. It went through `editable`, which ProseMirror asks
 * about what the *user* does — and not about a transaction a button dispatches.
 * The gutter menu's delete dispatches. So a locked page refused typing and
 * deleted its blocks.
 *
 * The first test is the report, in the form the code sees it: a command, run
 * against a state that may not be edited. The rest are the exemptions, and each
 * of them is here because refusing that transaction breaks something worse than
 * the hole it closes.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from 'prosemirror-state';
import { ySyncPluginKey } from 'y-prosemirror';

import { editGuard } from '../src/editGuard.js';
import { deleteBlockSubtree } from '../src/blockOps.js';
import { schema } from '../src/schema.js';

/**
 * A page with a sentence in it, and a lock somebody can turn.
 *
 * The state is built while editing is allowed and locked afterwards, which is
 * also the order it happens in: a page is written and then locked.
 */
function lockablePage(): { state: EditorState; lock: (on: boolean) => void } {
  let locked = false;
  const box = {
    state: EditorState.create({ schema, plugins: [editGuard(() => !locked)] }),
    lock: (on: boolean) => {
      locked = on;
    },
  };
  box.state = box.state.apply(box.state.tr.insertText('Finished, and locked', 1));
  return box;
}

test('a command dispatched by a menu cannot change a locked page', () => {
  /*
   * The bug as reported: lock the page, click the ⋮⋮ handle, choose delete.
   * `editable` never sees this — the menu calls the command with the view's
   * dispatch, which is not user input.
   */
  const page = lockablePage();
  page.lock(true);

  const before = page.state.doc.textContent;
  deleteBlockSubtree(page.state, (tr) => {
    page.state = page.state.apply(tr);
  });

  assert.equal(page.state.doc.textContent, before, 'the block is still there');
});

test('the same command works when the page is not locked', () => {
  // Otherwise the test above passes for a state that could never be edited at
  // all, and proves nothing about the guard.
  const page = lockablePage();
  const before = page.state.doc.textContent;
  deleteBlockSubtree(page.state, (tr) => {
    page.state = page.state.apply(tr);
  });
  assert.notEqual(page.state.doc.textContent, before, 'deleted');
});

test('a change that is not to the document is not refused', () => {
  // Refusing these would stop somebody selecting and copying a locked page,
  // which ADR-0049 lists first among the things a lock must not take away.
  const page = lockablePage();
  page.lock(true);
  const before = page.state.doc;
  const after = page.state.apply(page.state.tr.setMeta('anything', true));
  assert.equal(after.doc, before, 'the same document, and the transaction applied');
});

test("another client's edit arrives on a locked page", () => {
  /*
   * A lock is a statement about this interface, not a fence around the
   * document. An edit that reaches here over sync has already happened
   * elsewhere; refusing it would make this client's document differ from
   * everybody else's, which is the divergence ADR-0002 exists to prevent.
   */
  const page = lockablePage();
  page.lock(true);
  const remote = page.state.apply(
    page.state.tr.insertText('!', 5).setMeta(ySyncPluginKey, { isChangeOrigin: true }),
  );
  assert.match(remote.doc.textContent, /!/);
});

test('the binding may fill an empty document', () => {
  /*
   * ySyncPlugin populates the ProseMirror document from the Yjs fragment by
   * dispatching, at mount. This is the same exemption as the one above and the
   * reason it is not enough to test a remote keystroke: refusing this renders
   * every locked page blank, and nobody would call that a lock.
   */
  const empty = EditorState.create({ schema, plugins: [editGuard(() => false)] });
  const filled = empty.apply(
    empty.tr.insertText('Content arriving from the document', 1).setMeta(ySyncPluginKey, {}),
  );
  assert.match(filled.doc.textContent, /arriving/);
});

test("the editor's own housekeeping is not refused", () => {
  /*
   * `blockIds` gives an arriving block an id and `fixTables` repairs a table's
   * shape; both mark themselves `addToHistory: false` and both run in response
   * to somebody else's edit. Refusing them leaves a locked page holding blocks
   * without ids — which nobody sees until the page is unlocked and the document
   * is broken.
   */
  const page = lockablePage();
  page.lock(true);
  const fixed = page.state.apply(page.state.tr.insertText('.', 5).setMeta('addToHistory', false));
  assert.match(fixed.doc.textContent, /\./);
});

test('a locked page can be unlocked and edited again', () => {
  // The mistake the block lock made once already: a guard that cannot be lifted
  // is not a lock, it is a wall. The predicate is read on every transaction
  // rather than captured, and this is what says so.
  const page = lockablePage();
  page.lock(true);
  page.lock(false);
  const typed = page.state.apply(page.state.tr.insertText('!', 5));
  assert.match(typed.doc.textContent, /!/);
});
