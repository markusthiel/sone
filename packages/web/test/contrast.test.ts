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

import { AA, contrastRatio, mixSrgb, toHex } from '@sone/core';

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
