/**
 * A theme as a file (ADR-0125).
 *
 * Asked for as: *„Ggf. auch Themes die man importieren und exportieren kann, die
 * dann wirklich alles verändern."*
 *
 * The second half of that sentence is the one that took four records to earn.
 * When it was asked, a theme was colours; a file of colours would have changed
 * colours. It now carries the surfaces, the corners and light-or-dark
 * (ADR-0122, ADR-0124), so a file of one really does change what the place
 * looks like.
 *
 * ## What this is not
 *
 * It is not a second way into a theme. A file goes through the same
 * `sanitiseTheme` the form and the server do, so **an imported file can do
 * nothing the form could not** — which is what makes accepting one from a
 * stranger's download safe.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readThemeFile, writeThemeFile } from '../src/doc/themeFile.js';

describe('what comes out', () => {
  test('is JSON a person can read, with the theme under one key', () => {
    const text = writeThemeFile('Haus Thiel', {
      accent: '#336699',
      surfaces: { rail: 'inverted' },
      scheme: 'dark',
    });

    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.equal(parsed['sone'], 'theme', 'says what it is, in the file itself');
    assert.equal(parsed['name'], 'Haus Thiel');
    assert.deepEqual(parsed['theme'], {
      accent: '#336699',
      surfaces: { rail: 'inverted' },
      scheme: 'dark',
    });
  });

  test('and it is indented, because somebody will open it', () => {
    // A theme file is small and gets mailed around and pasted into issues. One
    // line of JSON is a file nobody can diff or correct by hand.
    assert.match(writeThemeFile('x', { accent: '#336699' }), /\n {2}"/);
  });
});

describe('what may come in', () => {
  test('a file this program wrote', () => {
    const read = readThemeFile(writeThemeFile('Haus Thiel', { accent: '#336699', corners: 'round' }));
    assert.deepEqual(read, {
      name: 'Haus Thiel',
      theme: { accent: '#336699', corners: 'round' },
    });
  });

  test('and nothing else at all', () => {
    /*
     * **The decision this file exists to record.** Anything unrecognised is
     * *refused*, not sanitised into an empty theme.
     *
     * Everywhere else here the rule is the opposite — drop what you do not
     * understand and keep the rest — and it is right there, because the input
     * is a form somebody is filling in. Here the input is a file somebody
     * picked, and picking the wrong file is the ordinary mistake. Sanitising a
     * holiday photo's metadata into `{}` and loading that would silently empty
     * a workspace's whole appearance, and the person would see a form that
     * looked reset and no reason why.
     */
    for (const bad of ['', 'not json', '[]', '{}', '{"theme":{"accent":"#336699"}}', 'null']) {
      assert.equal(readThemeFile(bad), null, JSON.stringify(bad));
    }
  });

  test('and what is inside it is filtered, as it is everywhere else', () => {
    // Inside a file that *is* a theme, the ordinary rule returns: one stale
    // field must not cost somebody the rest. The sanitiser is the same one the
    // form and the server run, which is what makes a file harmless.
    const read = readThemeFile(
      JSON.stringify({
        sone: 'theme',
        version: 1,
        name: 'Mixed',
        theme: { accent: '#336699', surfaces: { page: 'inverted' }, nonsense: 1 },
      }),
    );

    assert.deepEqual(read?.theme, { accent: '#336699' });
  });

  test('a version it has never heard of is still read', () => {
    /*
     * Not branched on, and that is deliberate. The sanitiser already drops what
     * it does not know, so a later release adding a field costs an older one
     * nothing — refusing on a number would turn a compatible file into an error
     * message for no gain. The field is written so that a *breaking* rename one
     * day has something to look at.
     */
    const read = readThemeFile(
      JSON.stringify({ sone: 'theme', version: 99, name: 'Future', theme: { tint: 'blue' } }),
    );
    assert.deepEqual(read?.theme, { tint: 'blue' });
  });

  test('a name that is not a string does not become one', () => {
    // It reaches a heading and a filename. Absent is a fine answer; `[object
    // Object]` in a download's name is not.
    const read = readThemeFile(
      JSON.stringify({ sone: 'theme', version: 1, name: { evil: true }, theme: {} }),
    );
    assert.equal(read?.name, '');
  });
});

describe('what a file cannot smuggle', () => {
  test('a surface the interface does not have', () => {
    const read = readThemeFile(
      JSON.stringify({
        sone: 'theme',
        version: 1,
        theme: { surfaces: { rail: 'inverted', page: 'inverted' } },
      }),
    );
    assert.deepEqual(read?.theme.surfaces, { rail: 'inverted' });
  });

  test('a colour where a step belongs', () => {
    // The rule the whole theme rests on: steps, not values. A file is not the
    // way round it.
    const read = readThemeFile(
      JSON.stringify({
        sone: 'theme',
        version: 1,
        theme: { heading1: { size: 7, color: 'blue' } },
      }),
    );
    assert.deepEqual(read?.theme.heading1, { color: 'blue' });
  });
});
