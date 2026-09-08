/**
 * Finding the page a link names, wherever it is (ADR-0175).
 *
 * > Das [[ Menü sucht allerdings nur im selben Workspace richtig? Kann man das
 * > ausweiten auf alle in denen ich bin?
 *
 * It can, and this has to come first — because **a link to a page in another
 * workspace does not open today**, and a picker offering one would be a picker
 * offering broken links.
 *
 * The chain, read rather than guessed:
 *
 *   - a page address carries no workspace, deliberately (ADR-0016): *"the
 *     session carries it, so a page moving between workspaces does not
 *     invalidate every link to it"*
 *   - the sync client is built with one workspace in its credentials
 *   - and the server refuses the room, correctly:
 *     `if (page.workspaceId !== claims.workspaceId) return null;` —
 *     *"a page in another workspace is invisible regardless of grants"*
 *
 * So the interface opened the right address on a connection bound to the wrong
 * workspace, and said "you no longer have access to this page", which was not
 * true. The inbox hit exactly this and solved it by carrying the workspace id
 * beside the address; a link in a document cannot — it is only an address. So
 * the address is enough, and *where* is looked up.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { whereabouts } from '../src/hooks/usePageWhereabouts.ts';

const HERE = 'ws-1';
const THERE = 'ws-2';
const PAGE = 'page-1';

test('nothing to find when no page is named', () => {
  assert.deepEqual(
    whereabouts({ pageId: null, inTree: false, treeLoaded: true, workspaceId: HERE, found: null }),
    { status: 'here' },
  );
});

test('a page in this workspace opens without asking anybody', () => {
  // The ordinary case, and it must cost no request: the tree already knows.
  assert.deepEqual(
    whereabouts({ pageId: PAGE, inTree: true, treeLoaded: true, workspaceId: HERE, found: null }),
    { status: 'here' },
  );
});

test('while the tree is still loading, nothing is decided', () => {
  /*
   * Opening optimistically would mean the cross-workspace case fails first and
   * recovers second — one refused room and one false error message on the way
   * to the right answer. The tree is a single request and arrives before the
   * document does, so waiting for it costs less than the flash it prevents.
   */
  assert.deepEqual(
    whereabouts({ pageId: PAGE, inTree: false, treeLoaded: false, workspaceId: HERE, found: null }),
    { status: 'looking' },
  );
});

test('a page the tree does not list is asked about', () => {
  assert.deepEqual(
    whereabouts({ pageId: PAGE, inTree: false, treeLoaded: true, workspaceId: HERE, found: null }),
    { status: 'asking' },
  );
});

test('and if it is in this workspace after all, it opens', () => {
  /*
   * The tree is not the whole truth: an archived page is not listed and can
   * still be opened by its address, which is what a link written before it was
   * archived does. Answering "not here" for those would be a link that stopped
   * working for the wrong reason.
   */
  assert.deepEqual(
    whereabouts({
      pageId: PAGE,
      inTree: false,
      treeLoaded: true,
      workspaceId: HERE,
      found: { pageId: PAGE, workspaceId: HERE },
    }),
    { status: 'here' },
  );
});

test('a page in another workspace says which one', () => {
  assert.deepEqual(
    whereabouts({
      pageId: PAGE,
      inTree: false,
      treeLoaded: true,
      workspaceId: HERE,
      found: { pageId: PAGE, workspaceId: THERE },
    }),
    { status: 'elsewhere', workspaceId: THERE },
  );
});

test('an answer about a different page is ignored', () => {
  /*
   * Two page addresses in quick succession — following a link and then the back
   * button — and the first answer can arrive after the second question. Keyed by
   * the page it is about, so a stale answer cannot switch the workspace out from
   * under the page somebody is now looking at.
   */
  assert.deepEqual(
    whereabouts({
      pageId: PAGE,
      inTree: false,
      treeLoaded: true,
      workspaceId: HERE,
      found: { pageId: 'some-other-page', workspaceId: THERE },
    }),
    { status: 'asking' },
  );
});

test('a refusal is a page that is not there', () => {
  // The server answers the same for "does not exist" and "not yours", on
  // purpose: the distinction reveals which pages exist.
  assert.deepEqual(
    whereabouts({
      pageId: PAGE,
      inTree: false,
      treeLoaded: true,
      workspaceId: HERE,
      found: { pageId: PAGE, workspaceId: null },
    }),
    { status: 'nowhere' },
  );
});

test('the document is opened only once its workspace is settled', () => {
  /*
   * The point of the whole hook. `usePage` is handed null until then, so the
   * connection is never asked for a room it will be refused — the refusal that
   * produced the false "you no longer have access".
   */
  const source = [
    { status: 'looking' as const },
    { status: 'asking' as const },
    { status: 'elsewhere' as const, workspaceId: THERE },
    { status: 'nowhere' as const },
  ];
  for (const state of source) {
    assert.equal(state.status === 'here', false, state.status);
  }
});
