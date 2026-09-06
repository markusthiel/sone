/**
 * SONE — contrast, computed (ADR-0135).
 *
 * ADR-0023 wrote the rule and never held it:
 *
 * > Contrast. Computed, not believed, and kept as a test.
 *
 * Believed is what it was. The evidence is in the stylesheet, beside
 * `--ink-500`:
 *
 * > Secondary text in the light theme used --ink-400, which is 3.6:1 on white
 * > and 3.3:1 on the sunken surface — under AA, on every quiet label in the
 * > interface.
 *
 * Somebody worked those numbers out by hand, once, wrote them in a comment and
 * moved on. Nothing recomputes them, so the next value chosen by eye is the
 * same mistake with nobody to notice — and a theme is a *space* of values, not
 * one: a workspace sets a tint, an accent and eight palette colours, and every
 * combination of those is a pairing somebody has to read.
 *
 * This module is the arithmetic. The test that uses it walks that space.
 *
 * ## Two colour operations, and they are not the same one
 *
 * **Luminance is not linear in sRGB.** The channel values have to be
 * linearised before they are weighted, which is why `contrastRatio` cannot be
 * done on the hex digits.
 *
 * **`color-mix(in srgb, …)` is linear in sRGB**, on exactly those hex digits,
 * with no linearisation at all. Mixing in the linear-light space would be a
 * different colour, and the stylesheet's surfaces are mixed by the browser in
 * `srgb` — so `mixSrgb` has to match what the browser does rather than what
 * the luminance formula does.
 */

/** A colour as three 0–255 channels. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * `#abc`, `#aabbcc`, with or without the hash.
 *
 * Throws rather than returning a default: every caller here is reading a value
 * out of the stylesheet or out of a stored theme, and a silent black would turn
 * "this colour is unparseable" into "this colour has excellent contrast".
 */
export function parseHex(color: string): Rgb {
  const hex = color.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${color}`);
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** The sRGB relative luminance from WCAG 2. */
export function luminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? parseHex(color) : color;
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The WCAG contrast ratio, 1 to 21.
 *
 * Order does not matter — the lighter of the two goes on top by construction,
 * so a caller cannot get a different answer by naming the pair the other way
 * round.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const one = luminance(a);
  const two = luminance(b);
  const light = Math.max(one, two);
  const dark = Math.min(one, two);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * `color-mix(in srgb, top <percent>%, bottom)`.
 *
 * Componentwise and linear on the sRGB values, which is what `in srgb` means.
 * Opaque colours only: every mix in this stylesheet is between two opaque
 * colours, and the one time that was not true it was the bug the `--surface-*`
 * comments record — `transparent` is `rgb(0 0 0 / 0)`, so mixing with it pulls
 * towards black *and* takes the alpha down with it.
 */
export function mixSrgb(top: string | Rgb, percent: number, bottom: string | Rgb): Rgb {
  const a = typeof top === 'string' ? parseHex(top) : top;
  const b = typeof bottom === 'string' ? parseHex(bottom) : bottom;
  const p = percent / 100;
  return {
    r: a.r * p + b.r * (1 - p),
    g: a.g * p + b.g * (1 - p),
    b: a.b * p + b.b * (1 - p),
  };
}

/**
 * The WCAG minima, named so a call site says which one it means.
 *
 * `text` is AA for body copy. `large` is AA for text at 18.66px bold or 24px
 * plain. `nonText` is AA for a control's boundary or a graphical part — a
 * border, a focus ring, the line under a field.
 */
export const AA = { text: 4.5, large: 3, nonText: 3 } as const;
