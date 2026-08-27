/**
 * Markdown paste.
 *
 * Text copied from anywhere that writes markdown arrived as literal characters:
 * `## Heading` stayed a paragraph reading "## Heading", and a list of `- item`
 * lines became one paragraph full of hyphens.
 *
 * The restraint matters as much as the conversion. Restructuring text somebody
 * wanted verbatim destroys content and may not be noticed for a long time, so
 * roughly half of these tests are about *not* converting.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS, readBlockTree, pageContent } from '@sone/core';
import * as Y from 'yjs';

import { assignMissingIds } from '../src/blockIds.js';
import { jsonToFragment } from '../src/editor.js';
import {
  looksLikeMarkdown,
  markdownToSlice,
  parseInline,
  parseMarkdownBlocks,
} from '../src/markdownPaste.js';
import { readIndent, schema } from '../src/schema.js';

const kinds = (text: string): string[] =>
  parseMarkdownBlocks(text).map((block) => block.type);

// --- when to convert at all ------------------------------------------------

test('structural markers are recognised', () => {
  for (const text of [
    '# Heading',
    '## Heading',
    '- item',
    '* item',
    '+ item',
    '1. item',
    '2) item',
    '> quote',
    '```',
    '[ ] task',
  ]) {
    assert.ok(looksLikeMarkdown(text), `${text} should be recognised`);
  }
});

test('ordinary prose is left alone', () => {
  // The cost of a false positive is much higher than a false negative: one
  // destroys text somebody wanted verbatim, the other means they format it
  // themselves.
  for (const text of [
    'Just a sentence.',
    'A sentence with an * asterisk in it.',
    'Two sentences. One paragraph.',
    'a - b - c',
    'x = 3 * 4',
    'Look at issue #42 please',
  ]) {
    assert.equal(looksLikeMarkdown(text), false, `${text} should be left alone`);
  }
});

test('unrecognised text produces no slice, so the default paste happens', () => {
  assert.equal(markdownToSlice('just prose'), null);
  assert.equal(markdownToSlice(''), null);
});

// --- block parsing ---------------------------------------------------------

test('headings carry their level', () => {
  const blocks = parseMarkdownBlocks('# One\n### Three');
  assert.deepEqual(
    blocks.map((block) => block.props?.['level']),
    [1, 3],
  );
});

test('lists, todos and quotes are told apart', () => {
  assert.deepEqual(kinds('- bullet'), ['bulletList']);
  assert.deepEqual(kinds('1. numbered'), ['numberedList']);
  assert.deepEqual(kinds('> quoted'), ['quote']);
});

test('a checklist is a todo, not a bullet', () => {
  // "- [ ] task" also matches the bullet pattern, so the more specific rule has
  // to win or every checklist becomes a list of literal brackets.
  const blocks = parseMarkdownBlocks('- [ ] open\n- [x] done');
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['todo', 'todo'],
  );
  assert.deepEqual(
    blocks.map((block) => block.attrs?.['checked']),
    [false, true],
  );
});

test('indentation becomes nesting', () => {
  const blocks = parseMarkdownBlocks('- one\n  - one a\n    - one a i');
  assert.deepEqual(
    blocks.map((block) => block.indent),
    [0, 1, 2],
  );
});

test('blank lines separate blocks without becoming one', () => {
  // An empty paragraph per blank line would double the spacing of every pasted
  // document.
  assert.deepEqual(kinds('# One\n\n\nSome text'), ['heading', 'paragraph']);
});

test('a fenced block keeps its content verbatim', () => {
  const blocks = parseMarkdownBlocks('```js\n# not a heading\n- not a list\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.type, 'code');
  assert.equal(blocks[0]!.attrs?.['language'], 'js');
  assert.equal(blocks[0]!.text, '# not a heading\n- not a list');
});

test('a fence keeps blank lines, which are content there', () => {
  const blocks = parseMarkdownBlocks('```\na\n\nb\n```');
  assert.equal(blocks[0]!.text, 'a\n\nb');
});

test('an unterminated fence still becomes a code block', () => {
  // Dropping the text because the closing fence is missing would lose content,
  // which is never the right trade.
  const blocks = parseMarkdownBlocks('```\nsome code\nmore code');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.type, 'code');
  assert.equal(blocks[0]!.text, 'some code\nmore code');
});

test('windows line endings are handled', () => {
  // A trailing \r turns every pattern match into a miss, so text pasted from
  // Windows or from a browser would convert to nothing.
  assert.deepEqual(kinds('# One\r\n- two\r\n'), ['heading', 'bulletList']);
});

test('a horizontal rule becomes a divider', () => {
  assert.deepEqual(kinds('---'), ['divider']);
  assert.deepEqual(kinds('***'), ['divider']);
});

// --- inline ----------------------------------------------------------------

const marksOf = (text: string): string[][] =>
  parseInline(text).map((node) => node.marks.map((mark) => mark.type.name));

test('bold, italic, strike and code are applied', () => {
  assert.deepEqual(marksOf('**bold**'), [['strong']]);
  assert.deepEqual(marksOf('__bold__'), [['strong']]);
  assert.deepEqual(marksOf('*italic*'), [['em']]);
  assert.deepEqual(marksOf('~~gone~~'), [['strikethrough']]);
  assert.deepEqual(marksOf('`code`'), [['inlineCode']]);
});

test('double asterisks win over single', () => {
  // Otherwise "**bold**" parses as an italic containing an asterisk.
  const nodes = parseInline('**bold**');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.text, 'bold');
  assert.deepEqual(nodes[0]!.marks.map((m) => m.type.name), ['strong']);
});

test('text around a mark is preserved', () => {
  const nodes = parseInline('a **b** c');
  assert.deepEqual(
    nodes.map((node) => node.text),
    ['a ', 'b', ' c'],
  );
});

test('a link becomes a link mark with a normalised address', () => {
  const nodes = parseInline('see [the site](example.org) now');
  const link = nodes.find((node) => node.marks.some((m) => m.type.name === 'link'));
  assert.ok(link);
  assert.equal(link!.text, 'the site');
  assert.equal(
    link!.marks.find((m) => m.type.name === 'link')!.attrs['href'],
    'https://example.org',
  );
});

test('a link with an unusable address keeps its literal text', () => {
  // Nothing is lost and the person can see why it did not become a link.
  const nodes = parseInline('[x](javascript:alert(1))');
  assert.ok(nodes.every((node) => !node.marks.some((m) => m.type.name === 'link')));
  assert.match(nodes.map((n) => n.text).join(''), /javascript/);
});

test('plain text yields a single node', () => {
  assert.deepEqual(marksOf('nothing special here'), [[]]);
});

// --- the whole path --------------------------------------------------------

test('a pasted document reads back as the right block tree', () => {
  // The proof that matters: what paste produces is what the server materialises.
  const slice = markdownToSlice(
    ['# Title', '', 'Some **bold** text.', '', '- one', '  - one a', '', '> quoted'].join(
      '\n',
    ),
  );
  assert.ok(slice);

  // Ids assigned first, which is what the editor's plugin does on the next
  // transaction and what an importer has to do explicitly. Without it the tree
  // reader skips every block — correctly, since a block with no id cannot be
  // materialised.
  const doc = assignMissingIds(
    schema.topNodeType.create(null, slice!.content),
    (() => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    })(),
  );

  const ydoc = new Y.Doc();
  jsonToFragment(doc, pageContent(ydoc));

  const { blocks, warnings } = readBlockTree(ydoc);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'paragraph', 'bulletList', 'bulletList', 'quote'],
  );
  assert.equal(blocks[3]!.parentId, blocks[2]!.id, 'the indented item nests');
  ydoc.destroy();
});

test('pasted blocks carry no ids, so the plugin can assign unique ones', () => {
  // Copying ids from elsewhere would give two blocks the same primary key in
  // the projection, and the second would overwrite the first.
  const slice = markdownToSlice('# One\n- two');
  assert.ok(slice);
  slice!.content.forEach((node) => {
    assert.equal(node.attrs[BLOCK_ATTRS.id], null, `${node.type.name} carries an id`);
  });
});

test('a heading level survives as both an attribute and a prop', () => {
  // The schema attribute drives the rendered size; the prop is what the tree
  // reader and the outline use. Setting only one leaves them disagreeing.
  const slice = markdownToSlice('### Three');
  const node = slice!.content.firstChild!;
  assert.equal(node.attrs['level'], 3);
  assert.match(String(node.attrs[BLOCK_ATTRS.props]), /"level":3/);
});

test('indent survives into the slice', () => {
  const slice = markdownToSlice('- one\n  - nested');
  const nodes: number[] = [];
  slice!.content.forEach((node) => nodes.push(readIndent(node.attrs)));
  assert.deepEqual(nodes, [0, 1]);
});
