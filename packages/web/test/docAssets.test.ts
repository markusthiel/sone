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
      // How the block draws it (ADR-0159). Absent means a card, which is what
      // a file block was before it could be anything else — and the difference
      // matters to a comment about a place inside the document, which has
      // nowhere to point when the pages are not on the page.
      display: 'card',
    },
  ]);
});

test('and with how it is drawn, because a card shows no pages', () => {
  const doc = docWith(block('file', 'b1', { fileId: 'f-1', display: 'full' }));
  assert.equal(readDocAssets(doc).files[0]?.display, 'full');
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

// Two files since ADR-0158: the links panel moved into its own, and the empty
// wordings it owns moved with it. Read as one text, because what these tests
// hold is that the panel *somewhere* says these things — not which file the
// sentence is written in.
const panel =
  codeOf(new URL('../src/components/RightSidebar.tsx', import.meta.url)) +
  codeOf(new URL('../src/components/LinksPanel.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('the tabs are icons, and every one still says its name', () => {
  // Seven words do not fit a 300px column. An icon-only control with no label is
  // a symbol somebody has to learn by pressing it, so the name is the accessible
  // label and the title, and the heading under the strip repeats it.
  assert.match(panel, /aria-label=\{t\(label\)\}/);
  assert.match(panel, /title=\{t\(label\)\}/);
  assert.match(panel, /className="right-panel-title">\{t\(TABS\[tab\]\.label\)\}/);
  assert.match(css, /\.right-tab svg \{/);
});

/** The entries of one `as const` array in the panel's source. */
function arrayNamed(name: string): string[] {
  const from = panel.indexOf(`const ${name} = [`);
  assert.notEqual(from, -1, `${name} exists`);
  const to = panel.indexOf('] as const', from);
  return [...panel.slice(from, to).matchAll(/^\s{2}'([a-z]+)',$/gm)].map((m) => m[1]!);
}

test('every tab is listed and rendered', () => {
  // The failure the settings screen had, in a smaller place: a tab that renders
  // but is not in the list cannot be opened, and one in the list that renders
  // nothing is an empty panel.
  //
  // Read from RIGHT_TABS by name rather than by scraping every two-space quoted
  // line in the file: there is a second such array now (PAGE_TABS), and the
  // scrape swallowed it whole the moment it appeared.
  const listed = arrayNamed('RIGHT_TABS');
  assert.deepEqual(listed, [
    'outline',
    'tasks',
    'files',
    'images',
    'links',
    'comments',
    'history',
    'people',
    'properties',
  ]);
  for (const name of listed) {
    assert.match(panel, new RegExp(`tab === '${name}'`), `${name} renders`);
    assert.match(panel, new RegExp(`${name}: \\{ label:`), `${name} has an icon and a name`);
  }
});

test('the tabs a shared link gets are about the page, and are real tabs', () => {
  /*
   * `PAGE_TABS` is what a link's visitor sees, and the division is the whole
   * reason there is no "show the right sidebar" option on a share: four tabs
   * describe the document, and the rest describe the workspace — the version
   * history names every author, the contributors list names colleagues, tasks
   * name their assignees, comments are the discussion among them.
   *
   * Two ways this could rot. A tab could be added to `PAGE_TABS` that is not a
   * tab at all, and the strip would draw a button that selects nothing. Or one
   * of the workspace tabs could drift in — which would be a disclosure, and a
   * quiet one, because the panel would look exactly the same.
   */
  const shared = arrayNamed('PAGE_TABS');
  assert.deepEqual(shared, ['outline', 'files', 'images', 'links']);

  const all = arrayNamed('RIGHT_TABS');
  for (const name of shared) {
    assert.ok(all.includes(name), `${name} is a tab the panel has`);
  }
  for (const withheld of ['history', 'people', 'tasks', 'comments', 'properties']) {
    assert.ok(!shared.includes(withheld), `${withheld} stays out of a shared link`);
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

test('a picture shown as a card or a line is still one of the page\'s pictures', () => {
  /*
   * Reported as: *„Außerdem erscheint es nicht in der Seitenleiste. Zumindest
   * wenn ich es als Karte oder Zeile einbinde. Wenn ich es als richtiges Bild
   * einbinde sehe ich es auch in der Leiste."* (ADR-0193)
   *
   * Choosing "card" or "line" for an image converts the block: an image is a
   * file with a special way of being looked at, and the three layouts are the
   * file block's. This read the block's *type* where the question is what the
   * page is carrying — the same reasoning that already put a board's pictures
   * in the list.
   */
  const doc = docWith(
    block('file', 'b1', {
      fileId: 'f-1',
      filename: 'Neckar.jpg',
      mimeType: 'image/jpeg',
      category: 'image',
      sizeBytes: 480000,
      display: 'card',
    }),
    block('file', 'b2', {
      fileId: 'f-2',
      filename: 'Rechnung.pdf',
      mimeType: 'application/pdf',
      category: 'pdf',
      display: 'line',
    }),
  );

  const { images, files } = readDocAssets(doc);

  // In both lists, because it is both: a file on the page and a picture in it.
  assert.deepEqual(files.map((file) => file.blockId), ['b1', 'b2']);
  assert.deepEqual(images, [
    { blockId: 'b1', asFile: true, url: '/api/files/f-1', alt: 'Neckar.jpg' },
  ]);
});

test('a picture still uploading as a file is not offered as a thumbnail', () => {
  // No id yet means no address, and a thumbnail pointing at /api/files/null is
  // a broken image where the panel promises a picture. The row is in the files
  // list all the same, which is where "it is uploading" is already said.
  const doc = docWith(
    block('file', 'b1', { filename: 'Neckar.jpg', mimeType: 'image/jpeg', category: 'image' }),
  );

  assert.deepEqual(readDocAssets(doc).images, []);
  assert.equal(readDocAssets(doc).files.length, 1);
});

test('the panel opens such a picture rather than pretending to scroll to it', () => {
  // There is a block to jump to, but nothing to look at once you are there —
  // the page holds a card naming the file. So this row opens it (ADR-0193).
  assert.match(panel, /if \(image\.asFile\) \{/);
  assert.match(panel, /openMediaModal\(\{/);
  for (const key of ['media.close', 'media.download']) {
    assert.ok(key in en, `${key} has a message`);
  }
});

test('an uploaded video is one of the page\'s files', () => {
  /*
   * Reported as: *„Unter Dateien in der Seitenleiste müsste doch auch das Video
   * erscheinen oder?"* — yes. A video is its own block (ADR-0037), so the walk
   * never looked at it; it is still an upload sitting in the page, served from
   * the same place, and usually the largest thing the page carries.
   */
  const doc = docWith(
    block('video', 'b1', { source: 'file', fileId: 'f-9', title: 'Kugelwand.mp4', display: 'card' }),
    block('video', 'b2', { source: 'embed', url: 'https://www.youtube.com/watch?v=abc' }),
    block('video', 'b3', { source: 'stream', url: 'https://example.org/live.m3u8' }),
  );

  // Only the upload. An embed is somebody else's address and a stream is a
  // manifest — offering a download for either would promise a file that is not
  // here.
  assert.deepEqual(
    readDocAssets(doc).files.map((file) => [file.blockId, file.filename, file.category]),
    [['b1', 'Kugelwand.mp4', 'video']],
  );

  // Never 'full': that is what the comments panel looks for when it asks which
  // documents have places inside them to point at.
  assert.equal(readDocAssets(doc).files[0]?.display, 'card');
});

test('a card is a link with nothing around it, so it carries no underline', () => {
  // Reported as *„die Links in den Karten nicht unterstrichen … das sieht sonst
  // mit dem Player Icon nicht gut aus"*. `.ProseMirror a` underlines a link in a
  // sentence, which is right; a tile that responds as a whole and lifts on hover
  // is not one (ADR-0193).
  assert.match(css, /\.ProseMirror \.file-name,[\s\S]*?\.video-line:hover \{\s*text-decoration: none;/);
});
