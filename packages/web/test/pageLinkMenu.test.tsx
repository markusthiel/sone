/**
 * Choosing which page `[[` means (ADR-0173).
 *
 * The plugin holds a position and a query and never a list — so which pages are
 * offered, how they are narrowed, and what a person may see are decided here.
 *
 * Two of those are the interesting ones:
 *
 *   - **Two pages can share a title.** A workspace has a *Protokoll* in every
 *     folder, and a list of identical words is not a choice.
 *   - **A share-link visitor must not learn what the workspace contains**
 *     (ADR-0026), so the list they are offered is the empty one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';
import { filterPages, pathOf, type LinkablePage } from '../src/components/PageLinkMenu.tsx';

const page = (id: string, title: string | null, parentPageId: string | null = null,
  extra: Partial<LinkablePage> = {}): LinkablePage =>
  ({ id, title, parentPageId, kind: 'page', archived: false, ...extra }) as LinkablePage;

const PAGES: LinkablePage[] = [
  page('v', 'Verein'),
  page('s', 'Satzung', 'v'),
  page('m', 'Mitgliederversammlung', 'v'),
  page('p1', 'Protokoll', 'm'),
  page('t', 'Technik'),
  page('p2', 'Protokoll', 't'),
];

test('an empty query offers pages, not nothing', () => {
  // The menu opens the moment `[[` is typed, before anything is narrowed. An
  // empty list there reads as "there are no pages", which is never true.
  assert.ok(filterPages('', PAGES, null).length > 0);
});

test('what is typed narrows by title', () => {
  assert.deepEqual(
    filterPages('satz', PAGES, null).map((one) => one.id),
    ['s'],
  );
});

test('a title that begins with what was typed comes first', () => {
  // The same ranking the people menu uses: somebody typing three letters is
  // usually at the beginning of the word they mean.
  const list = [page('a', 'Vereinssatzung'), page('b', 'Satzung')];
  assert.deepEqual(
    filterPages('satz', list, null).map((one) => one.id),
    ['b', 'a'],
  );
});

test('accents and case do not have to be typed', () => {
  // "Ubersicht" finds "Übersicht": making somebody find the umlaut key first
  // is a worse search than none (ADR-0085).
  const list = [page('u', 'Übersicht')];
  assert.deepEqual(filterPages('ubersicht', list, null).map((one) => one.id), ['u']);
});

test('the page being written on is not offered', () => {
  /*
   * A link from a page to itself lands where the reader already is. It is not
   * wrong so much as empty — and it takes the place of a page they could have
   * meant.
   */
  assert.deepEqual(
    filterPages('satz', PAGES, 's').map((one) => one.id),
    [],
  );
});

test('a page with no title of its own is not offered', () => {
  /*
   * `title` is nullable, and `pathOnly` marks an entry that is here only as a
   * path to something below it (ADR-0026) — a person may open neither. An
   * untitled row in a picker is a row nobody can choose on purpose.
   */
  const list = [
    page('a', null),
    page('b', '   '),
    page('c', 'Gerüst', null, { pathOnly: true }),
    page('d', 'Echt'),
  ];
  assert.deepEqual(filterPages('', list, null).map((one) => one.id), ['d']);
});

test('and neither is one in the archive', () => {
  const list = [page('a', 'Alt', null, { archived: true }), page('b', 'Neu')];
  assert.deepEqual(filterPages('', list, null).map((one) => one.id), ['b']);
});

test('where a page sits is shown, because two can share a title', () => {
  /*
   * The list would otherwise be two rows reading *Protokoll*, and choosing
   * between them would be guessing. The folders above it are what tells them
   * apart, which is the same thing the breadcrumb says on the page itself.
   */
  assert.equal(pathOf(PAGES[3]!, PAGES), 'Verein / Mitgliederversammlung');
  assert.equal(pathOf(PAGES[5]!, PAGES), 'Technik');
  assert.equal(pathOf(PAGES[0]!, PAGES), '');
});

test('a parent that is missing ends the path rather than the world', () => {
  // A page whose folder is not in the list — outside what this person may see,
  // or not loaded yet — is a page with a shorter path, not a crash.
  const orphan = [page('x', 'Irgendwo', 'gone')];
  assert.equal(pathOf(orphan[0]!, orphan), '');
});

test('a cycle in the parents does not loop forever', () => {
  // Nothing should be able to write one, and a walk up a tree read from a
  // server is exactly the place not to assume that.
  const cyclic = [page('a', 'A', 'b'), page('b', 'B', 'a')];
  assert.equal(typeof pathOf(cyclic[0]!, cyclic), 'string');
});

test('a share-link visitor is offered nothing', () => {
  /*
   * *„a visitor holding a link is not a member and must not learn what else the
   * workspace contains"* — the rule the share session already states about its
   * own list of entries.
   *
   * The empty list rather than a filtered one, following `members={[]}` on the
   * same path and for the same kind of reason: what a visitor may see is the
   * server's answer to give, and a picker fed from a list this view does not
   * have is a picker that would have to invent one.
   */
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  const share = app.slice(app.indexOf('function ShareSession'));
  assert.match(share, /linkablePages=\{\[\]\}/);
});

test('the workspace shell hands it the pages it already has', () => {
  // From `usePages`, which the sidebar is already using — one answer to "what
  // is in this workspace" rather than two.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /linkablePages=\{pages\}/);
});

test('the address stored carries no share token', () => {
  /*
   * The rule of ADR-0170, and this is the second caller that could break it.
   * `usePageLink()` would put the token in — correct for a link being followed,
   * wrong for one being written into a document, where it becomes a credential
   * that travels with the content.
   */
  const menu = codeOf(new URL('../src/components/PageLinkMenu.tsx', import.meta.url));
  assert.match(menu, /documentAddress\(/);
  assert.doesNotMatch(menu, /usePageLink|useShareToken/);
});

test('and it is relative, because a document is read wherever it is read', () => {
  /*
   * `blockAddress` is absolute on purpose: it goes to the clipboard, and a bare
   * path is not an address to paste into an email.
   *
   * A link *inside* a document is the other case. It is followed from wherever
   * the document is being read, so it should name no host at all — the rule
   * `normaliseHref` already states about a relative link: *"a shared page keeps
   * working behind a different host"*.
   */
  const links = codeOf(new URL('../src/routes/internalLinks.ts', import.meta.url));
  assert.match(links, /export function documentAddress\(/);
  assert.match(links, /return `\$\{origin\}\$\{documentAddress\(/);
});
