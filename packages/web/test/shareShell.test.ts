/**
 * The shared-link view is the same shell as the workspace, minus the rail.
 *
 * The first version of the page list was its own object: a `<nav class="share-
 * tree">` with its own border, its own type scale and its own indent rules. It
 * came out as a **bar across the whole width, above the page** — because `.app`
 * is a grid of one column, so a second child is a second row, and the `flex:
 * 0 0 15rem` that was supposed to make it a column is a property a grid item
 * ignores.
 *
 * Reported as: "es ist keine Seitenleiste sondern ein breites Menü quer über
 * die ganze Seite", and then: "optisch sollte es am original bleiben".
 *
 * Two things had gone wrong, and only one of them was the layout. The other is
 * that a second design had been drawn for an object that already exists. A
 * shared link is somebody's first sight of SONE; if its navigation is a
 * different object from the one in the workspace, the two read as two products.
 *
 * So this test asserts the shell rather than the pixels: the same classes, the
 * column as a track on the parent, and no rail.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const app = (): string => codeOf(new URL('../src/App.tsx', import.meta.url));
const css = (): string => stylesOf(new URL('../src/styles.css', import.meta.url));

test('the shared list is the sidebar, not a second one', () => {
  const source = app();
  // The class it actually carries, so it inherits the surface, the head, the
  // rows and the collapse control rather than restating them.
  assert.match(source, /className=\{`sidebar share-tree\$\{treeOpen \? ' open' : ''\}`\}/);
  assert.match(source, /className="panel-head"/);
  assert.match(source, /className="panel-body"/);
  // Rows are tree rows, with the same icon component the workspace tree uses.
  assert.match(source, /className="tree-row"/);
  assert.match(source, /className="tree-link"/);
  assert.match(source, /<EntryIconView icon=\{null\} kind=\{drawnKind\(entry\.kind\)\}/);
});

test('the width is a track on the parent, not a property of the list', () => {
  /*
   * The bug itself. `flex: 0 0 15rem` on a child of a grid is inert, which is
   * why the list spanned the window — so what this asserts is that the column
   * is declared where the grid can see it.
   */
  const styles = css();
  assert.match(
    styles,
    /\.app\.with-share-tree \{\s*grid-template-columns:\s*var\(--sidebar-width, 260px\) minmax\(0, 1fr\);/,
  );
  assert.doesNotMatch(styles, /\.share-tree \{[^}]*flex:/);
});

test('collapsing removes the track, not just the list', () => {
  // A zero-width column still draws its border and its padding. The workspace
  // learned this once already; the same rule, for the same reason.
  const styles = css();
  assert.match(
    styles,
    /\.app\.with-share-tree\[data-sidebar='hidden'\] \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
});

test('there is no rail beside a shared link', () => {
  /*
   * `with-sidebar` opens its template with `var(--rail-width)`. This view must
   * not: the rail holds the inbox, the trash, settings and the account, and a
   * visitor holding a link has none of them — so the track would be 56px of
   * the workspace's furniture drawn for somebody who is not in it.
   */
  const source = app();
  const shell = source.slice(source.indexOf('function ShareSession'));
  assert.doesNotMatch(shell, /<IconRail/, 'no rail in the shared view');
  assert.doesNotMatch(shell, /with-sidebar/, 'and not the workspace template');

  assert.doesNotMatch(
    css(),
    /\.app\.with-share-tree \{\s*grid-template-columns:\s*var\(--rail-width\)/,
  );
});

test('the list can be closed, and reopened', () => {
  /*
   * Asked for as "Seitenleiste mit Button zum schließen". Both halves matter:
   * `.drawer-close` is hidden above 800px, so a close control inside the head
   * is the narrow-screen answer and the topbar toggle is the wide-screen one —
   * exactly the pair the workspace has. Only the first without the second would
   * be a door that locks behind you.
   */
  const source = app();
  const shell = source.slice(source.indexOf('function ShareSession'));
  assert.match(shell, /className="quiet drawer-close"/);
  assert.match(shell, /className="quiet sidebar-toggle"/);
  assert.match(shell, /data-sidebar=\{treeOpen \? 'shown' : 'hidden'\}/);
});

test('a link to a single page gets no list at all', () => {
  // An aside holding one entry is furniture, and the empty column would be a
  // margin with a border on it.
  const source = app();
  assert.match(source, /const hasTree = shared\.length > 1;/);
  assert.match(source, /className=\{hasTree \? 'app with-share-tree' : 'app'\}/);
});
