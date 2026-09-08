/**
 * Which pages a document points at (ADR-0174).
 *
 * The reading half of backlinks. *„Worauf zeigt diese Seite"* the links panel
 * has answered since ADR-0158, from the document in the browser. *„Wer zeigt
 * hierher"* cannot be answered that way at all: the pages that point here are
 * documents nobody has open.
 *
 * So the same arrangement mentions use — **read from the document, projected to
 * a row** — and the same reason: a link a client reports is a link a client can
 * forge, and the document is the only thing that actually knows.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import { BLOCK_ATTRS, linksIn, pageContent } from '../src/index.js';

const PAGE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BLOCK = '33333333-3333-4333-8333-333333333333';

/** A document with one paragraph holding one linked word. */
function withLink(href: string, blockId = 'b1'): Y.Doc {
  const doc = new Y.Doc();
  const content = pageContent(doc);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.setAttribute(BLOCK_ATTRS.id, blockId);
  const text = new Y.XmlText();
  text.insert(0, 'die Satzung', { link: { href } });
  paragraph.insert(0, [text]);
  content.insert(0, [paragraph]);
  return doc;
}

test('a relative link to a page is one', () => {
  assert.deepEqual(linksIn(withLink(`/p/${PAGE}`)), [
    { pageId: PAGE, blockId: 'b1', toBlockId: null },
  ]);
});

test('the decorative slug is ignored, as it is everywhere else', () => {
  // `parseRoute` never reads it back, so a page renamed after the link was
  // written still resolves — and so does its backlink.
  assert.deepEqual(linksIn(withLink(`/p/${PAGE}/die-satzung`)), [
    { pageId: PAGE, blockId: 'b1', toBlockId: null },
  ]);
});

test('an absolute address counts too, which is the one from the clipboard', () => {
  /*
   * The handle menu copies an absolute address on purpose — a bare path is not
   * something to paste into an email (ADR-0170) — and pasting it back into a
   * page is the *first* way anybody made an internal link here. A reader that
   * only understood relative ones would have missed the ordinary case.
   */
  assert.deepEqual(linksIn(withLink(`https://sone.example/p/${PAGE}`)), [
    { pageId: PAGE, blockId: 'b1', toBlockId: null },
  ]);
});

test('and one written through a share link', () => {
  // Nothing writes these any more (ADR-0170), and a document keeps whatever
  // ever reached it.
  assert.deepEqual(linksIn(withLink(`/s/tok123/p/${PAGE}`)), [
    { pageId: PAGE, blockId: 'b1', toBlockId: null },
  ]);
});

test('a link to a block names the block', () => {
  assert.deepEqual(linksIn(withLink(`/p/${PAGE}/satzung#b-${BLOCK}`)), [
    { pageId: PAGE, blockId: 'b1', toBlockId: BLOCK },
  ]);
});

test('a link out of the instance is not a backlink', () => {
  assert.deepEqual(linksIn(withLink('https://example.org/p/nothing')), []);
  assert.deepEqual(linksIn(withLink('https://example.org/satzung')), []);
});

test('and neither is an address that only looks like one', () => {
  /*
   * The uuid is what makes a page address a page address. Anything else in that
   * position is a path this application does not route, and reading it as an id
   * would be inventing a link.
   */
  assert.deepEqual(linksIn(withLink('/p/not-a-uuid')), []);
  assert.deepEqual(linksIn(withLink('/pages/x')), []);
});

test('the block the link sits in is reported, so the panel can point at it', () => {
  const doc = withLink(`/p/${PAGE}`, 'the-paragraph');
  assert.equal(linksIn(doc)[0]?.blockId, 'the-paragraph');
});

test('two links to the same page from one block are one row', () => {
  /*
   * Somebody who mentions a page twice in a sentence has referred to it once as
   * far as *„wer zeigt hierher"* is concerned. The same de-duplication mentions
   * make, for the same reason: one row per thing per block.
   */
  const doc = new Y.Doc();
  const content = pageContent(doc);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.setAttribute(BLOCK_ATTRS.id, 'b1');
  const first = new Y.XmlText();
  first.insert(0, 'die Satzung', { link: { href: `/p/${PAGE}` } });
  const second = new Y.XmlText();
  second.insert(0, 'und die Satzung', { link: { href: `/p/${PAGE}/anders` } });
  paragraph.insert(0, [first, second]);
  content.insert(0, [paragraph]);

  assert.equal(linksIn(doc).length, 1);
});

test('but the same page from two blocks is two', () => {
  const doc = new Y.Doc();
  const content = pageContent(doc);
  for (const id of ['b1', 'b2']) {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.setAttribute(BLOCK_ATTRS.id, id);
    const text = new Y.XmlText();
    text.insert(0, 'die Satzung', { link: { href: `/p/${PAGE}` } });
    paragraph.insert(0, [text]);
    content.insert(content.length, [paragraph]);
  }
  assert.deepEqual(
    linksIn(doc).map((one) => one.blockId),
    ['b1', 'b2'],
  );
});

test('two different pages from one block are two', () => {
  const doc = new Y.Doc();
  const content = pageContent(doc);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.setAttribute(BLOCK_ATTRS.id, 'b1');
  const first = new Y.XmlText();
  first.insert(0, 'eins', { link: { href: `/p/${PAGE}` } });
  const second = new Y.XmlText();
  second.insert(0, 'zwei', { link: { href: `/p/${OTHER}` } });
  paragraph.insert(0, [first, second]);
  content.insert(0, [paragraph]);

  assert.deepEqual(
    linksIn(doc).map((one) => one.pageId),
    [PAGE, OTHER],
  );
});

test('a link in a nested block belongs to that block, not its container', () => {
  const doc = new Y.Doc();
  const content = pageContent(doc);
  const toggle = new Y.XmlElement('toggle');
  toggle.setAttribute(BLOCK_ATTRS.id, 'outer');
  const inner = new Y.XmlElement('paragraph');
  inner.setAttribute(BLOCK_ATTRS.id, 'inner');
  const text = new Y.XmlText();
  text.insert(0, 'die Satzung', { link: { href: `/p/${PAGE}` } });
  inner.insert(0, [text]);
  toggle.insert(0, [inner]);
  content.insert(0, [toggle]);

  assert.deepEqual(linksIn(doc), [{ pageId: PAGE, blockId: 'inner', toBlockId: null }]);
});

test('a document with nothing in it says nothing', () => {
  assert.deepEqual(linksIn(new Y.Doc()), []);
});
