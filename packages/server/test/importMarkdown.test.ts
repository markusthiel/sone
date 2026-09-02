/**
 * Markdown back into blocks (ADR-0044).
 *
 * The round trip is the test that matters: what our own export writes has to
 * come back as the blocks it came from. The rest are about the limits being the
 * ones I chose rather than accidents.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageToMarkdown, type ExportBlock } from '../src/export/markdown.js';
import { bodyWithoutTitle } from '../src/import/plan.js';
import { markdownToBlocks } from '../src/import/markdown.js';

const block = (
  type: string,
  plainText = '',
  props: Record<string, unknown> = {},
  parentId: string | null = null,
  id = Math.random().toString(36).slice(2),
): ExportBlock => ({ id, parentId, type, plainText, props });

test('what the export writes comes back as the blocks it came from', () => {
  const original: ExportBlock[] = [
    block('paragraph', 'A first paragraph.'),
    block('heading', 'A heading', { level: 1 }),
    block('heading', 'Deeper', { level: 2 }),
    block('bulletList', 'One'),
    block('bulletList', 'Two'),
    block('numberedList', 'First'),
    block('todo', 'Done', { checked: true }),
    block('todo', 'Open', {}),
    block('quote', 'Somebody said this.'),
    block('code', 'const x = 1;', { language: 'ts' }),
    block('divider'),
  ];

  const markdown = pageToMarkdown('The page', original);
  const read = markdownToBlocks(bodyWithoutTitle(markdown));

  assert.deepEqual(
    read.map((one) => [one.type, one.text]),
    original.map((one) => [one.type, one.plainText]),
  );
  // The properties that decide how a block reads, not merely its type.
  assert.deepEqual(read[1]?.props, { level: 1 });
  assert.deepEqual(read[2]?.props, { level: 2 });
  assert.equal(read[6]?.props['checked'], true);
  assert.equal(read[7]?.props['checked'], false);
  assert.deepEqual(read[9]?.props, { language: 'ts' });
});

test('a block Markdown cannot spell survives its fence', () => {
  // The path that makes a collection survive an export and an import — and the
  // reason the export writes data into a fence at all.
  const markdown = pageToMarkdown('P', [
    block('collectionView', '', { viewType: 'board', columns: ['Name', 'State'] }),
  ]);
  const read = markdownToBlocks(bodyWithoutTitle(markdown));
  assert.equal(read[0]?.type, 'collectionView');
  assert.deepEqual(read[0]?.props, { viewType: 'board', columns: ['Name', 'State'] });
});

test('a fence whose data cannot be read keeps its text as a paragraph', () => {
  // Something is better than a hole where a table was, and a hole is what a
  // stricter reader would leave.
  const read = markdownToBlocks('```sone-collectionView\n{not json\n```\n');
  assert.equal(read[0]?.type, 'paragraph');
  assert.match(read[0]?.text ?? '', /not json/);
});

test('a nested list keeps its depth', () => {
  const read = markdownToBlocks('- Top\n  - Under\n    - Deeper\n');
  assert.deepEqual(
    read.map((one) => [one.text, one.indent]),
    [
      ['Top', 0],
      ['Under', 1],
      ['Deeper', 2],
    ],
  );
});

test('inline marks are not parsed, and the words are all there', () => {
  // The honest limit of this pass: marks live in a Yjs text's formatting, and
  // applying them means a second parser and decisions about overlapping ranges.
  // Better a page whose words are all present than one where half of them
  // vanished into a mark I got wrong.
  const read = markdownToBlocks('This is **bold** and this is *not*.\n');
  assert.equal(read[0]?.type, 'paragraph');
  assert.equal(read[0]?.text, 'This is **bold** and this is *not*.');
});

test('an unterminated fence takes the rest rather than refusing the file', () => {
  const read = markdownToBlocks('```ts\nconst x = 1;\n');
  assert.equal(read[0]?.type, 'code');
  assert.equal(read[0]?.text, 'const x = 1;');
});
