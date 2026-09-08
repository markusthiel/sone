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

describe('the shape of the band (ADR-0162)', () => {
  /*
   * Asked for after living with it: *„dass das Titelbild auch über die ganze
   * breite geht. Und vielleicht noch 3 Möglichkeiten was die Höhe angeht"*.
   *
   * Two fields beside `kind` rather than three more kinds: how tall a band is
   * and how wide it runs are true of a picture, a colour and a gradient alike,
   * and a union that multiplied them would have nine members saying three
   * things.
   */
  test('a cover nobody has adjusted carries nothing about its shape', () => {
    // The default is absence, the way `template` and `locked` are absent rather
    // than false. Every cover written before this round is one of these, and it
    // has to keep drawing exactly as it did.
    assert.deepEqual(readEntryCover({ kind: 'image', url: FILE }), {
      kind: 'image',
      url: FILE,
    });
  });

  test('a width and a height are kept, whatever the cover is', () => {
    assert.deepEqual(readEntryCover({ kind: 'image', url: FILE, width: 'full', height: 'tall' }), {
      kind: 'image',
      url: FILE,
      width: 'full',
      height: 'tall',
    });
    assert.deepEqual(readEntryCover({ kind: 'color', color: 'blue', height: 'slim' }), {
      kind: 'color',
      color: 'blue',
      height: 'slim',
    });
    assert.deepEqual(readEntryCover({ kind: 'gradient', from: 'blue', to: 'purple', width: 'full' }), {
      kind: 'gradient',
      from: 'blue',
      to: 'purple',
      width: 'full',
    });
  });

  test('and a third step: up under the bar (ADR-0163)', () => {
    /*
     * *„Eine weitere Einstellung dass das Titelbild bis oben zum Seitenrand
     * läuft."*
     *
     * A third value in the same field rather than a second field, because
     * „bis oben" is the widest of three steps and not a second question: a
     * band in the reading column that also ran under the bar would put the
     * page's controls over the page's own background, which is where they
     * already are.
     */
    assert.deepEqual(readEntryCover({ kind: 'image', url: FILE, width: 'bleed' }), {
      kind: 'image',
      url: FILE,
      width: 'bleed',
    });
  });

  test('the default has one spelling, and it is silence', () => {
    /*
     * `column` and `medium` are what a cover does when it says nothing, so the
     * reader refuses to store them as words. Two spellings for one state is a
     * control that has to decide which of them counts as chosen — and a band
     * that reads as adjusted while looking exactly like every band nobody has
     * touched.
     */
    assert.deepEqual(
      readEntryCover({ kind: 'image', url: FILE, width: 'column', height: 'medium' }),
      { kind: 'image', url: FILE },
    );
  });

  test('and a shape nobody offers is dropped without taking the cover with it', () => {
    /*
     * The rule this file already states, applied one level down: a malformed
     * cover loses its cover and not its place in the tree, so a cover with a
     * height nobody has heard of loses the height and not the picture. The
     * alternative is a page that shows nothing above its heading because
     * somebody's client wrote `height: 'huge'`.
     */
    for (const shape of [
      { width: 'gigantic' },
      { width: 'wide' },
      { height: 'huge' },
      { height: 42 },
      { width: null, height: null },
    ]) {
      assert.deepEqual(
        readEntryCover({ kind: 'image', url: FILE, ...shape }),
        { kind: 'image', url: FILE },
        JSON.stringify(shape),
      );
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
