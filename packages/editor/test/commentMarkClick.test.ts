/**
 * Clicking a comment mark in the writing (ADR-0168).
 *
 * Asked for as the other direction of what the panel already does:
 *
 * > wenn man bei einem kommentar im Content eingestellt hat dass er farbig
 * > hinterlegt ist, ist der grundsetzlich anklickbar. Kann man es so bauen dass
 * > wenn ich drauf klicke, dass dann die Seitenleiste rechts sich öffnet und
 * > automatisch auf die Kommentare springt und den gewählten kommentar
 * > hervorhebt?
 *
 * The mark already carries `data-thread` — ADR-0046 put it there so the panel
 * and the text agree on which thread is which. So the editor's half is small,
 * and every decision in it is about the click: which element counts, what is
 * read off it, and what the click is still allowed to do afterwards.
 *
 * Driven through the plugin's own handler with real elements rather than a
 * mounted editor: what is being decided is `closest()` against a DOM tree, and
 * the tree is the whole input. Whether the mark is *drawn* is
 * `commentAnchors`' own business and has its own tests.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let commentMarks: typeof import('../src/commentAnchors.js').commentMarks;

describe('a click on a comment mark', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>');
    for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement'] as const) {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
    commentMarks = (await import('../src/commentAnchors.js')).commentMarks;
  });

  after(() => dom?.window.close());

  /** The plugin's click handler, and what it reported. */
  function handler(): {
    click: (target: Element) => boolean;
    opened: string[];
  } {
    const opened: string[] = [];
    const plugin = commentMarks(
      () => [],
      () => 'highlight',
      (threadId) => opened.push(threadId),
    );
    const onClick = plugin.props.handleDOMEvents?.click;
    assert.ok(onClick, 'the plugin answers a click');
    return {
      // `.call(plugin, …)`: ProseMirror types a DOM handler as a method on the
      // plugin, so calling it detached loses `this` — which the type checker
      // says and the runtime would not.
      click: (target: Element) =>
        onClick.call(plugin, {} as never, { target } as unknown as PointerEvent) === true,
      opened,
    };
  }

  /** A paragraph with a marked phrase inside it, and a plain one beside it. */
  function writing(): { marked: Element; word: Element; plain: Element } {
    dom.window.document.body.innerHTML = `
      <p><span class="sone-commented sone-commented-highlight" data-thread="t-1"
         >die <em id="word">Satzung</em></span> steht fest</p>
      <p id="plain">Nichts markiert</p>`;
    return {
      marked: dom.window.document.querySelector('[data-thread]')!,
      word: dom.window.document.querySelector('#word')!,
      plain: dom.window.document.querySelector('#plain')!,
    };
  }

  test('it reports the thread the words belong to', () => {
    const { click, opened } = handler();
    click(writing().marked);
    assert.deepEqual(opened, ['t-1']);
  });

  test('and it finds the mark from whatever inside it was clicked', () => {
    // A mark wraps words, and words carry their own formatting: the click lands
    // on the `<em>`, not on the span the decoration made.
    const { click, opened } = handler();
    click(writing().word);
    assert.deepEqual(opened, ['t-1']);
  });

  test('plain writing reports nothing', () => {
    const { click, opened } = handler();
    click(writing().plain);
    assert.deepEqual(opened, []);
  });

  test('the click is left alone, so the caret still lands where it was aimed', () => {
    /*
     * Opening a panel is not a reason to take a click away from the text. The
     * words under a comment mark are ordinary writing — somebody clicking them
     * is usually about to type — and this is the difference from a link, where
     * following it *instead of* placing the caret is the point (ADR-0157).
     */
    const { click } = handler();
    assert.equal(click(writing().marked), false, 'not consumed');
  });

  test('a viewer with no interest in threads is not made to have one', () => {
    // The callback is optional: a read-only render that offers no panel passes
    // nothing, and then there is no handler to run at all.
    const plugin = commentMarks(
      () => [],
      () => 'highlight',
    );
    assert.equal(plugin.props.handleDOMEvents?.click, undefined);
  });
});
