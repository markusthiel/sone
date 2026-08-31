/**
 * What a document refers to: its files, its images and its links.
 *
 * Read from the Yjs document rather than from a server index, so these tests
 * build real documents and read them back. The two things worth pinning down are
 * the ones a walk gets wrong: attributes that arrive with their original type
 * rather than as strings, and a link split into several runs by another mark.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import { readDocAssets } from '../src/hooks/useDocAssets.ts';
import { en } from '../src/i18n/messages.en.ts';
import { codeOf, stylesOf } from './helpers/source.ts';

/** A block element with an id and whatever attributes it carries. */
function block(
  type: string,
  id: string,
  attrs: Record<string, string | number> = {},
): Y.XmlElement {
  const element = new Y.XmlElement(type);
  element.setAttribute('id', id);
  for (const [key, value] of Object.entries(attrs)) {
    // Numbers are set as they arrive: y-prosemirror stores a ProseMirror
    // attribute with its original type, which is exactly the case a
    // `typeof value === 'string'` guard has silently dropped before.
    element.setAttribute(key, value as unknown as string);
  }
  return element;
}

function docWith(...children: Y.XmlElement[]): Y.Doc {
  const doc = new Y.Doc();
  doc.getXmlFragment('content').insert(0, children);
  return doc;
}

test('a file block is read with its name, kind and size', () => {
  const doc = docWith(
    block('file', 'b1', {
      fileId: 'f-1',
      filename: 'Rechnung.pdf',
      mimeType: 'application/pdf',
      category: 'pdf',
      sizeBytes: 20480,
    }),
  );

  assert.deepEqual(readDocAssets(doc).files, [
    {
      blockId: 'b1',
      fileId: 'f-1',
      filename: 'Rechnung.pdf',
      mimeType: 'application/pdf',
      category: 'pdf',
      sizeBytes: 20480,
    },
  ]);
});

test('a file still uploading is listed, without an id', () => {
  // A block that is visibly on the page and missing from the list reads as the
  // list being wrong rather than as the upload being unfinished.
  const doc = docWith(block('file', 'b1', { filename: 'big.zip', category: 'archive' }));
  const [file] = readDocAssets(doc).files;
  assert.equal(file?.fileId, null);
  assert.equal(file?.filename, 'big.zip');
  assert.equal(file?.sizeBytes, null);
});

test('an image is read with its URL, and one without a URL still appears', () => {
  const doc = docWith(
    block('image', 'b1', { url: 'https://example.org/a.png', alt: 'A chart' }),
    block('image', 'b2', { filename: 'pending.png' }),
  );
  const { images } = readDocAssets(doc);
  assert.deepEqual(images.map((image) => image.blockId), ['b1', 'b2']);
  assert.equal(images[0]?.alt, 'A chart');
  assert.equal(images[1]?.url, '');
  // Falls back to the name it was uploaded with, which is the only thing known
  // about it before the upload finishes.
  assert.equal(images[1]?.alt, 'pending.png');
});

test('a link is one entry even when its text is split by another mark', () => {
  // Half a link in bold arrives as several deltas. Listing it twice would say
  // there are two links where there is one.
  const doc = new Y.Doc();
  const paragraph = block('paragraph', 'p1');
  const textNode = new Y.XmlText();
  textNode.insert(0, 'See ');
  textNode.insert(4, 'the ', { link: { href: 'https://example.org/report' } });
  textNode.insert(8, 'report', {
    link: { href: 'https://example.org/report' },
    strong: {},
  });
  paragraph.insert(0, [textNode]);
  doc.getXmlFragment('content').insert(0, [paragraph]);

  assert.deepEqual(readDocAssets(doc).links, [
    { blockId: 'p1', href: 'https://example.org/report', text: 'the report' },
  ]);
});

test('two different destinations are two entries', () => {
  const doc = new Y.Doc();
  const paragraph = block('paragraph', 'p1');
  const textNode = new Y.XmlText();
  textNode.insert(0, 'one', { link: { href: 'https://a.example' } });
  // Cleared explicitly. A raw Yjs insert inherits the formatting to its left,
  // so without this the space between the two links is part of the first one —
  // in the editor that cannot happen, because the link mark is not inclusive.
  textNode.insert(3, ' and ', { link: null });
  textNode.insert(8, 'two', { link: { href: 'https://b.example' } });
  paragraph.insert(0, [textNode]);
  doc.getXmlFragment('content').insert(0, [paragraph]);

  assert.deepEqual(
    readDocAssets(doc).links.map((link) => [link.href, link.text]),
    [
      ['https://a.example', 'one'],
      ['https://b.example', 'two'],
    ],
  );
});

test('a link inside a nested block is attributed to that block', () => {
  // Otherwise jumping to it lands on the outer container, which on a long toggle
  // is not the same place.
  const doc = new Y.Doc();
  const toggle = block('toggle', 'outer');
  const inner = block('paragraph', 'inner');
  const textNode = new Y.XmlText();
  textNode.insert(0, 'deep', { link: { href: 'https://example.org' } });
  inner.insert(0, [textNode]);
  toggle.insert(0, [inner]);
  doc.getXmlFragment('content').insert(0, [toggle]);

  assert.deepEqual(readDocAssets(doc).links.map((link) => link.blockId), ['inner']);
});

test('text with no link produces nothing', () => {
  const doc = new Y.Doc();
  const paragraph = block('paragraph', 'p1');
  const textNode = new Y.XmlText();
  textNode.insert(0, 'plain words');
  paragraph.insert(0, [textNode]);
  doc.getXmlFragment('content').insert(0, [paragraph]);

  assert.deepEqual(readDocAssets(doc), { files: [], images: [], links: [] });
});

// --- the panel ---------------------------------------------------------------

const panel = codeOf(new URL('../src/components/RightSidebar.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('the tabs are icons, and every one still says its name', () => {
  // Seven words do not fit a 300px column. An icon-only control with no label is
  // a symbol somebody has to learn by pressing it, so the name is the accessible
  // label and the title, and the heading under the strip repeats it.
  assert.match(panel, /aria-label=\{label\}/);
  assert.match(panel, /title=\{label\}/);
  assert.match(panel, /className="right-panel-title">\{TABS\[tab\]\.label\}/);
  assert.match(css, /\.right-tab svg \{/);
});

test('every tab is listed and rendered', () => {
  // The failure the settings screen had, in a smaller place: a tab that renders
  // but is not in the list cannot be opened, and one in the list that renders
  // nothing is an empty panel.
  const listed = [...panel.matchAll(/^\s{2}'([a-z]+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(listed, [
    'outline',
    'tasks',
    'files',
    'images',
    'links',
    'people',
    'properties',
  ]);
  for (const name of listed) {
    assert.match(panel, new RegExp(`tab === '${name}'`), `${name} renders`);
    assert.match(panel, new RegExp(`${name}: \\{ label:`), `${name} has an icon and a name`);
  }
});

test('a list says what to do when it is empty', () => {
  // An empty panel on a page that has files would look like a fault, and an
  // empty one on a page that has none should say how to add one.
  // By key, since the panel is translated (ADR-0041) — and the English wording
  // is asserted in the catalogue rather than in the component, which is where it
  // now lives.
  for (const key of [
    'panel.openForFiles',
    'panel.noFiles',
    'panel.openForImages',
    'panel.noImages',
    'panel.openForLinks',
    'panel.noLinks',
  ]) {
    assert.match(panel, new RegExp(`t\\('${key.replace('.', '\\.')}'`));
    assert.ok(key in en, `${key} has a message`);
  }
});

test('the jump control is de-emphasised, never hidden', () => {
  // A control revealed by hover does not exist on a phone (ADR-0016).
  assert.match(css, /\.asset-jump \{[^}]*opacity: 0\.45/);
  assert.match(css, /@media \(hover: none\) \{\s*\.asset-jump \{ opacity: 0\.7; \}/);
});
