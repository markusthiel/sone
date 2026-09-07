/**
 * SONE web — reading a colour the browser has computed.
 *
 * Its own home because there are two callers now and neither is the other's:
 * `useGroundTone` asks which of two marks a surface should carry (ADR-0149),
 * and the PDF viewer asks what colour to write a highlight into a file with
 * (ADR-0154). One reader, because the two forms below are a fact about
 * browsers rather than about either question.
 */

/**
 * A computed background colour, in the two forms a browser actually returns.
 *
 * **Measured, not assumed, and the first version was wrong because of it.** It
 * read `rgb(16, 16, 16)` and took any three numbers as channels — which is
 * right until a surface is a `color-mix` (ADR-0135), and then Chrome computes
 * `color(srgb 0.980392 0.972549 0.956863)`. Those are the same three channels
 * on a scale of one, so the near-white rail every instance has by default was
 * read as near-black and would have been given the mark drawn for dark
 * surfaces.
 *
 * The scale comes from the function name rather than from the size of the
 * numbers. A guess like "all three are below one, so it must be the 0–1 form"
 * gets `rgb(1, 1, 1)` — nearly black — exactly backwards.
 *
 * Anything else returns null, which the caller reads as "keep looking, then
 * assume the page's own light ground": a form nobody has seen is not a licence
 * to invent a colour for it.
 */
export function parseComputed(
  value: string,
): { r: number; g: number; b: number; alpha: number } | null {
  const numbers = (value.match(/[\d.]+/g) ?? []).map(Number);
  if (numbers.length < 3) return null;
  const [first, second, third, fourth] = numbers as [number, number, number, number?];

  if (/^rgba?\(/.test(value)) {
    return { r: first, g: second, b: third, alpha: fourth ?? 1 };
  }
  /*
   * `color(srgb r g b / a)`, and any other space written the same way.
   *
   * Channels 0–1. A wider space than sRGB is read as though it were sRGB, which
   * is wrong by a few percent of saturation and cannot change the answer to
   * "light or dark" — the alternative is a colour-space conversion in a hook
   * that decides between two pictures.
   */
  if (value.startsWith('color(')) {
    return { r: first * 255, g: second * 255, b: third * 255, alpha: fourth ?? 1 };
  }
  return null;
}

/**
 * A custom property, resolved to an actual colour (ADR-0154).
 *
 * `getComputedStyle(el).getPropertyValue('--accent')` hands back the *token* —
 * which in this interface is routinely `var(--sone-base-accent)` or a
 * `color-mix(…)` that has not been performed. A custom property has no computed
 * colour, because nothing has asked it to be one.
 *
 * So something is asked to be one: a hidden element is given the property as its
 * `color`, which does compute, and the answer is read off that. The element is
 * placed inside the subtree being asked about, because that is where the
 * property may have been redefined — a workspace treats the rail, and the same
 * name means one colour there and another in the page (ADR-0122).
 */
export function resolvedColor(within: Element, property: string): { r: number; g: number; b: number } | null {
  const probe = document.createElement('span');
  probe.style.color = `var(${property})`;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.setAttribute('aria-hidden', 'true');
  within.append(probe);
  try {
    const parsed = parseComputed(getComputedStyle(probe).color);
    return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : null;
  } finally {
    probe.remove();
  }
}
