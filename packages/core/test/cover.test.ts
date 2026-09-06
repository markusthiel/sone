/**
 * A cover on a page or a folder (ADR-0117).
 *
 * The schema has had a place for one since the first migration —
 * `pages.cover_url text`, `PAGE_KEYS.coverUrl` — read by the projection,
 * returned by the page route, and never written by anything. The same history
 * the icon column had (ADR-0030), and it ends the same way: the shape that goes
 * in it is decided now, when there is finally something to put there.
 *
 * `text` is not that shape. A cover may be a colour or a gradient as well as a
 * picture, and neither of those is a URL — so the column becomes `jsonb` beside
 * `icon`, and this is the reader for it.
 *
 * The rule that needs a test rather than a comment is which pictures are
 * allowed: **only a file uploaded here**. That was asked for in those words —
 * *„nur eigene Bilder, kein Unsplash"* — and it is enforced in the reader
 * rather than in the picker, so it is a property of what a document may say and
 * not of one screen that writes it. A cover is drawn on every page load; an
 * arbitrary URL in it is a page that reports every reader to somebody else's
 * server.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { coverBackground, readEntryCover } from '../src/doc/theme.js';

const FILE = '/api/files/6f1c9e2a-0000-4000-8000-00000000abcd';

describe('what a cover may be', () => {
  test('a picture uploaded here', () => {
    assert.deepEqual(readEntryCover({ kind: 'image', url: FILE }), {
      kind: 'image',
      url: FILE,
    });
  });

  test('and nothing else with a URL in it', () => {
    /*
     * The whole of „kein Unsplash", as data rather than as a policy the picker
     * happens to follow. Each of these is a page that fetches from somewhere
     * else the moment anybody opens it — which is a tracking pixel wearing a
     * cover, and it does not need anybody to have been careless to arrive: a
     * document is written by clients, and one of them can be a script.
     */
    for (const url of [
      'https://images.unsplash.com/photo-1',
      '//images.unsplash.com/photo-1',
      'http://localhost:3000/api/files/6f1c9e2a-0000-4000-8000-00000000abcd',
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      '/api/files/../../etc/passwd',
      '/api/files/6f1c9e2a-0000-4000-8000-00000000abcd/../../secret',
      '/api/files/not-a-uuid',
      '/api/files/',
      '/api/pages/6f1c9e2a-0000-4000-8000-00000000abcd',
    ]) {
      assert.equal(readEntryCover({ kind: 'image', url }), null, url);
    }
  });

  test('a colour from the workspace palette, or one of somebody’s own', () => {
    // The same two spellings every other colour in this project accepts
    // (ADR-0030). A palette name keeps following the workspace, so a cover
    // chosen as "blue" changes when the workspace's blue does.
    assert.deepEqual(readEntryCover({ kind: 'color', color: 'blue' }), {
      kind: 'color',
      color: 'blue',
    });
    assert.deepEqual(readEntryCover({ kind: 'color', color: '#A1B2C3' }), {
      kind: 'color',
      color: '#a1b2c3',
    });
    assert.equal(readEntryCover({ kind: 'color', color: 'chartreuse' }), null);
    assert.equal(readEntryCover({ kind: 'color' }), null, 'a colour with no colour is nothing');
  });

  test('or a gradient between two of them', () => {
    assert.deepEqual(readEntryCover({ kind: 'gradient', from: 'blue', to: '#112233' }), {
      kind: 'gradient',
      from: 'blue',
      to: '#112233',
    });
    // Both halves, or it is not a gradient. Filling in the missing one with a
    // default would be a cover nobody chose.
    assert.equal(readEntryCover({ kind: 'gradient', from: 'blue' }), null);
    assert.equal(readEntryCover({ kind: 'gradient', to: 'blue' }), null);
  });

  test('anything else reads as no cover at all', () => {
    // It comes out of a document another client wrote. An entry with a
    // malformed cover loses its cover, never its place in the tree — the rule
    // `readEntryIcon` states and this follows.
    for (const value of [null, undefined, 'blue', 42, [], {}, { kind: 'photo' }, { kind: 'image' }]) {
      assert.equal(readEntryCover(value), null, JSON.stringify(value) ?? 'undefined');
    }
  });
});

describe('drawing one', () => {
  test('a colour becomes a colour, a name becomes the workspace’s variable', () => {
    assert.equal(coverBackground({ kind: 'color', color: '#112233' }), '#112233');
    assert.equal(coverBackground({ kind: 'color', color: 'blue' }), 'var(--sone-palette-blue)');
  });

  test('a gradient names both ends', () => {
    const drawn = coverBackground({ kind: 'gradient', from: 'blue', to: '#112233' });
    assert.match(drawn ?? '', /^linear-gradient\(/);
    assert.match(drawn ?? '', /var\(--sone-palette-blue\)/);
    assert.match(drawn ?? '', /#112233/);
  });

  test('a picture is not drawn as a background at all', () => {
    /*
     * It is an `<img>`, which is why this returns nothing for one.
     *
     * `background-image: url(…)` means building a CSS string out of a value
     * from the document, and the escaping rules for that are their own subject.
     * An `<img src>` is escaped by the framework, can carry alternative text,
     * and can be told to load lazily. The reason it is stated here rather than
     * only in the component is that a second drawing site would otherwise be
     * free to answer differently.
     */
    assert.equal(coverBackground({ kind: 'image', url: FILE }), undefined);
    assert.equal(coverBackground(null), undefined);
  });
});
