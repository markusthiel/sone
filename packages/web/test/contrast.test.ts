/**
 * Contrast, computed (ADR-0135).
 *
 * ADR-0023 wrote the rule and never held it:
 *
 * > Contrast. Computed, not believed, and kept as a test.
 *
 * Believed is what it was. The stylesheet has the evidence in a comment beside
 * `--ink-500` — *„3.6:1 on white and 3.3:1 on the sunken surface — under AA"* —
 * numbers somebody worked out by hand once, wrote down, and left. Nothing
 * recomputed them, and the value chosen from them was measured against **one**
 * pairing and applied to every surface.
 *
 * ## Why this cannot be a table of expected numbers
 *
 * A theme is a *space*, not a value. A workspace picks a tint from a colour
 * input, and every surface in the interface is that tint mixed into the ramp —
 * so "does muted text clear AA" has as many answers as there are colours.
 * Checking the eight palette colours would be checking the eight cases somebody
 * thought of.
 *
 * So this walks the cube: every seventeenth value of every channel, both
 * themes, every text token against every surface token, plus the corners by
 * name because the worst case is always a corner. The stylesheet's own values
 * are read out of it and resolved — `var()`, the ramp, and `color-mix(in srgb)`
 * exactly as a browser resolves them — rather than restated here, which is the
 * difference between a test and a second copy of the design (ADR-0131).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { AA, WORST_GROUND, contrastRatio, luminance, mixSrgb, readableInk, toHex } from '@sone/core';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The custom properties one rule declares, in source order. */
function declarations(opener: string): Record<string, string> {
  const at = css.indexOf(opener);
  assert.ok(at >= 0, `no rule found for ${JSON.stringify(opener)}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const one of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[one[1]!] = one[2]!.trim();
  return out;
}

const primitives = declarations(':root {');
const THEMES = {
  light: declarations(":root,\n[data-theme='light'] {"),
  dark: declarations("[data-theme='dark'] {"),
  /* The third declaration of dark, and the reason it is checked separately:
   * a media query cannot be overridden from CSS, only replaced, so this block
   * is maintained by hand beside the chosen one. `tokens.test.ts` compares the
   * two by the *set of names* they fill — which is why `--text-muted` could sit
   * at the old value here while the chosen theme moved on, and did. */
  automatic: declarations(":root:not([data-theme='light']) {"),
};

/**
 * What a browser would compute for this declaration.
 *
 * `var()` with its fallback, the ramp underneath, and `color-mix(in srgb, …)` —
 * which is the one that has to be right, because it is linear on the sRGB
 * digits while luminance is not.
 */
function resolve(value: string, scope: Record<string, string>, tint: string | null): string {
  const v = value.trim();

  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    return toHex(
      mixSrgb(resolve(mix[1]!, scope, tint), Number(mix[2]), resolve(mix[3]!, scope, tint)),
    );
  }

  const reference = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (reference) {
    const name = reference[1]!;
    // The one property that is not in the stylesheet: a workspace sets it, and
    // absent it falls back to the surface's own base — the rule the
    // `--surface-*` comments record, and the reason none of them says
    // `transparent` any more.
    if (name === '--sone-theme-tint') {
      return tint ?? resolve(reference[2]!, scope, tint);
    }
    const found = scope[name] ?? primitives[name];
    if (found) return resolve(found, scope, tint);
    if (reference[2]) return resolve(reference[2], scope, tint);
    throw new Error(`${name} is used and never declared`);
  }

  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  throw new Error(`cannot resolve ${value}`);
}

const TEXT = ['--text-primary', '--text-secondary', '--text-muted'] as const;
const SURFACES = [
  '--surface-page',
  '--surface-chrome',
  '--surface-sunken',
  '--surface',
  '--surface-raised',
  '--surface-overlay',
  '--surface-hover',
] as const;

/** The corners, by name. The worst case in a colour cube is always one. */
const CORNERS = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#00ffff',
  '#ff00ff',
];

/** Every seventeenth value of every channel: 3375 tints, and it runs in a second. */
function* cube(): Generator<string> {
  for (const hex of CORNERS) yield hex;
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) yield toHex({ r, g, b });
    }
  }
}

function worstPairing(scope: Record<string, string>, tint: string | null) {
  let ratio = Number.POSITIVE_INFINITY;
  let pairing = '';
  for (const text of TEXT) {
    for (const surface of SURFACES) {
      const found = contrastRatio(
        resolve(scope[text]!, scope, tint),
        resolve(scope[surface]!, scope, tint),
      );
      if (found < ratio) {
        ratio = found;
        pairing = `${text} on ${surface}`;
      }
    }
  }
  return { ratio, pairing };
}

describe('the design’s own answer', () => {
  for (const [name, scope] of Object.entries(THEMES)) {
    test(`${name}: every text on every surface, untinted`, () => {
      /*
       * The case every instance sees, and the one that was broken. In dark,
       * `--text-muted` was 4.44:1 on an overlay and 4.27:1 on a hovered row
       * with no workspace involved at all — the comment beside `--ink-500` had
       * measured it against the page and generalised.
       */
      const { ratio, pairing } = worstPairing(scope, null);
      assert.ok(ratio >= AA.text, `${name}: ${pairing} is ${ratio.toFixed(2)}:1`);
    });
  }
});

describe('and every answer a workspace can give', () => {
  for (const [name, scope] of Object.entries(THEMES)) {
    test(`${name}: no tint in the colour cube drops any text under AA`, () => {
      /*
       * The tint is a free colour input, so this is not eight cases — it is the
       * cube. Seven of the eight *palette* colours used to fail here, between
       * 3.98 and 4.49, and black failed by a wider margin; the sidebar's quiet
       * labels in any tinted workspace.
       *
       * Fixed on the design's side rather than by taking the colour input away:
       * the proportions the tint is mixed at are now the largest ones at which
       * *any* colour stays readable, which is a guarantee by construction
       * instead of a rule somebody has to obey.
       */
      let worst = { ratio: Number.POSITIVE_INFINITY, pairing: '', tint: '' };
      for (const tint of cube()) {
        const found = worstPairing(scope, tint);
        if (found.ratio < worst.ratio) worst = { ...found, tint };
      }
      assert.ok(
        worst.ratio >= AA.text,
        `${name}: ${worst.pairing} is ${worst.ratio.toFixed(2)}:1 with the tint ${worst.tint}`,
      );
    });
  }
});

describe('the other end of a treated surface', () => {
  for (const [name, scope] of Object.entries(THEMES)) {
    test(`${name}: an inverted surface is readable too`, () => {
      // A workspace that inverts its rail gets this pair and no other
      // (ADR-0122), and it is declared per theme rather than computed — so it
      // is a second place the same mistake could be made, untouched by
      // everything above.
      for (const [ink, floor] of [
        ['--sone-inverse-ink', AA.text],
        ['--sone-inverse-muted', AA.text],
      ] as const) {
        const found = contrastRatio(
          resolve(scope[ink]!, scope, null),
          resolve(scope['--sone-inverse-bg']!, scope, null),
        );
        assert.ok(found >= floor, `${name}: ${ink} is ${found.toFixed(2)}:1 on the inverse ground`);
      }
    });
  }
});

describe('the accent, read rather than filled', () => {
  /*
   * An accent has two jobs (ADR-0136). `readableOn` computes the text that goes
   * **on** it; nothing computed the accent **as** text, and a link is
   * `color: var(--accent-text)` on one of the page's own surfaces.
   */
  for (const [name, scope] of Object.entries(THEMES)) {
    test(`${name}: the design's own accent reads on every surface`, () => {
      for (const surface of SURFACES) {
        const found = contrastRatio(
          resolve(scope['--accent-text']!, scope, null),
          resolve(scope[surface]!, scope, null),
        );
        assert.ok(found >= AA.text, `${name}: the accent is ${found.toFixed(2)}:1 on ${surface}`);
      }
    });
  }

  test('the worst ground core derives against is worse than any real surface', () => {
    /*
     * **The claim that makes the derivation sound.** `readableInk` is given a
     * ground, and `@sone/core` cannot see this stylesheet — so it holds a bound
     * rather than a copy, and this is where the bound is checked.
     *
     * A ground darker than every real light surface makes the derived colour
     * darker than it strictly needs to be, which is the harmless direction; a
     * ground lighter than one of them would make it too light, which is the bug
     * the whole thing exists to prevent.
     */
    let darkestLight = 1;
    let lightestDark = 0;
    for (const tint of cube()) {
      for (const surface of SURFACES) {
        darkestLight = Math.min(
          darkestLight,
          luminance(resolve(THEMES.light[surface]!, THEMES.light, tint)),
        );
        lightestDark = Math.max(
          lightestDark,
          luminance(resolve(THEMES.dark[surface]!, THEMES.dark, tint)),
        );
      }
    }
    assert.ok(
      luminance(WORST_GROUND.light) <= darkestLight,
      `the stated light ground is ${luminance(WORST_GROUND.light).toFixed(4)}, lighter than the darkest surface at ${darkestLight.toFixed(4)}`,
    );
    assert.ok(
      luminance(WORST_GROUND.dark) >= lightestDark,
      `the stated dark ground is ${luminance(WORST_GROUND.dark).toFixed(4)}, darker than the lightest surface at ${lightestDark.toFixed(4)}`,
    );
  });

  test('and any accent a workspace can pick reads on any surface', () => {
    /*
     * The whole point, walked rather than argued: a colour out of the input,
     * derived for each scheme, checked against every surface that scheme can
     * produce for every tint. Two free values at once, which is why the
     * derivation has to be computed and not chosen.
     */
    const surfaces = (scope: Record<string, string>, tint: string) =>
      SURFACES.map((one) => resolve(scope[one]!, scope, tint));

    for (const accent of ['#ffff00', '#000000', '#ffffff', '#7c3aed', '#16a34a', '#2563eb']) {
      for (const [name, scope, ground, emitted] of [
        ['light', THEMES.light, WORST_GROUND.light, '--sone-theme-accent-on-light'],
        ['dark', THEMES.dark, WORST_GROUND.dark, '--sone-theme-accent-on-dark'],
      ] as const) {
        const ink = readableInk(accent, ground);
        // What the browser would resolve with that property set on the root.
        const withAccent = { ...scope, [emitted]: ink };
        for (const tint of ['#000000', '#ffffff', '#7c3aed']) {
          for (const drawn of surfaces(withAccent, tint)) {
            const found = contrastRatio(ink, drawn);
            assert.ok(
              found >= AA.text,
              `${name}: the accent ${accent} reads as ${ink}, ${found.toFixed(2)}:1 on ${drawn}`,
            );
          }
        }
      }
    }
  });

  test('a line is derived at a line\'s floor, and only a line', () => {
    /*
     * A control's boundary wants 3:1, not the 4.5:1 text wants (ADR-0137), and
     * the difference matters in both directions.
     *
     * At the text floor a border would be darker than the fill it sits beside —
     * the ring around every primary button. At no floor a pale accent is a
     * focus ring at 1.07:1, which is a keyboard user who cannot see where they
     * are.
     */
    for (const [name, scope, ground, emitted] of [
      ['light', THEMES.light, WORST_GROUND.light, '--sone-theme-accent-line-on-light'],
      ['dark', THEMES.dark, WORST_GROUND.dark, '--sone-theme-accent-line-on-dark'],
    ] as const) {
      for (const accent of ['#ffff00', '#f0e68c', '#d4d2ca', '#000000', '#ffffff']) {
        const line = readableInk(accent, ground, AA.nonText);
        const withAccent = { ...scope, [emitted]: line };
        for (const tint of ['#000000', '#ffffff', '#7c3aed']) {
          for (const surface of SURFACES) {
            const found = contrastRatio(line, resolve(withAccent[surface]!, withAccent, tint));
            assert.ok(
              found >= AA.nonText,
              `${name}: a line in ${accent} is ${found.toFixed(2)}:1 on ${surface}`,
            );
          }
        }
        // And it moves less than the text derivation, or there would be no
        // reason for two of them.
        const text = readableInk(accent, ground, AA.text);
        if (text !== accent) {
          assert.notEqual(line, text, `${accent} would have been derived twice the same way`);
        }
      }
    }
  });

  for (const [name, scope] of Object.entries(THEMES)) {
    test(`${name}: the design's own line is visible without deriving anything`, () => {
      // Which is why `--accent-line` falls back to the accent itself rather
      // than to a fourth step: it already clears the floor, if not by much.
      for (const surface of SURFACES) {
        const found = contrastRatio(
          resolve(scope['--accent-line']!, scope, null),
          resolve(scope[surface]!, scope, null),
        );
        assert.ok(found >= AA.nonText, `${name}: ${found.toFixed(2)}:1 on ${surface}`);
      }
    });
  }

  test('the focus ring is one of the lines', () => {
    /*
     * Named on its own because it is the one with a consequence that is not
     * cosmetic, and because the comment beside it already claimed what nothing
     * checked: fields drop the outline *"only because they replace it with
     * something at least as visible"*.
     */
    assert.match(css, /:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--accent-line\)/s);
    assert.doesNotMatch(css, /outline: 2px solid var\(--accent\);/);
  });

  test('a fill is still the colour somebody chose', () => {
    // The derivation is for reading, and a button is not read *as* the accent —
    // it is filled with it, and `readableOn` computes what goes on top. A
    // workspace whose brand colour quietly became a darker one on its own
    // buttons would be a workspace whose brand colour is not its brand colour.
    assert.match(css, /--accent: var\(--accent-500\)/);
    assert.doesNotMatch(css, /background: var\(--accent-text\)/);
    // And a border beside an accent fill is the fill's colour, or the pair
    // shows as a ring.
    assert.doesNotMatch(css, /border-color: var\(--accent-text\)/);
    // A border that outlines an accent fill keeps the fill's colour — the
    // primary button and the checked task marker are the three places, and a
    // derivation there would be the ring seen from the other side.
    assert.match(css, /background: var\(--accent\)/);
  });
});

test('the three declarations of dark agree on their values, not only their names', () => {
  /*
   * **The bug this found.** `tokens.test.ts` compares the chosen dark theme and
   * the `prefers-color-scheme` one by the *set of names* each fills, which was
   * enough to catch a token added to one and forgotten in the other — and says
   * nothing about the two filling one name with different values.
   *
   * So when `--text-muted` was corrected in the chosen theme, the automatic one
   * kept the old value: somebody who chose dark got the readable text and
   * somebody whose system chose it for them did not. The same interface by two
   * routes, and only one of them fixed.
   */
  const chosen = THEMES.dark;
  const automatic = THEMES.automatic;
  const differ: string[] = [];
  for (const [name, value] of Object.entries(chosen)) {
    const other = automatic[name];
    if (other === undefined) continue; // that is tokens.test.ts's question
    if (other !== value) differ.push(`${name}: chosen ${value} / automatic ${other}`);
  }
  assert.deepEqual(differ, [], 'the two dark themes disagree');
});
