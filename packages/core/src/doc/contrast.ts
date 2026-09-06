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

/**
 * The worst ground the interface can put text on, per scheme (ADR-0136).
 *
 * Not a colour the stylesheet declares — a **bound** on the ones it computes.
 * Every surface is the workspace's tint mixed into the ramp, so the darkest
 * light surface and the lightest dark surface both depend on a colour somebody
 * picks out of a colour input. `web`'s `contrast.test.ts` walks the real
 * surfaces over the whole colour cube and asserts none is worse than these, so
 * this is a claim held against the stylesheet rather than a copy of it.
 *
 * Deliberately a shade past the real worst in each direction. A ground darker
 * than any real light surface makes the derived colour darker than it needs to
 * be, which is the harmless way to be wrong.
 */
export const WORST_GROUND = { light: '#d0cec9', dark: '#3a3a37' } as const;

/**
 * The same colour, moved only as far as it must be to be read on this ground.
 *
 * **An accent has two jobs.** It fills a button, where `readableOn` computes the
 * text that goes on top of it; and it *is* text — a link, an active icon — on
 * one of the page's own surfaces, where nothing computed anything. One value
 * satisfies both only by luck, and a workspace picks that value out of a colour
 * input (ADR-0136).
 *
 * The direction is the ground's, not the colour's: on a light ground the only
 * way to gain contrast is down, and on a dark ground it is up. Down is a scale
 * of the channels, which keeps the hue exactly; up is a mix toward white, which
 * washes the hue out a little and is the operation that always terminates —
 * scaling up cannot move a colour whose channel is already at 255.
 *
 * A colour that already reads is returned untouched, which is the ordinary case:
 * a brand colour somebody chose to be visible usually is.
 */
export function readableInk(color: string, ground: string): string {
  if (contrastRatio(color, ground) >= AA.text) return color;

  const start = parseHex(color);
  const towardsDark = luminance(ground) > luminance('#808080');
  /*
   * Rounded inside the search, not after it.
   *
   * The channels are floats and the answer is eight bits, so a search on the
   * floats finds the exact crossing and then `toHex` rounds *back across it* —
   * `#2f7d6f` came out at 4.47:1, under the floor the search had just cleared.
   * Judging the value that will actually be returned is the whole fix.
   */
  const at = (amount: number): string =>
    toHex(
      towardsDark
        ? { r: start.r * (1 - amount), g: start.g * (1 - amount), b: start.b * (1 - amount) }
        : mixSrgb('#ffffff', amount * 100, start),
    );

  // Binary search for the smallest move that reaches AA. Both ends are
  // reachable — black on a light ground and white on a dark one are the maxima
  // — so this always converges, and twenty steps is finer than eight bits.
  let low = 0;
  let high = 1;
  for (let step = 0; step < 20; step++) {
    const middle = (low + high) / 2;
    if (contrastRatio(at(middle), ground) >= AA.text) high = middle;
    else low = middle;
  }
  return at(high);
}
