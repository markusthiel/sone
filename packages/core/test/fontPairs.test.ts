/**
 * Choosing a typeface (ADR-0127).
 *
 * The last step of the appearance concept: *„Schriftpaare"*, and the one that
 * costs bytes rather than reasoning. ADR-0068 ships Archivo and JetBrains Mono
 * from this instance and fetches nothing from outside; a second face means a
 * second file in the repository, so the list is short and closed on purpose.
 *
 * ## A pair, not a font
 *
 * What is chosen is a **named pair** — the face body text is set in and the one
 * code is set in — for the reason every other value in a theme is a name: a
 * font family typed into a box is a font somebody's machine may not have, and
 * the person who typed it cannot see that.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sanitiseTheme, themeProperties } from '../src/doc/theme.js';

describe('what a theme may say about type', () => {
  test('one of the pairs, by name', () => {
    assert.equal(sanitiseTheme({ fonts: 'reading' }).fonts, 'reading');
    assert.equal(sanitiseTheme({ fonts: 'system' }).fonts, 'system');
  });

  test('and never a family of its own', () => {
    /*
     * The rule this whole area rests on, applied to the one value where it is
     * most tempting to break it. `"Helvetica Neue", sans-serif` is a string a
     * workspace could type and the interface could not check: on a machine
     * without it every reader gets a different design, and the person who set
     * it sees their own machine and thinks it worked.
     */
    assert.equal(sanitiseTheme({ fonts: 'Comic Sans MS' }).fonts, undefined);
    assert.equal(sanitiseTheme({ fonts: 'sans-serif' }).fonts, undefined);
  });

  test('and the design’s own pair is stored as nothing', () => {
    // Absent and "as the design decides" are the same state (ADR-0021), and a
    // stored default stops being right the moment the design changes.
    assert.equal(sanitiseTheme({ fonts: 'designed' }).fonts, undefined);
    assert.equal(sanitiseTheme({}).fonts, undefined);
  });
});

describe('what a pair becomes', () => {
  test('both halves, because a pair is two faces', () => {
    /*
     * Body text and code are two questions, and answering only the first is
     * how a workspace ends up with a serif page and the design's own grotesque
     * in every code block — a mismatch nobody chose.
     */
    const properties = themeProperties(sanitiseTheme({ fonts: 'reading' }));

    assert.match(properties['--sone-font'] ?? '', /Literata/);
    assert.ok(properties['--sone-font-mono'], 'and a mono face');
  });

  test('every stack ends somewhere the machine already has', () => {
    /*
     * A downloaded face can fail — a slow network, a blocked request, a reader
     * who turned webfonts off. The fallback is what they read in the meantime,
     * and a stack that ends in the family name alone ends in whatever the
     * browser decides, which is usually Times.
     */
    for (const pair of ['reading', 'plain', 'system'] as const) {
      const properties = themeProperties(sanitiseTheme({ fonts: pair }));
      assert.match(properties['--sone-font'] ?? '', /sans-serif|serif$/, pair);
      assert.match(properties['--sone-font-mono'] ?? '', /monospace/, pair);
    }
  });

  test('the system pair downloads nothing at all', () => {
    // The answer for somebody who wants the machine's own type, and the only
    // one that costs no bytes. It has to name no face this instance ships.
    const properties = themeProperties(sanitiseTheme({ fonts: 'system' }));
    for (const value of [properties['--sone-font'], properties['--sone-font-mono']]) {
      assert.doesNotMatch(value ?? '', /Archivo|Literata|Inter|Jetbrains/i);
    }
  });

  test('and a theme that says nothing emits nothing', () => {
    // Which leaves the stylesheet's own answer, the rule a theme has always
    // followed: gaps filled, never a replacement design.
    const properties = themeProperties(sanitiseTheme({}));
    assert.equal(properties['--sone-font'], undefined);
    assert.equal(properties['--sone-font-mono'], undefined);
  });
});
