/**
 * Linking across the workspaces somebody is in (ADR-0176).
 *
 * > Kann man das ausweiten auf alle in denen ich bin?
 *
 * The picker offered one workspace because that is the list the sidebar already
 * had, not because a page elsewhere is any less linkable — an address names a
 * uuid and nothing else (ADR-0016), and ADR-0175 made such a link open.
 *
 * What the widening actually costs is *telling them apart*. Three pages called
 * *Protokoll* in one workspace were already a problem the folder path solved;
 * three in three workspaces are a worse one, and the folder path does not solve
 * it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';
import {
  filterPages,
  groupPages,
  type LinkablePage,
} from '../src/components/PageLinkMenu.tsx';

const THERE = 'ws-there';

/**
 * A row as the picker sees it.
 *
 * `workspaceId` omitted means the list this shell already held, which **is**
 * the current workspace by construction — so nothing has to pass an id in, and
 * the share view does not have to invent one.
 */
const page = (
  id: string,
  title: string,
  workspaceId?: string,
  extra: Partial<LinkablePage> = {},
): LinkablePage =>
  ({
    id,
    title,
    parentPageId: null,
    kind: 'page',
    archived: false,
    ...(workspaceId ? { workspaceId } : {}),
    ...extra,
  }) as LinkablePage;

const PAGES: LinkablePage[] = [
  page('a', 'Protokoll'),
  page('b', 'Satzung'),
  page('c', 'Protokoll', THERE, { workspaceName: 'Verein' }),
  page('d', 'Planung', THERE, { workspaceName: 'Verein' }),
];

test('this workspace comes first, whatever the titles say', () => {
  /*
   * The ordinary reference is to a page next door, and a list that sorted
   * purely by match would let a page from a workspace somebody has not opened
   * in a month sit above the one they meant.
   */
  const groups = groupPages(filterPages('protokoll', PAGES, null));
  assert.deepEqual(
    groups.map((group) => group.workspaceId),
    [null, THERE],
  );
});

test('and it is drawn without a heading, because it needs no name', () => {
  // "Here" is where somebody already is. A heading over it would name the
  // obvious and push the first row down.
  const groups = groupPages(filterPages('protokoll', PAGES, null));
  assert.equal(groups[0]?.label, null);
  assert.equal(groups[1]?.label, 'Verein');
});

test('a workspace with nothing matching is not a heading over nothing', () => {
  const groups = groupPages(filterPages('satzung', PAGES, null));
  assert.deepEqual(
    groups.map((group) => group.pages.map((one) => one.id)),
    [['b']],
  );
});

test('with nothing here at all, the other workspace still answers', () => {
  // The case that makes the widening worth having: the page somebody means is
  // simply not in this workspace.
  const groups = groupPages(filterPages('planung', PAGES, null));
  assert.deepEqual(
    groups.map((group) => [group.label, group.pages.map((one) => one.id)]),
    [['Verein', ['d']]],
  );
});

test('two other workspaces keep a stable order', () => {
  // By name, so the list does not rearrange itself between two keystrokes that
  // matched the same rows.
  const wider = [
    ...PAGES,
    page('e', 'Protokoll', 'ws-third', { workspaceName: 'Archiv' }),
  ];
  const groups = groupPages(filterPages('protokoll', wider, null));
  assert.deepEqual(
    groups.map((group) => group.label),
    [null, 'Archiv', 'Verein'],
  );
});

test('the filter still refuses what nobody could choose', () => {
  // Unchanged from ADR-0173, and worth holding while the list grew a dimension:
  // no title, path-only, archived.
  const list = [
    page('a', ''),
    page('b', 'Gerüst', THERE, { pathOnly: true, workspaceName: 'Verein' }),
    page('c', 'Alt', THERE, { archived: true, workspaceName: 'Verein' }),
    page('d', 'Echt', THERE, { workspaceName: 'Verein' }),
  ];
  assert.deepEqual(
    filterPages('', list, null).map((one) => one.id),
    ['d'],
  );
});

test('the list is fetched once, not per keystroke', () => {
  /*
   * What makes the picker feel like part of typing is that it filters in
   * memory. A request per character would put a network between `[[` and the
   * list — so the pages of the other workspaces are fetched when the picker
   * first opens and kept for the session.
   */
  const hook = codeOf(new URL('../src/hooks/useLinkTargets.ts', import.meta.url));
  // The call, wherever the formatter puts the line break.
  assert.match(hook, /api[\s\S]{0,20}\.linkTargets\(\)/);
  assert.match(hook, /let cached/);
});

test('and only when a picker actually wants it', () => {
  // Nothing is asked for on a page nobody links from. The hook takes whether
  // the menu is open, and that is the whole trigger.
  const hook = codeOf(new URL('../src/hooks/useLinkTargets.ts', import.meta.url));
  assert.match(hook, /if \(!wanted\)/);
});

test('a share-link visitor is still offered nothing', () => {
  // ADR-0173's rule, and the widening does not touch it: the request needs a
  // session, and the shell passes an empty list on that path anyway.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  const share = app.slice(app.indexOf('function ShareSession'));
  assert.match(share, /linkablePages=\{\[\]\}/);
});
