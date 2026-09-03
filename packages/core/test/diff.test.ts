/**
 * What changed between two versions (ADR-0053).
 *
 * The test this exists for is the moved block: a text diff reports a moved
 * paragraph as a deletion in one place and an insertion in another, which is
 * the single most common way a diff lies about what somebody did. Block ids
 * make the correspondence given rather than guessed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffVersions, diffWords } from '../src/doc/diff.js';

const block = (id: string, text: string) => ({ id, type: 'paragraph', text });

test('a moved block is moved, not deleted and added', () => {
  const before = [block('a', 'Erstens'), block('b', 'Zweitens'), block('c', 'Drittens')];
  const after = [block('c', 'Drittens'), block('a', 'Erstens'), block('b', 'Zweitens')];

  const { changes } = diffVersions(before, after);
  assert.deepEqual(
    changes.map((one) => [one.kind, one.block.id]),
    [
      ['moved', 'c'],
      ['moved', 'a'],
      ['moved', 'b'],
    ],
  );
  assert.equal(changes.some((one) => one.kind === 'added' || one.kind === 'removed'), false);
});

test('a rewritten block is compared word by word', () => {
  const { changes } = diffVersions(
    [block('a', 'Die Rechnung kommt im März')],
    [block('a', 'Die Rechnung kommt im April')],
  );
  assert.equal(changes.length, 1);
  const change = changes[0];
  assert.ok(change?.kind === 'changed');
  // Only the word that changed, not the sentence.
  assert.deepEqual(
    change.words.filter((one) => one.kind !== 'same').map((one) => [one.kind, one.text.trim()]),
    [
      ['removed', 'März'],
      ['added', 'April'],
    ],
  );
});

test('whitespace alone is not a change', () => {
  const { changes } = diffVersions(
    [block('a', 'Ein  Satz')],
    [block('a', 'Ein Satz')],
  );
  assert.deepEqual(changes, []);
});

test('added and removed blocks are named as such', () => {
  const { changes } = diffVersions(
    [block('a', 'Bleibt'), block('b', 'Verschwindet')],
    [block('a', 'Bleibt'), block('c', 'Neu')],
  );
  assert.deepEqual(
    changes.map((one) => [one.kind, one.block.id]),
    [
      ['added', 'c'],
      ['removed', 'b'],
    ],
  );
});

test('blocks with no id are counted rather than guessed at', () => {
  // The projection can contain them — an importer, or an older build. They are
  // the one place this would behave like a text diff, so the interface can say
  // the comparison is approximate instead of pretending.
  const { changes, unmatched } = diffVersions(
    [block('', 'Ohne Kennung'), block('a', 'Mit')],
    [block('', 'Ohne Kennung'), block('a', 'Mit')],
  );
  assert.equal(unmatched, 2);
  assert.deepEqual(changes, []);
});

test('a very long block is reported as rewritten rather than compared', () => {
  // The comparison is quadratic in words, which is fine for a paragraph and not
  // for a chapter. A block that long reads as wholly rewritten anyway.
  const long = 'wort '.repeat(500);
  const words = diffWords(long, `${long}anders`);
  assert.deepEqual(
    words.map((one) => one.kind),
    ['removed', 'added'],
  );
});
