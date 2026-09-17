/**
 * SONE editor — the symbol of each callout tone (ADR-0188).
 *
 * A toned callout shows its symbol at the end of the box, in the tone's colour.
 * The symbol is part of what the tone *means* — a triangle is a warning before
 * anybody reads the word — so it is drawn into the block's DOM by `toDOM`
 * rather than pasted on by the stylesheet: a stylesheet that carried twelve
 * SVG data URIs would be a second copy of every drawing, and the menus that
 * offer the tones would be a third.
 *
 * One drawing per tone, as path data on a 24×24 grid, stroke 1.5, round caps
 * — the conventions of `icons.tsx` in the web package, which builds its menu
 * icons from these same paths. One subject, one symbol.
 */

import type { CalloutTone } from '@sone/core';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Path data per tone. Several paths where one stroke cannot draw the shape. */
export const CALLOUT_TONE_PATHS: Record<CalloutTone, readonly string[]> = {
  // A sheet with a folded corner: something written down.
  note: ['M5 3.5h10l4 4v13H5z', 'M15 3.5v4h4'],
  // The i in a circle.
  info: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M12 11v5', 'M12 8h.01'],
  // A bulb.
  tip: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1.3-1 2.5H9c0-1.2-.3-1.9-1-2.5A6 6 0 0 1 12 3z'],
  // The triangle with a mark in it.
  warning: ['M12 3.5 21 19.5H3z', 'M12 10v4', 'M12 17h.01'],
  // A cross in a circle: refused.
  error: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M9 9l6 6', 'M15 9l-6 6'],
  // A bell.
  alarm: ['M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z', 'M10.5 19a1.8 1.8 0 0 0 3 0'],
  // An exclamation mark, on its own: the box is the frame.
  exclaim: ['M12 4.5v10', 'M12 19h.01'],
  // A question mark in a circle.
  question: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7v.5', 'M12 17h.01'],
  // A tick in a circle.
  success: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M8.5 12.5l2.5 2.5 4.5-5'],
  // A pencil: a remark in the margin.
  memo: ['M4.5 19.5h4L20 8a2.12 2.12 0 0 0-3-3L5.5 16.5Z', 'm15.5 6.5 3 3'],
  // Brackets: the shape code examples come in.
  example: ['M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2', 'M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2'],
  // Two closing quotation marks.
  quote: [
    'M10 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1c0 1.5-1 2.5-2 3',
    'M20 7h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1c0 1.5-1 2.5-2 3',
  ],
};

/**
 * The symbol as a ProseMirror DOM spec, for `toDOM`.
 *
 * Namespaced tag names, which is how a DOM spec asks for an SVG element; the
 * children inherit the namespace. `contenteditable=false` so the caret cannot
 * enter it, and `aria-hidden` because the tone is already in the block's
 * `data-tone` — read out, the symbol would be the word twice.
 */
export function calloutMarkSpec(tone: CalloutTone): unknown[] {
  return [
    'span',
    { class: 'callout-mark', contenteditable: 'false', 'aria-hidden': 'true' },
    [
      `${SVG_NS} svg`,
      {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        // A touch heavier than the menu icons: the symbol is the only thing in
        // the box that carries the tone at full strength, and it should read.
        'stroke-width': '1.75',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      ...CALLOUT_TONE_PATHS[tone].map((d) => [`${SVG_NS} path`, { d }]),
    ],
  ];
}
