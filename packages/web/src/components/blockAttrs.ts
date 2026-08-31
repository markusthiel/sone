/**
 * SONE web — the presentation attributes a node view has to carry itself.
 *
 * Width, alignment and colour are attributes every block has, and the stylesheet
 * reads them from `data-width`, `data-align` and `data-color` — which `toDOM`
 * writes. A node view does not use `toDOM`: it builds its own element, so unless
 * it copies these across, the block simply has no width setting as far as CSS is
 * concerned.
 *
 * That is why "Column / Wide / Full page" did nothing for a video or a table
 * while working perfectly for an image: an image is drawn by `toDOM` and the
 * three views that draw themselves were each missing the same four lines.
 *
 * Written once, here, because it was already missing three times.
 */

/** Copy a block's presentation attributes onto the element a node view drew. */
export function applyBlockAttrs(dom: HTMLElement, attrs: Record<string, unknown>): void {
  // The names are the schema's (BLOCK_ATTRS), and the values are whatever the
  // document holds — so anything that is not a string clears the attribute
  // rather than becoming "null" or "undefined" in the DOM.
  const set = (name: string, value: unknown): void => {
    if (typeof value === 'string' && value !== '') dom.setAttribute(name, value);
    else dom.removeAttribute(name);
  };

  set('data-width', attrs['width']);
  set('data-align', attrs['align']);
  set('data-color', attrs['color']);
  // The block id, which the gutter and a link target look for.
  set('data-block-id', attrs['id']);
}
