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

import {
  AA,
  WORST_GROUND,
  contrastRatio,
  groundTone,
  luminance,
  mixSrgb,
  parseHex,
  readableInk,
  toHex,
} from '../src/doc/contrast.js';
import { PALETTE_DEFAULTS, readableOn, sanitiseTheme, themeProperties } from '../src/doc/theme.js';

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

describe('the accent read as text (ADR-0136)', () => {
  test('a colour that already reads is returned untouched', () => {
    // The ordinary case: a brand colour somebody chose to be visible usually
    // is. Moving it anyway would be changing a workspace's colour for no reason
    // and then having to explain why the link is not quite the brand.
    const readable = '#275f56';
    assert.equal(readableInk(readable, WORST_GROUND.light), readable);
    assert.ok(contrastRatio(readable, WORST_GROUND.light) >= AA.text);
  });

  test('and one that does not is moved only as far as it must be', () => {
    /*
     * Not to black, and not by a fixed amount. A fixed darkening is the thing
     * that looks like it works: it is too little for yellow and far too much
     * for a colour that was nearly there, and either way it is a number nobody
     * can defend.
     */
    const moved = readableInk('#ffff00', WORST_GROUND.light);
    assert.ok(contrastRatio(moved, WORST_GROUND.light) >= AA.text);
    assert.notEqual(moved, '#000000', 'not all the way');
    // One step back towards the original stops clearing it, which is what
    // "only as far as it must be" means.
    const parsed = parseHex(moved);
    const lighter = toHex({ r: parsed.r + 4, g: parsed.g + 4, b: parsed.b + 4 });
    assert.ok(contrastRatio(lighter, WORST_GROUND.light) < AA.text);
  });

  test('the direction belongs to the ground, not to the colour', () => {
    // The same accent goes down for a light reader and up for a dark one, from
    // one stored value — which is the whole reason there are two derivations
    // rather than one (ADR-0122's argument about `inverted`, on the accent).
    const chosen = '#2f7d6f';
    assert.ok(luminance(readableInk(chosen, WORST_GROUND.light)) < luminance(chosen));
    assert.ok(luminance(readableInk(chosen, WORST_GROUND.dark)) > luminance(chosen));
  });

  test('every colour in the cube reaches AA on both grounds', () => {
    let worst = { ratio: Number.POSITIVE_INFINITY, color: '', scheme: '' };
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const color = toHex({ r, g, b });
          for (const [scheme, ground] of Object.entries(WORST_GROUND)) {
            const found = contrastRatio(readableInk(color, ground), ground);
            if (found < worst.ratio) worst = { ratio: found, color, scheme };
          }
        }
      }
    }
    assert.ok(
      worst.ratio >= AA.text,
      `${worst.color} on the ${worst.scheme} ground is ${worst.ratio.toFixed(3)}:1`,
    );
  });

  test('the rounding happens inside the search, not after it', () => {
    /*
     * **The bug this found.** The channels are floats and the answer is eight
     * bits, so a search on the floats finds the exact crossing and `toHex`
     * rounds back across it: `#2f7d6f` came out at 4.47:1, under the floor the
     * search had just cleared. Three of eight sample colours landed under.
     *
     * Asserted as a property of the returned value rather than of the loop,
     * because that is the thing that was wrong.
     */
    for (const color of ['#2f7d6f', '#ffff00', '#ff0000', '#0000ff', '#16a34a']) {
      for (const ground of Object.values(WORST_GROUND)) {
        const ink = readableInk(color, ground);
        assert.match(ink, /^#[0-9a-f]{6}$/, `${ink} is a colour a stylesheet can hold`);
        assert.ok(contrastRatio(ink, ground) >= AA.text, `${color} → ${ink}`);
      }
    }
  });

  test('a theme emits one accent and two ways to read it', () => {
    const properties = themeProperties(sanitiseTheme({ accent: '#ffff00' }));
    assert.equal(properties['--accent'], '#ffff00', 'the fill is what was chosen');
    assert.equal(properties['--sone-theme-accent-on-light'], readableInk('#ffff00', WORST_GROUND.light));
    assert.equal(properties['--sone-theme-accent-on-dark'], readableInk('#ffff00', WORST_GROUND.dark));
  });

  test('a name is resolved to a colour before anything is measured', () => {
    /*
     * **The bug this found.** `readableOn` was handed
     * `var(--sone-palette-yellow)`, whose luminance is `NaN`, whose comparison
     * against the threshold is false — so *every* accent stored as a name got
     * white text on it. On yellow that is 3.0:1, and nothing said so, because a
     * wrong answer and no answer looked the same.
     */
    for (const name of ['yellow', 'blue', 'purple'] as const) {
      const properties = themeProperties(sanitiseTheme({ accent: name }));
      assert.equal(properties['--accent'], `var(--sone-palette-${name})`, 'still a name in CSS');
      const hex = PALETTE_DEFAULTS[name];
      assert.equal(properties['--accent-contrast'], readableOn(hex));
      assert.ok(contrastRatio(hex, properties['--accent-contrast']!) >= AA.text, name);
      assert.equal(properties['--sone-theme-accent-on-light'], readableInk(hex, WORST_GROUND.light));
    }
    // Yellow is the one that was wrong, so it is named.
    assert.equal(
      themeProperties(sanitiseTheme({ accent: 'yellow' }))['--accent-contrast'],
      '#000000',
      'dark text on a pale accent, which is what it never was',
    );
  });

  test('and a workspace that redefined the name means its own colour', () => {
    // `blue` is whatever this workspace says blue is, so that is what has to be
    // measured — otherwise the contrast is computed for a colour nobody will see.
    const properties = themeProperties(
      sanitiseTheme({ accent: 'blue', palette: { blue: '#f0e68c' } }),
    );
    assert.equal(properties['--accent-contrast'], readableOn('#f0e68c'));
    assert.equal(properties['--sone-theme-accent-on-dark'], readableInk('#f0e68c', WORST_GROUND.dark));
  });
});

describe('the accent as a line (ADR-0137)', () => {
  test('a line is derived at a line’s floor', () => {
    // 3:1, which is what the standard asks of a control's boundary. Text wants
    // 4.5:1 and a line is not text.
    for (const color of ['#ffff00', '#f0e68c', '#d4d2ca']) {
      const line = readableInk(color, WORST_GROUND.light, AA.nonText);
      assert.ok(contrastRatio(line, WORST_GROUND.light) >= AA.nonText);
      assert.ok(contrastRatio(line, WORST_GROUND.light) < AA.text, 'and not further than that');
    }
  });

  test('and it stays nearer the colour somebody chose than the text does', () => {
    /*
     * The reason there are two derivations rather than one. Deriving a border
     * at the text floor darkens it past the fill it sits beside, which shows as
     * a ring around every primary button — and the fill is the colour the
     * workspace actually picked.
     */
    for (const color of ['#ffff00', '#7c3aed', '#2f7d6f']) {
      const line = luminance(readableInk(color, WORST_GROUND.light, AA.nonText));
      const text = luminance(readableInk(color, WORST_GROUND.light, AA.text));
      const chosen = luminance(color);
      assert.ok(
        Math.abs(line - chosen) <= Math.abs(text - chosen),
        `${color}: the line moved further than the text`,
      );
    }
  });

  test('a focus ring is visible whatever a workspace picked', () => {
    /*
     * **The bug.** A focus ring was the raw accent, so a pale one was 1.07:1 on
     * the page — the ring is there and nobody can see it, which is a keyboard
     * user who cannot tell where they are. Not a cosmetic failure.
     */
    let worst = { ratio: Number.POSITIVE_INFINITY, color: '' };
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const color = toHex({ r, g, b });
          for (const ground of Object.values(WORST_GROUND)) {
            const found = contrastRatio(readableInk(color, ground, AA.nonText), ground);
            if (found < worst.ratio) worst = { ratio: found, color };
          }
        }
      }
    }
    assert.ok(worst.ratio >= AA.nonText, `${worst.color} is ${worst.ratio.toFixed(3)}:1`);
    // What it was before, named so the size of it is visible.
    assert.ok(contrastRatio('#ffff00', '#ffffff') < 1.1, 'a yellow ring on white was 1.07:1');
  });

  /*
   * Which of two marks belongs on a ground (ADR-0149).
   *
   * The question is *„je nachdem wie hell die schmale Leiste ist"*, and the
   * comparison it needs already existed inside `readableInk`, written as
   * `luminance(ground) > luminance('#808080')` and named nowhere. A second copy
   * of that line in the web package would be the shape this project keeps
   * finding: one rule, two homes, and a day when they disagree.
   */
  test('a ground is light or dark, and mid grey is decided by contrast', () => {
    assert.equal(groundTone('#ffffff'), 'light');
    assert.equal(groundTone('#f7f6f3'), 'light');
    assert.equal(groundTone('#101010'), 'dark');
    assert.equal(groundTone('#3a3a37'), 'dark', 'the darkest ground the interface makes');
    assert.equal(groundTone('#d0cec9'), 'light', 'and the lightest one it makes');

    /*
     * Mid grey counts as dark, and that is not arbitrary: it is the side that
     * needs the lighter thing drawn on it. Cross-checked against the function
     * the line came from rather than restated — on a ground this calls dark,
     * `readableInk` moves a colour *up*, toward white.
     */
    assert.equal(groundTone('#808080'), 'dark');
    assert.ok(
      luminance(readableInk('#333333', '#808080')) > luminance('#333333'),
      'ink goes up on a ground this calls dark',
    );
  });

  test('an accent-coloured rail is judged by its own colour, not by the theme', () => {
    // A workspace may paint the rail with its accent (ADR-0122), so the rail of
    // a light instance can be the dark surface on the screen. That is the whole
    // reason this is measured per surface rather than read off `data-theme`.
    assert.equal(groundTone('#1d4ed8'), 'dark', 'a deep blue rail');
    assert.equal(groundTone('#fde68a'), 'light', 'a pale yellow one');
  });

  test('a theme emits four derivations and one chosen colour', () => {
    const properties = themeProperties(sanitiseTheme({ accent: '#ffff00' }));
    assert.equal(properties['--accent'], '#ffff00');
    for (const name of [
      '--sone-theme-accent-on-light',
      '--sone-theme-accent-on-dark',
      '--sone-theme-accent-line-on-light',
      '--sone-theme-accent-line-on-dark',
    ]) {
      assert.match(properties[name] ?? '', /^#[0-9a-f]{6}$/, name);
    }
  });
});
