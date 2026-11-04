/**
 * Which addresses a link may hold (ADR-0157).
 *
 * The rule existed and was applied at one of the two doors. Somebody typing a
 * link went through `normaliseHref`, which refuses the schemes that execute;
 * somebody *pasting* HTML went through the schema's `parseDOM`, which took the
 * `href` exactly as it arrived.
 *
 * These run the real parser over real pasted markup, because the question is
 * not whether a function returns false — it is what ends up in the document.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';
import { DOMParser, DOMSerializer } from 'prosemirror-model';

import { isFollowable } from '../src/hrefs.js';
import { schema } from '../src/schema.js';

test('an address that executes is not an address', () => {
  assert.equal(isFollowable('javascript:alert(1)'), false);
  assert.equal(isFollowable('data:text/html,<script>'), false);
  assert.equal(isFollowable('vbscript:msgbox'), false);
  // The two shapes a filter written against the whole string gets wrong.
  assert.equal(isFollowable('  JavaScript:alert(1)'), false);
  assert.equal(isFollowable('JAVASCRIPT:alert(1)'), false);
});

test('URL-parser normalization cannot disguise an executing scheme', () => {
  for (const href of [
    'java\tscript:void(0)', 'java\nscript:void(0)', 'java\rscript:void(0)',
    '\u0000JaVaScRiPt:void(0)', 'da\tta:text/html,x', 'vb\nscript:msgbox',
  ]) {
    assert.equal(isFollowable(href), false, JSON.stringify(href));
  }
  assert.equal(isFollowable('https://['), false, 'malformed addresses are refused');
});

test('and everything anybody actually links to is', () => {
  assert.equal(isFollowable('https://example.org/x'), true);
  assert.equal(isFollowable('mailto:markus@example.org'), true);
  assert.equal(isFollowable('/p/abc/eine-seite'), true, 'relative, for a shared page');
  assert.equal(isFollowable('example.org'), true, 'no scheme at all');
  assert.equal(isFollowable('tel:+49301234'), true);
});

/** What a paste of this markup leaves in the document. */
function hrefsAfterPaste(html: string): (string | null)[] {
  const dom = new JSDOM('<!doctype html><body></body>');
  const globals = ['window', 'document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment'];
  const restore: Array<[string, unknown]> = [];
  for (const key of globals) {
    restore.push([key, (globalThis as Record<string, unknown>)[key]]);
    (globalThis as Record<string, unknown>)[key] = (
      dom.window as unknown as Record<string, unknown>
    )[key];
  }
  try {
    const holder = dom.window.document.createElement('div');
    holder.innerHTML = html;
    const node = DOMParser.fromSchema(schema).parse(holder);
    const found: (string | null)[] = [];
    node.descendants((child) => {
      for (const mark of child.marks) {
        if (mark.type.name === 'link') found.push(mark.attrs['href'] as string);
      }
      return true;
    });
    return found;
  } finally {
    for (const [key, value] of restore) (globalThis as Record<string, unknown>)[key] = value;
  }
}

test('a pasted link that executes keeps its words and loses its link', () => {
  /*
   * **The hole this round closes.** Measured before it was fixed: the href
   * arrived in the document exactly as written, and the editor rendered it as a
   * real anchor — so a page could carry a script somebody else had pasted, and
   * the moment links became followable it would have been one click away.
   *
   * A paste that loses its formatting is an annoyance. A paste that carries a
   * script is not.
   */
  assert.deepEqual(
    hrefsAfterPaste('<p><a href="javascript:alert(1)">klick mich</a></p>'),
    [],
    'no link mark at all',
  );
  assert.deepEqual(hrefsAfterPaste('<p><a href="data:text/html,x">daten</a></p>'), []);
});

test('HTML character references cannot smuggle an executable link through paste', () => {
  for (const separator of ['&#9;', '&#10;', '&#13;', '\t', '\n', '\r']) {
    assert.deepEqual(hrefsAfterPaste(`<p><a href="java${separator}script:void(0)">text</a></p>`), []);
  }
});

test('unsafe links already stored in a document render as text, including HTML export', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  try {
    for (const href of ['javascript:void(0)', 'java\tscript:void(0)', 'data:text/html,x']) {
      const node = schema.node('paragraph', null, [schema.text('keep these words', [schema.mark('link', { href })])]);
      const element = DOMSerializer.fromSchema(schema).serializeNode(node, { document: dom.window.document }) as HTMLElement;
      assert.equal(element.textContent, 'keep these words');
      assert.equal(element.querySelector('a[href]'), null, href);
    }
  } finally {
    dom.window.close();
  }
});

test('and the ordinary ones come through untouched', () => {
  assert.deepEqual(
    hrefsAfterPaste('<p><a href="https://example.org/x">echt</a></p>'),
    ['https://example.org/x'],
  );
});

test('the words survive the refusal', () => {
  // Dropping the text with the link would be losing what somebody pasted, over
  // an attribute they probably could not see.
  const dom = new JSDOM('<!doctype html><body></body>');
  const globals = ['window', 'document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment'];
  for (const key of globals) {
    (globalThis as Record<string, unknown>)[key] = (
      dom.window as unknown as Record<string, unknown>
    )[key];
  }
  const holder = dom.window.document.createElement('div');
  holder.innerHTML = '<p><a href="javascript:alert(1)">klick mich</a></p>';
  const node = DOMParser.fromSchema(schema).parse(holder);
  assert.match(node.textContent, /klick mich/);
});
