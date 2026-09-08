/**
 * SONE web — saying *this is the one you asked for* (ADR-0156, ADR-0166).
 *
 * Two places take somebody to a thing and then have to point at it: a PDF mark
 * revealed from the comments panel, and a block revealed from the right
 * sidebar. They light it differently — the mark is redrawn from state the
 * viewer holds, the block is an element already in the document — but **how
 * long a moment lasts** is one decision, and it was written down twice the
 * moment the second one arrived.
 */

/**
 * How long the found state holds.
 *
 * Long enough to find with your eyes, short enough to be over before the next
 * ask: a thing that stayed lit would make the *second* jump look like nothing
 * happened, which is the fault this whole mechanism exists to avoid.
 */
export const FOUND_MS = 1600;

/** The timeout for the element currently lit, so a second ask can end the first. */
let letGo: ReturnType<typeof setTimeout> | null = null;
let lit: HTMLElement | null = null;

/**
 * Mark an element as the one somebody asked for, for a moment.
 *
 * The attribute rather than an inline style, because what *found* looks like is
 * the stylesheet's decision — including the part that matters, which is that
 * the ring holds for a reader who has asked for less motion and only the pulse
 * goes (ADR-0156).
 *
 * ## It can be cut short, and that is acceptable
 *
 * The element belongs to ProseMirror, which owns its DOM: a node re-render
 * while the flash is on takes the attribute with it. That needs a keystroke in
 * that block during the second and a half after pressing something in a panel,
 * and the cost is a flash that ends early — against a decoration plugin and a
 * transaction for something that is not part of the document.
 */
export function showAsFound(element: HTMLElement): void {
  if (letGo) clearTimeout(letGo);
  // Explicitly, rather than trusting the timeout that is about to be cleared:
  // two jumps in quick succession must leave exactly one thing lit.
  if (lit && lit !== element) delete lit.dataset['found'];

  lit = element;
  element.dataset['found'] = '';
  letGo = setTimeout(() => {
    delete element.dataset['found'];
    if (lit === element) lit = null;
    letGo = null;
  }, FOUND_MS);
}
