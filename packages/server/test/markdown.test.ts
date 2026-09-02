/**
 * A page as Markdown (ADR-0044).
 *
 * The tests worth having here are about the decisions, not the syntax: what
 * happens to a block Markdown has no spelling for, and what happens to the
 * heading levels when the title already holds level one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileNameFor, pageToMarkdown, type ExportBlock } from '../src/export/markdown.js';

const block = (
  type: string,
  plainText = '',
  props: Record<string, unknown> = {},
  parentId: string | null = null,
  id = Math.random().toString(36).slice(2),
): ExportBlock => ({ id, parentId, type, plainText, props });

test('the title holds level one, so a heading is demoted', () => {
  // A document with two `#` headings has two titles as far as a reader is
  // concerned.
  const out = pageToMarkdown('Overview', [
    block('heading-1', 'First part'),
    block('paragraph', 'Some words.'),
  ]);
  assert.match(out, /^# Overview\n/);
  assert.match(out, /\n## First part\n/);
});

test('a list nests by its own depth, and numbering restarts', () => {
  const parent = block('bullet', 'Top', {}, null, 'a');
  const child = block('bullet', 'Under', {}, 'a', 'b');
  const out = pageToMarkdown('L', [parent, child]);
  assert.match(out, /- Top/);
  assert.match(out, /\n {2}- Under/);

  const numbered = pageToMarkdown('N', [
    block('numbered', 'One'),
    block('numbered', 'Two'),
    block('paragraph', 'Break'),
    block('numbered', 'One again'),
  ]);
  assert.match(numbered, /1\. One\n\n2\. Two/);
  assert.match(numbered, /Break\n\n1\. One again/, 'a paragraph ends the list');
});

test('a block Markdown cannot spell keeps its data in a fence', () => {
  // The two honest options are to lose it or to write it down in a form our own
  // importer can read back. Losing it is how an export becomes untrusted.
  const out = pageToMarkdown('P', [
    block('collection', '', { viewType: 'table', columns: ['Name'] }),
  ]);
  assert.match(out, /```sone-collection/);
  assert.match(out, /"viewType":"table"/);
  assert.match(out, /```$/m);
});

test('a picture points at the file beside it', () => {
  const out = pageToMarkdown('P', [block('image', '', { fileId: 'f-1', alt: 'A plan' })]);
  assert.equal(out.includes('![A plan](attachments/f-1)'), true);
});

test('a todo carries whether it is done', () => {
  const out = pageToMarkdown('P', [
    block('todo', 'Done thing', { checked: true }),
    block('todo', 'Not yet', {}),
  ]);
  assert.match(out, /- \[x\] Done thing/);
  assert.match(out, /- \[ \] Not yet/);
});

test('a file name keeps the words and loses only what breaks', () => {
  // An export is for reading: "Übersicht 2026.md" is a better file than
  // "ubersicht-2026.md".
  assert.equal(fileNameFor('Übersicht 2026', 'page'), 'Übersicht 2026');
  assert.equal(fileNameFor('Accounts / 2025', 'page'), 'Accounts 2025');
  assert.equal(fileNameFor('.hidden', 'page'), 'hidden');
  assert.equal(fileNameFor('', 'page-id'), 'page-id');
});

test('there is no trailing whitespace, and the file ends with one newline', () => {
  // So an export put under version control does not appear to have changed when
  // it has not.
  const out = pageToMarkdown('P', [block('paragraph', 'Words  ')]);
  assert.doesNotMatch(out, /[ \t]\n/);
  assert.match(out, /\n$/);
  assert.doesNotMatch(out, /\n\n$/);
});
