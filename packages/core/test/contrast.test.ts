/**
 * The arithmetic, and the one guarantee that rests on it (ADR-0135).
 *
 * Two colour operations live here, and the whole point of separating them is
 * that they work in different spaces: **luminance is not linear in sRGB** and
 * **`color-mix(in srgb, …)` is**. Getting that backwards produces numbers that
 * look plausible and are wrong by enough to matter — which is the same class of
 * mistake as the `color-mix` with `transparent` the stylesheet records, and the
 * reason the mixing is checked against values a browser actually produced.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AA, contrastRatio, luminance, mixSrgb, parseHex, toHex } from '../src/doc/contrast.js';
import { readableOn, sanitiseTheme, themeProperties } from '../src/doc/theme.js';

describe('the arithmetic', () => {
  test('the two ends of the scale', () => {
    // 21:1 and 1:1 are the only two values a wrong implementation still gets
    // right, so they are where to start rather than where to stop.
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 100) / 100, 21);
    assert.equal(contrastRatio('#3f9a89', '#3f9a89'), 1);
  });

  test('naming the pair either way round gives one answer', () => {
    // The lighter goes on top by construction. A caller that had to know which
    // was which would eventually be given them the other way.
    assert.equal(contrastRatio('#161615', '#faf8f4'), contrastRatio('#faf8f4', '#161615'));
  });

  test('the numbers the stylesheet claimed by hand', () => {
    /*
     * The comment beside `--ink-500` states two ratios, worked out by somebody
     * once and never recomputed. They are right, and checking them is what says
     * this module agrees with whatever tool they used — a formula that agreed
     * with nothing would pass every other test in this file.
     */
    // Rounded a shade generously in the comment — 3.55 and 5.65 — so what is
    // asserted is the claim it was making: one is under AA on white and the one
    // that replaced it is over.
    assert.ok(Math.abs(contrastRatio('#8a8880', '#ffffff') - 3.6) < 0.1, '--ink-400 on white');
    assert.ok(Math.abs(contrastRatio('#6a675f', '#ffffff') - 5.7) < 0.1, '--ink-500 on white');
    assert.ok(contrastRatio('#8a8880', '#ffffff') < AA.text, 'which is why it was replaced');
  });

  test('a mix is linear on the sRGB digits, not on the light', () => {
    /*
     * Half way between black and white is `#808080`, which is *not* half the
     * luminance of white — it is about 0.216 of it. A mix computed in the
     * linear-light space would give `#bcbcbc`, and every surface in the
     * stylesheet would be measured against a colour no browser draws.
     */
    assert.equal(toHex(mixSrgb('#000000', 50, '#ffffff')), '#808080');
    assert.ok(Math.abs(luminance('#808080') - 0.2159) < 0.001, 'and luminance is not linear');

    // 0% and 100% are the identities, which is what makes "a colour mixed with
    // itself is itself" true — the fix the `--surface-*` comments record.
    assert.equal(toHex(mixSrgb('#d64545', 0, '#faf8f4')), '#faf8f4');
    assert.equal(toHex(mixSrgb('#d64545', 100, '#faf8f4')), '#d64545');
    assert.equal(toHex(mixSrgb('#faf8f4', 16, '#faf8f4')), '#faf8f4');
  });

  test('a colour that is not a colour is refused, not defaulted', () => {
    // A silent black would turn "this value is unreadable" into "this value has
    // excellent contrast", which is the one wrong answer that cannot be noticed.
    assert.throws(() => parseHex('transparent'));
    assert.throws(() => parseHex('var(--ink-900)'));
    assert.deepEqual(parseHex('#abc'), parseHex('#aabbcc'), 'and three digits are six');
  });
});

describe('what readableOn guarantees', () => {
  test('every colour a workspace can choose gets a legible partner', () => {
    /*
     * **The claim that had never been checked.** `readableOn` picks black or
     * white by luminance against a 0.179 threshold, and the comment says that
     * is where the two are equally readable — which is a statement about
     * *which* is better, not about whether either is good enough.
     *
     * It happens to be both, and this is why: at the crossover the ratio is
     * 4.58:1 either way, and every colour is further from one end than that. So
     * an accent picked out of a colour input can be wrong for a workspace's
     * taste and cannot be wrong for somebody's eyes.
     *
     * Walked rather than argued: every seventeenth value of every channel.
     */
    let worst = { ratio: Number.POSITIVE_INFINITY, color: '' };
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const color = toHex({ r, g, b });
          const found = contrastRatio(color, readableOn(color));
          if (found < worst.ratio) worst = { ratio: found, color };
        }
      }
    }
    assert.ok(
      worst.ratio >= AA.text,
      `${worst.color} against its computed partner is ${worst.ratio.toFixed(2)}:1`,
    );
  });

  test('and the worst case is the crossover itself', () => {
    // Named, so the margin is visible: this is a guarantee with about 0.08 to
    // spare, and a threshold moved to make some colour look nicer would spend
    // it without anything saying so.
    // `#aa44dd` is the colour that found the bug: luminance 0.17901, a hair
    // over the threshold, so it takes the dark answer and gets the narrowest
    // margin there is.
    const atThreshold = '#aa44dd';
    assert.ok(Math.abs(luminance(atThreshold) - 0.179) < 0.001);
    const margin = contrastRatio(atThreshold, readableOn(atThreshold));
    assert.ok(margin >= AA.text, `${margin.toFixed(2)}:1`);
    assert.ok(margin < 4.7, 'and there is about 0.08 to spare, not a comfortable amount');
  });

  test('a theme that sets an accent emits the partner with it', () => {
    // Not separately, and not optionally: the pair is what carries the
    // guarantee, and an accent emitted without its contrast colour would be an
    // accent drawn against whatever the previous workspace left behind.
    const properties = themeProperties(sanitiseTheme({ accent: '#ffff00' }));
    assert.equal(properties['--accent'], '#ffff00');
    assert.equal(properties['--accent-contrast'], readableOn('#ffff00'));
    assert.ok(contrastRatio('#ffff00', properties['--accent-contrast']!) >= AA.text);
  });
});
