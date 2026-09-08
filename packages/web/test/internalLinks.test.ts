/**
 * Links that point inside this instance (ADR-0170).
 *
 * > Eine Seite mit einer anderen Seite verlinken wäre super. Aber auch einen
 * > Inhalt mit einem anderen Inhalt eventuell aus einer ganz anderen Seite
 * > verlinken wäre gut. Ich setze einen Link und anstatt auf eine externe
 * > Website ist es ein interner Anker.
 *
 * The anchor existed already: every block carries a persisted uuid, `paths.page`
 * has taken a block id since ADR-0033, and `PageView` scrolls to it on arrival.
 * What was missing is the way there — and three measured faults sat on that
 * way, each of which makes a correct link do nothing.
 *
 * Two questions are settled here, and they are the ones with a security shape:
 *
 *   1. What goes **into the document** — never a share token, because a token
 *      written into content is a credential that gets copied on with it.
 *   2. What happens **on the click** — the token belongs to whoever is reading,
 *      so it is put back on at that moment, from where they are standing
 *      (ADR-0113 the other way round).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

import { blockAddress, internalTarget } from '../src/routes/internalLinks.ts';

const PAGE = '00000000-0000-4000-8000-000000000001';
const BLOCK = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://sone.example';

test('the address of a block is absolute, and names the block', () => {
  // Absolute, because this is what somebody pastes — into a link editor here,
  // but just as likely into a chat message or an email, where a path alone is
  // not an address at all.
  assert.equal(
    blockAddress(ORIGIN, PAGE, BLOCK, 'Quartalsbericht'),
    `${ORIGIN}/p/${PAGE}/quartalsbericht#b-${BLOCK}`,
  );
});

test('and it carries no share token, wherever it was copied', () => {
  /*
   * The one rule this module exists for.
   *
   * `usePageLink()` puts the token in on purpose (ADR-0113): a visitor
   * navigating a shared document must keep their credential. But that URL is
   * built to be *followed*, and this one is built to be *stored* — and a token
   * stored in a page is handed to everybody the page is later shared with.
   *
   * So this is not a hook and takes no context: there is nothing for a token
   * to arrive through.
   */
  const source = codeOf(new URL('../src/routes/internalLinks.ts', import.meta.url));
  assert.doesNotMatch(source, /sharePage|useShareToken|ShareTokenContext/);
});

test('a page can be addressed without naming a block', () => {
  // "Link this page" is the other half of the request, and the same address
  // with the fragment left off.
  assert.equal(blockAddress(ORIGIN, PAGE, null, 'Quartalsbericht'), `${ORIGIN}/p/${PAGE}/quartalsbericht`);
});

test('following an internal link keeps the block it names', () => {
  /*
   * The first of the three faults. `useLinkInterception` navigated to
   * `pathname + search` and dropped the fragment — so an internal link landed
   * on the right page and never on the right block, which looks exactly like a
   * link that does not work.
   */
  assert.equal(
    internalTarget(`${ORIGIN}/p/${PAGE}/x#b-${BLOCK}`, ORIGIN, null),
    `/p/${PAGE}/x#b-${BLOCK}`,
  );
});

test('a link out of the instance is left to the browser', () => {
  assert.equal(internalTarget('https://example.org/p/x', ORIGIN, null), null);
});

test('a visitor keeps their credential when they follow one', () => {
  /*
   * The stored link says `/p/…` because that is what a document may contain.
   * A share visitor following it would land on a login wall — the failure
   * ADR-0113 was written about, arriving from the other direction.
   *
   * So the token is put back on at the moment of the click, from the address
   * bar rather than from the document. A member has no token and gets the
   * address unchanged.
   */
  assert.equal(
    internalTarget(`${ORIGIN}/p/${PAGE}#b-${BLOCK}`, ORIGIN, 'tok123'),
    `/s/tok123/p/${PAGE}#b-${BLOCK}`,
  );
});

test('and a link that already carries one is not given a second', () => {
  assert.equal(
    internalTarget(`${ORIGIN}/s/tok123/p/${PAGE}`, ORIGIN, 'tok123'),
    `/s/tok123/p/${PAGE}`,
  );
});

test('a link to something that is not a page is not rewritten for a visitor', () => {
  /*
   * `/settings`, `/search`, `/admin` — a share token means nothing there, and
   * prefixing one would invent a URL that does not exist. Only the page space
   * has two shapes.
   */
  assert.equal(internalTarget(`${ORIGIN}/search?q=x`, ORIGIN, 'tok123'), '/search?q=x');
});

test('the interception asks this module rather than deciding again', () => {
  // Two places deciding what an internal URL is would be two places to get the
  // share prefix wrong.
  const route = codeOf(new URL('../src/hooks/useRoute.ts', import.meta.url));
  assert.match(route, /internalTarget\(/);
  assert.doesNotMatch(route, /navigate\(url\.pathname \+ url\.search\)/);
});

test('arriving at a block re-runs when only the fragment changed', () => {
  /*
   * The second fault, and it was not new: following a second search result on
   * the same page has never scrolled, because the effect's dependency list is
   * the page and the page did not change.
   *
   * The comment above it even said so — *"following a second result from the
   * same search has to scroll again, and the hash is what changed"* — beside a
   * dependency list that cannot see the hash. **A comment describing behaviour
   * the dependency list does not produce.**
   */
  const page = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(page, /useLocationHash\(\)/);
  assert.match(page, /\}, \[pageId, hash\]\);/);
});

test('the hash is republished, because pushState tells nobody', () => {
  // `history.pushState` fires no event at all — not `hashchange`, not
  // `popstate`. So the one place that calls it says so, down the same kind of
  // named channel the editor and the panels already use.
  const route = codeOf(new URL('../src/hooks/useRoute.ts', import.meta.url));
  assert.match(route, /export const NAVIGATED_EVENT = 'sone:navigated';/);
  assert.match(route, /dispatchEvent\(new Event\(NAVIGATED_EVENT\)\)/);
  assert.match(route, /export function useLocationHash\(\)/);
});

test('the block menu offers the address of the block it is open on', () => {
  // Asked for in these words: *„dass man dazu bei einem vorhandenen Content
  // Element auf dem Anfasser einen Button hat mit «Interne URL kopieren»"*.
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /blockAddress\(/);
  assert.match(menu, /block\.copyLink/);
});

test('an internal link in the panel stays in this tab', () => {
  /*
   * Every row was `target="_blank"`, which is right for a link out and wrong
   * for a link home: opening the same application a second time in a new tab
   * loses the sync connection's warmth and, more to the point, is not what
   * clicking a link to your own document should do.
   */
  const panel = codeOf(new URL('../src/components/LinksPanel.tsx', import.meta.url));
  assert.match(panel, /isInternal\(/);
});
