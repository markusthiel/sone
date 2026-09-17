import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToOps, opsToMarkdown, opsToText, type InlineOp } from '../src/doc/inlineMarkdown.js';

const trip = (ops: InlineOp[]): InlineOp[] => markdownToOps(opsToMarkdown(ops));

test('every mark the schema has survives the round trip', () => {
  const ops: InlineOp[] = [
    { insert: 'Plain, ' },
    { insert: 'bold', attributes: { strong: {} } },
    { insert: ', ' },
    { insert: 'italic', attributes: { em: {} } },
    { insert: ', ' },
    { insert: 'gone', attributes: { strikethrough: {} } },
    { insert: ', ' },
    { insert: 'code *stays*', attributes: { inlineCode: {} } },
    { insert: ' and ' },
    { insert: 'a link', attributes: { link: { href: 'https://example.org/a?b=1', title: null } } },
    { insert: '.' },
  ];
  const markdown = opsToMarkdown(ops);
  assert.equal(
    markdown,
    'Plain, **bold**, *italic*, ~~gone~~, `code *stays*` and [a link](https://example.org/a?b=1).',
  );
  assert.deepEqual(trip(ops), ops);
});

test('nested and adjacent marks keep their shape', () => {
  const ops: InlineOp[] = [
    { insert: 'bold', attributes: { strong: {} } },
    { insert: ' and bold-italic', attributes: { strong: {}, em: {} } },
    { insert: ' then a ', attributes: {} },
    { insert: 'bold link', attributes: { strong: {}, link: { href: '/p/x', title: 'Title' } } },
  ];
  const markdown = opsToMarkdown(ops);
  assert.equal(markdown, '**bold *and bold-italic*** then a [**bold link**](/p/x "Title")');
  const back = trip(ops);
  assert.equal(opsToText(back), opsToText(ops));
  // The space between the runs may land on either side of the inner mark;
  // what must hold is which words carry which marks.
  assert.deepEqual(back[0]!.attributes, { strong: {} });
  assert.equal(back[0]!.insert.trim(), 'bold');
  assert.deepEqual(back[1]!.attributes, { strong: {}, em: {} });
  assert.equal(back[1]!.insert.trim(), 'and bold-italic');
  assert.deepEqual(back.at(-1), ops[3]);
});

test('literal Markdown characters in prose are escaped and come back as themselves', () => {
  const ops: InlineOp[] = [{ insert: 'a * b * c, snake_case, [x] and `tick` and ~~not struck' }];
  const markdown = opsToMarkdown(ops);
  assert.equal(opsToText(markdownToOps(markdown)), ops[0]!.insert);
  assert.deepEqual(markdownToOps(markdown), ops);
});

test('other tools’ Markdown reads sensibly', () => {
  assert.deepEqual(markdownToOps('2 * 3 * 4 is *twelve*'), [
    { insert: '2 * 3 * 4 is ' },
    { insert: 'twelve', attributes: { em: {} } },
  ]);
  assert.deepEqual(markdownToOps('snake_case and _em_'), [
    { insert: 'snake_case and ' },
    { insert: 'em', attributes: { em: {} } },
  ]);
  assert.deepEqual(markdownToOps('an unmatched ** stays'), [{ insert: 'an unmatched ** stays' }]);
});
