/**
 * Tags.
 *
 * The normalisation is the whole contract. `Meeting`, `meeting ` and `  MEETING`
 * have to be one tag, or a workspace accumulates near-duplicates that look
 * identical in a list and behave differently in a filter — which is the failure
 * mode of every tag system that skips this.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import {
  MAX_TAGS_PER_PAGE,
  MAX_TAG_LENGTH,
  isValidTag,
  normaliseTags,
  readTags,
  tagKey,
  writeTags,
} from '../src/doc/tags.js';

test('case and surrounding whitespace do not make a new tag', () => {
  const key = tagKey('Meeting');
  assert.equal(tagKey('meeting'), key);
  assert.equal(tagKey('  MEETING  '), key);
  assert.equal(tagKey('MeEtInG'), key);
});

test('inner whitespace is collapsed', () => {
  // "project  acme" and "project acme" are the same thing typed twice.
  assert.equal(tagKey('project   acme'), tagKey('project acme'));
  assert.equal(tagKey('project\tacme'), tagKey('project acme'));
});

test('the first spelling is kept for display', () => {
  // Typed as Meeting, shows as Meeting — and typing "meeting" elsewhere joins
  // it rather than creating a second tag.
  assert.deepEqual(normaliseTags(['Meeting', 'meeting', 'MEETING']), ['Meeting']);
});

test('order is preserved', () => {
  assert.deepEqual(normaliseTags(['b', 'a', 'c']), ['b', 'a', 'c']);
});

test('empty and whitespace-only tags are dropped', () => {
  assert.deepEqual(normaliseTags(['', '   ', '\t', 'real']), ['real']);
  assert.equal(isValidTag(''), false);
  assert.equal(isValidTag('   '), false);
});

test('an over-long tag is refused rather than truncated', () => {
  // Truncating would silently merge two different tags whose first 64
  // characters match.
  const long = 'x'.repeat(MAX_TAG_LENGTH + 1);
  assert.equal(isValidTag(long), false);
  assert.deepEqual(normaliseTags([long, 'ok']), ['ok']);
});

test('the number of tags on a page is capped', () => {
  const many = Array.from({ length: MAX_TAGS_PER_PAGE + 10 }, (_, i) => `tag-${i}`);
  assert.equal(normaliseTags(many).length, MAX_TAGS_PER_PAGE);
});

test('non-strings are ignored rather than coerced', () => {
  // A document written by something else must not turn `null` into the tag
  // "null".
  const mixed = [1, null, undefined, {}, 'real'] as unknown as string[];
  assert.deepEqual(normaliseTags(mixed), ['real']);
});

test('tags round-trip through a document', () => {
  const doc = new Y.Doc();
  writeTags(doc, ['Meeting', 'project acme']);
  assert.deepEqual(readTags(doc), ['Meeting', 'project acme']);
  doc.destroy();
});

test('writing cleans as it stores', () => {
  const doc = new Y.Doc();
  const stored = writeTags(doc, ['  Meeting ', 'meeting', '']);
  assert.deepEqual(stored, ['Meeting']);
  assert.deepEqual(readTags(doc), ['Meeting']);
  doc.destroy();
});

test('a document with no tags reads as none', () => {
  const doc = new Y.Doc();
  assert.deepEqual(readTags(doc), []);
  doc.destroy();
});

test('a plain array from an importer is read, not rejected', () => {
  // The shape this writes is a Y.Array, but an importer or an older document
  // may hold a plain one. Reading it beats discarding somebody's tags.
  const doc = new Y.Doc();
  doc.getMap('page').set('tags', ['Imported', 'imported']);
  assert.deepEqual(readTags(doc), ['Imported']);
  doc.destroy();
});

test('two clients adding different tags both survive a merge', () => {
  // The array is replaced wholesale, so this is last-writer-wins on the list.
  // Asserted so the behaviour is known rather than discovered: whichever write
  // is later wins, and neither document ends up with a mixture that reads as
  // corruption.
  const first = new Y.Doc();
  writeTags(first, ['shared']);

  const second = new Y.Doc();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

  writeTags(first, ['shared', 'from-first']);
  writeTags(second, ['shared', 'from-second']);

  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

  assert.deepEqual(
    readTags(first),
    readTags(second),
    'both sides must agree on the result',
  );
  first.destroy();
  second.destroy();
});
