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
import { bodyWithoutTitle, entryFrom, titleFrom } from '../src/import/plan.js';
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

test('a toned callout and a sourced quote survive the round trip (ADR-0188)', () => {
  const original: ExportBlock[] = [
    block('callout', 'Mind the gap', { tone: 'warning' }),
    block('callout', 'Just a note'),
    block('quote', 'Less is more', { source: 'Somebody, 1999' }),
    block('quote', 'No source here'),
  ];

  const markdown = pageToMarkdown('The page', original);
  assert.match(markdown, /> \*\*Warning\*\*\n>\n> Mind the gap/);
  assert.match(markdown, /> Less is more\n>\n> — Somebody, 1999/);

  const read = markdownToBlocks(bodyWithoutTitle(markdown));
  assert.deepEqual(
    read.map((one) => [one.type, one.text, one.props]),
    [
      ['callout', 'Mind the gap', { tone: 'warning' }],
      ['callout', 'Just a note', {}],
      ['quote', 'Less is more', { source: 'Somebody, 1999' }],
      ['quote', 'No source here', {}],
    ],
  );
});

test('a bold first line that is not a tone stays a quote', () => {
  const read = markdownToBlocks('> **Chapter one**\n>\n> It was a dark night.');
  assert.equal(read[0]?.type, 'quote');
  assert.equal(read[0]?.text, '**Chapter one**\n\nIt was a dark night.');
});

test('a divider keeps its line, symbol and place, and *** is an asterism (ADR-0189)', () => {
  const original: ExportBlock[] = [
    block('divider'),
    block('divider', '', { rule: 'dashed', ornament: 'leaf', ornamentAt: 'start' }),
  ];
  const markdown = pageToMarkdown('The page', original);
  assert.match(markdown, /---\n<!-- sone-divider \{"rule":"dashed","ornament":"leaf","ornamentAt":"start"\} -->/);
  assert.equal((markdown.match(/^---$/gm) ?? []).length, 2, 'both are still a rule for any reader');

  const read = markdownToBlocks(bodyWithoutTitle(markdown));
  assert.deepEqual(
    read.map((one) => [one.type, one.props]),
    [
      ['divider', {}],
      ['divider', { rule: 'dashed', ornament: 'leaf', ornamentAt: 'start' }],
    ],
  );
  assert.deepEqual(markdownToBlocks('***')[0]?.props, { ornament: 'asterism' });
});

test('an entry keeps its symbol and colours in a comment under the title (ADR-0190)', () => {
  const icon = { kind: 'icon', value: 'rocket', color: 'blue', titleColor: '#aa1122' };
  const markdown = pageToMarkdown('Projekte', [block('paragraph', 'Words')], { icon });
  assert.match(markdown, /^# Projekte\n\n<!-- sone-entry \{"icon":/m);
  assert.equal(titleFrom(markdown, 'x'), 'Projekte');
  assert.deepEqual(entryFrom(markdown), { icon });
  assert.equal(bodyWithoutTitle(markdown).includes('sone-entry'), false, 'the comment is not body text');
  assert.deepEqual(markdownToBlocks(bodyWithoutTitle(markdown)).map((one) => one.text), ['Words']);

  const plain = pageToMarkdown('Plain', [block('paragraph', 'Words')], { icon: null });
  assert.equal(plain.includes('sone-entry'), false, 'the default look says nothing');
  assert.equal(entryFrom(plain), null);
});
