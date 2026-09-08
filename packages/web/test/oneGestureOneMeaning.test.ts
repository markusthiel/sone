/**
 * A click on a link means one thing (ADR-0171).
 *
 * Reported the moment internal links existed:
 *
 * > Man landet aber direkt beim klicken auf den link am verlinkten inhalt. Bei
 * > normalen externen Links muss man gezielt erst drauf klicken und dann auf
 * > Link öffnen gehen. Gewollt? Könnte sogar sinnvoll sein.
 *
 * Not intended. In editable text a plain click on an external link puts the
 * caret in the word — that is ADR-0157, and the reason is that a link nobody
 * can correct is worse than one nobody can follow. Nothing about that reasoning
 * mentions where the link points.
 *
 * The application's own click interception was answering first, so the same
 * gesture did two different things depending on which host the address named —
 * and the words of an internal link could not be edited at all, because
 * clicking into them left the page.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { codeOf } from './helpers/source.ts';
import { answersClick, internalTarget } from '../src/routes/internalLinks.ts';

const ORIGIN = 'https://sone.example';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
});
after(() => dom.window.close());

/** An anchor inside a wrapper carrying whatever `contenteditable` is given. */
function anchorIn(editable: string | null): Element {
  const doc = dom.window.document;
  const wrap = doc.createElement('div');
  if (editable !== null) wrap.setAttribute('contenteditable', editable);
  const anchor = doc.createElement('a');
  anchor.setAttribute('href', '/p/x');
  // Inside an `<em>`, because a click lands on whatever formatting the words
  // carry rather than on the anchor itself — the lesson from ADR-0168.
  const em = doc.createElement('em');
  em.appendChild(anchor);
  wrap.appendChild(em);
  doc.body.appendChild(wrap);
  return anchor;
}

test('a click in text somebody is writing belongs to the editor', () => {
  /*
   * The whole fix, in one line of the interception.
   *
   * Editable text already has a rule for this click and it is the right one:
   * the caret goes in, and the card over it offers *open*. The application
   * standing down is what lets that rule apply to every link rather than only
   * to the ones pointing elsewhere.
   */
  assert.equal(answersClick(anchorIn('true')), false);
});

test('and a click in a document somebody is reading does not', () => {
  // A read-only view — a share link, a past version, a locked page — draws
  // `contenteditable="false"`. There is nothing to put a caret in, so following
  // the link is the only thing a click can mean.
  assert.equal(answersClick(anchorIn('false')), true);
  assert.equal(answersClick(anchorIn(null)), true);
});

test('following one still happens in this window', () => {
  // Unchanged from ADR-0170, and the reason this is worth keeping green: the
  // fix above must not turn an internal link back into a new tab.
  assert.equal(internalTarget(`${ORIGIN}/p/abc#b-1`, ORIGIN, null), '/p/abc#b-1');
});

test('the interception asks rather than deciding again', () => {
  const route = codeOf(new URL('../src/hooks/useRoute.ts', import.meta.url));
  assert.match(route, /answersClick\(anchor\)/);
});

test('the card opens an internal link here and an external one over there', () => {
  /*
   * *Öffnen* on the link card called `openLink`, which is `window.open(…,
   * '_blank')` — so following a link home from the card opened a second copy of
   * the application. The same fault ADR-0170 fixed in the links panel, in the
   * other place that follows a link.
   *
   * An anchor rather than a button, so the application's own interception
   * answers it exactly as it answers a link in the text, and the browser's
   * `rel` carries the `noopener` guarantee `openLink` was there to give.
   */
  const toolbar = codeOf(new URL('../src/components/SelectionToolbar.tsx', import.meta.url));
  assert.match(toolbar, /className="toolbar-button"\s*\n\s*href=\{existingLink\.href\}/);
  assert.match(toolbar, /rel: 'noopener noreferrer'/);
  // And an address that executes is still not offered as something to click.
  assert.match(toolbar, /isFollowable\(existingLink\.href\)/);
});

test('one definition of what counts as ours', () => {
  /*
   * `isSameOrigin` lives in the editor's `hrefs.ts`, beside `isFollowable`,
   * because both the editor and the application have to agree about it and a
   * rule written in two packages is a rule that gets updated in one.
   */
  const hrefs = codeOf(new URL('../../editor/src/hrefs.ts', import.meta.url));
  assert.match(hrefs, /export function isSameOrigin\(/);
  const links = codeOf(new URL('../src/routes/internalLinks.ts', import.meta.url));
  assert.match(links, /import \{ isSameOrigin \} from '@sone\/editor'/);
});
