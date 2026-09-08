/**
 * Being taken to a block, and being shown which one (ADR-0166).
 *
 * Reported after living with the right sidebar:
 *
 * > Momentan scheint der Anker Mittig im Bildschirm zu sitzen.
 * > Gewohnheitsmäßig habe ich aber direkt ganz oben am Bildschirmrand gesucht.
 * > … Entweder wird der Inhalt kurz hervorgehoben … oder die Seite sollte an
 * > die entsprechende Stelle scrollen so dass sie oben auf der Seite liegt.
 *
 * Both, and they are not two answers to one question: the scroll decides where
 * to look, and the flash says *this one* — which is the half that still works
 * when the scroll cannot reach the top, near the end of a document.
 */

import assert from 'node:assert/strict';
import { after, before, describe, mock, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { stylesOf } from './helpers/source.ts';

let dom: JSDOM;

describe('taking somebody to a block', () => {
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    for (const key of ['window', 'document', 'CSS', 'HTMLElement', 'Element'] as const) {
      const value = (dom.window as unknown as Record<string, unknown>)[key];
      if (value === undefined) continue;
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  });

  after(() => {
    dom.window.close();
  });

  /** A block in the document, with a stubbed scroll that records its options. */
  function blockNamed(id: string): {
    element: HTMLElement;
    calls: ScrollIntoViewOptions[];
  } {
    dom.window.document.body.innerHTML = '';
    const element = dom.window.document.createElement('p');
    element.setAttribute('data-block-id', id);
    const calls: ScrollIntoViewOptions[] = [];
    (element as unknown as { scrollIntoView: unknown }).scrollIntoView = (
      options: ScrollIntoViewOptions,
    ) => {
      calls.push(options);
    };
    dom.window.document.body.append(element);
    return { element: element as unknown as HTMLElement, calls };
  }

  test('it scrolls to the top, not to the middle', async () => {
    /*
     * The old comment gave a reason and the reason was backwards: *„a heading
     * pinned to the very top of the viewport hides the paragraph that follows
     * it"*. A heading at the top has everything that follows it **below** it,
     * which is what somebody who pressed a heading wants to read. Centring is
     * what shows the paragraph *before* it — the one they did not ask for.
     */
    const { scrollToBlock } = await import('../src/hooks/useOutline.ts');
    const { calls } = blockNamed('b1');

    assert.equal(scrollToBlock('b1'), true);
    assert.deepEqual(calls, [{ behavior: 'smooth', block: 'start' }]);
  });

  test('and it says which block, for as long as that is useful', async () => {
    // The half that still works when the scroll cannot reach the top: the last
    // paragraph of a document cannot be put at the top, and arriving *near*
    // something is not the same as being shown it.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { scrollToBlock } = await import('../src/hooks/useOutline.ts');
      const { FOUND_MS } = await import('../src/lib/found.ts');
      const { element } = blockNamed('b2');

      scrollToBlock('b2');
      assert.equal(element.dataset['found'], '', 'lit on arrival');

      mock.timers.tick(FOUND_MS + 10);
      assert.equal(element.dataset['found'], undefined, 'and it stops being lit');
    } finally {
      mock.timers.reset();
    }
  });

  test('a second jump lights the second block, not both', async () => {
    // A block that stayed lit would make the *next* jump look like nothing
    // happened — the sentence ADR-0156 wrote about the PDF marks, one floor up.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { scrollToBlock } = await import('../src/hooks/useOutline.ts');
      dom.window.document.body.innerHTML = '';
      const first = blockNamed('c1').element;
      const second = dom.window.document.createElement('p');
      second.setAttribute('data-block-id', 'c2');
      (second as unknown as { scrollIntoView: unknown }).scrollIntoView = () => undefined;
      dom.window.document.body.append(second);

      scrollToBlock('c1');
      scrollToBlock('c2');

      assert.equal(first.dataset['found'], undefined, 'the first one let go');
      assert.equal(second.dataset['found'], '', 'and the second is the one');
    } finally {
      mock.timers.reset();
    }
  });

  test('a block that is not there is reported, not thrown about', async () => {
    const { scrollToBlock } = await import('../src/hooks/useOutline.ts');
    dom.window.document.body.innerHTML = '';
    assert.equal(scrollToBlock('nowhere'), false);
  });
});

describe('what the stylesheet does with it', () => {
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));

  test('the top is under the bar, not under the page edge', () => {
    /*
     * `block: 'start'` puts the block at the top of the scrolling box, and the
     * bar is sticky over the first 52 pixels of it — so without this the thing
     * somebody asked to see arrives underneath the thing they asked from.
     */
    assert.match(
      css,
      /\[data-block-id\] \{[^}]*scroll-margin-block-start: calc\(var\(--topbar-block-size\) \+ /s,
    );
  });

  test('the ring holds and only the pulse is motion', () => {
    // ADR-0156's rule, applied to a block: which one you were taken to is
    // information, and this stylesheet switches decoration off for somebody who
    // asked for less motion — not information.
    assert.match(css, /\[data-block-id\]\[data-found\] \{[^}]*outline: 2px solid var\(--accent-line\)/s);
    assert.match(
      css,
      // Bounded rather than `[^}]*`: the rule sits after the PDF mark's own
      // `animation: none`, so a pattern that cannot cross a closing brace
      // cannot reach it — which is how this assertion first failed against a
      // stylesheet that said exactly the right thing.
      /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,4000}?\[data-block-id\]\[data-found\] \{ animation: none; \}/,
    );
  });

  test('and it is the same flash the PDF marks use, not a second one', () => {
    // One keyframe animation named once. Two would be two things to keep in
    // step, and they would drift the first time one of them was tuned.
    assert.equal((css.match(/@keyframes sone-found/g) ?? []).length, 1);
    assert.match(css, /\[data-block-id\]\[data-found\] \{[^}]*animation: sone-found/s);
  });
});

describe('how long a found thing stays lit', () => {
  test('is one number, in one place', async () => {
    // It was a local constant in the PDF viewer. A second copy here would be
    // two answers to "how long is a moment".
    const { codeOf } = await import('./helpers/source.ts');
    const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));
    assert.doesNotMatch(viewer, /const FOUND_MS =/);
    assert.match(viewer, /import \{ FOUND_MS \} from '\.\.\/lib\/found\.ts';/);
  });
});
