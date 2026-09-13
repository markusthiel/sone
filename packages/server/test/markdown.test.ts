/**
 * A page as Markdown (ADR-0044).
 *
 * The tests worth having here are about the decisions, not the syntax: what
 * happens to a block Markdown has no spelling for, and what happens to the
 * heading levels when the title already holds level one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INDENTABLE_BLOCK_TYPES } from '@sone/core';

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
  // concerned. And the type is `heading` with a level — I wrote this switch and
  // these tests against `heading-1`, which does not exist, so every heading
  // exported as a paragraph and the tests agreed with the bug.
  const out = pageToMarkdown('Overview', [
    block('heading', 'First part', { level: 1 }),
    block('heading', 'Deeper', { level: 2 }),
    block('paragraph', 'Some words.'),
  ]);
  assert.match(out, /^# Overview\n/);
  assert.match(out, /\n## First part\n/);
  assert.match(out, /\n### Deeper\n/);
});

test('a list nests by its own depth, and numbering restarts', () => {
  const parent = block('bulletList', 'Top', {}, null, 'a');
  const child = block('bulletList', 'Under', {}, 'a', 'b');
  const out = pageToMarkdown('L', [parent, child]);
  assert.match(out, /- Top/);
  assert.match(out, /\n {2}- Under/);

  const numbered = pageToMarkdown('N', [
    block('numberedList', 'One'),
    block('numberedList', 'Two'),
    block('paragraph', 'Break'),
    block('numberedList', 'One again'),
  ]);
  assert.match(numbered, /1\. One\n\n2\. Two/);
  assert.match(numbered, /Break\n\n1\. One again/, 'a paragraph ends the list');
});

test('a block Markdown cannot spell keeps its data in a fence', () => {
  // The two honest options are to lose it or to write it down in a form our own
  // importer can read back. Losing it is how an export becomes untrusted.
  const out = pageToMarkdown('P', [
    block('collectionView', '', { viewType: 'table', columns: ['Name'] }),
  ]);
  assert.match(out, /```sone-collectionView/);
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

test('every text block core knows about has a spelling, not a fence', () => {
  // The test that would have caught the invented names: it iterates core's own
  // set of indentable text blocks rather than a list I typed here. A type this
  // writer does not handle falls through to a fenced block — correct for a
  // table or an embed, and wrong for a heading.
  const spelled = [...INDENTABLE_BLOCK_TYPES].filter(
    (type) => type !== 'collectionView' && type !== 'image' && type !== 'soteTasks',
  );
  for (const type of spelled) {
    const out = pageToMarkdown('P', [block(type, 'Words', { level: 1 })]);
    assert.doesNotMatch(out, /```sone-/, `${type} has a Markdown spelling`);
  }

  // Embedded collections and SOTE tasks have no Markdown spelling, and an
  // image has one but is a link rather than text.
  assert.match(pageToMarkdown('P', [block('collectionView', '')]), /```sone-collectionView/);
});

test('an embedded SOTE task exports its reference without fetching private task details', () => {
  const reference = { serverId: 'server-1', projectId: 'project-1', taskId: 'task-1', mode: 'single' };
  const out = pageToMarkdown('P', [block('soteTasks', '', reference)]);
  assert.match(out, /```sone-soteTasks/);
  assert.match(out, /"taskId":"task-1"/);
  assert.match(out, /"projectId":"project-1"/);
  assert.match(out, /"serverId":"server-1"/);
  assert.match(out, /"mode":"single"/);
});
