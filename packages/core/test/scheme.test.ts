/**
 * Where light and dark are decided (ADR-0124).
 *
 * Asked for as part of the branding step: *„hell/dunkel Standard, überschreibbar
 * pro Workspace und pro Nutzer"* — and answered as three levels, which is the
 * shape the theme underneath it already has (ADR-0123).
 *
 * The whole of the difficulty is that **four states are needed and not three**.
 * `system` is not the absence of a choice: it is the choice to let the device
 * decide, and somebody who makes it is overriding a workspace that says dark.
 * Absence is a different answer — "whatever the level above says" — and
 * collapsing the two costs exactly the case the request was about.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveScheme, sanitiseTheme } from '../src/doc/theme.js';

describe('what a theme may say about light and dark', () => {
  test('one of three, and nothing else', () => {
    assert.equal(sanitiseTheme({ scheme: 'dark' }).scheme, 'dark');
    assert.equal(sanitiseTheme({ scheme: 'system' }).scheme, 'system');
    assert.equal(sanitiseTheme({ scheme: 'sepia' }).scheme, undefined);
  });

  test('and absence is not one of the three', () => {
    // The distinction the rest of this file is about: a workspace that has said
    // nothing defers, and a workspace that said `system` has overridden the
    // instance in favour of the device.
    assert.equal(sanitiseTheme({}).scheme, undefined);
  });
});

describe('who wins', () => {
  test('the person, over everybody', () => {
    // Somebody outside in the sun wants light whatever their workspace prefers.
    // That is the argument the stylesheet already makes for prefers-color-scheme,
    // and it does not stop applying because a workspace grew an opinion.
    assert.equal(resolveScheme('light', { scheme: 'dark' }), 'light');
  });

  test('the workspace, when the person has not said', () => {
    assert.equal(resolveScheme(null, { scheme: 'dark' }), 'dark');
    assert.equal(resolveScheme(undefined, { scheme: 'dark' }), 'dark');
  });

  test('and the device, when nobody has', () => {
    // The design's own answer, and the one every account has had until now.
    assert.equal(resolveScheme(null, {}), 'system');
  });

  test('“the device decides” is a choice, not a silence', () => {
    /*
     * The case the four states exist for. A workspace is dark; somebody in it
     * wants their laptop's setting to rule instead. With three states they
     * could only pick light or dark by hand — and would then be wrong twice a
     * day, which is precisely what `system` exists to avoid.
     */
    assert.equal(resolveScheme('system', { scheme: 'dark' }), 'system');
  });

  test('and an unusable stored value is nobody having said', () => {
    // It comes out of a column and out of a merged theme, and a person whose
    // account holds a word from a future release should get the ordinary
    // answer rather than an interface that cannot decide what colour it is.
    assert.equal(resolveScheme('sepia' as never, {}), 'system');
    assert.equal(resolveScheme(null, { scheme: 'sepia' } as never), 'system');
  });
});
