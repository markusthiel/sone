/**
 * SONE editor — the symbol a divider can carry (ADR-0189).
 *
 * The same arrangement as the callout tones: one drawing per name, as path
 * data on a 24×24 grid, stroke 1.5, round caps, drawn into the block's DOM by
 * `toDOM` and reused by the web package for the menu that offers them. The
 * twelve callout tones are ornaments as well and are not drawn twice.
 */

import { CALLOUT_TONES, type DividerOrnament } from '@sone/core';

import { CALLOUT_TONE_PATHS, SVG_NS } from './calloutTones.js';

const OWN: Record<Exclude<DividerOrnament, (typeof CALLOUT_TONES)[number]>, readonly string[]> = {
  // A filled feel from a tight circle drawn twice over.
  dot: ['M12 12h.01', 'M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'],
  diamond: ['M12 4l7 8-7 8-7-8z'],
  ellipsis: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  // Three stars in the printer's triangle.
  asterism: ['M12 5v5M9.8 6.3l4.4 2.4M14.2 6.3 9.8 8.7', 'M6 14v5M3.8 15.3l4.4 2.4M8.2 15.3l-4.4 2.4', 'M18 14v5M15.8 15.3l4.4 2.4M20.2 15.3l-4.4 2.4'],
  circle: ['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16z'],
  square: ['M5 5h14v14H5z'],
  leaf: ['M5 19C5 10 10 5 19 5c0 9-5 14-14 14z', 'M5 19 15 9'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z'],
  sun: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  wave: ['M3 12c2.5-3 4.5-3 7 0s4.5 3 7 0 3-2 4 0', 'M3 17c2.5-3 4.5-3 7 0s4.5 3 7 0 3-2 4 0'],
  flower: ['M12 12m-2.5 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0', 'M12 3.5a3 3 0 0 1 0 6 3 3 0 0 1 0-6zM12 14.5a3 3 0 0 1 0 6 3 3 0 0 1 0-6zM3.5 12a3 3 0 0 1 6 0 3 3 0 0 1-6 0zM14.5 12a3 3 0 0 1 6 0 3 3 0 0 1-6 0z'],
  heart: ['M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.6 12 20 12 20z'],
  coffee: ['M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z', 'M16 10h1.5a2 2 0 0 1 0 4H16', 'M8 5.5c0 1 1 1 1 2M11.5 5.5c0 1 1 1 1 2'],
  anchor: ['M12 8v13', 'M12 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', 'M5 13a7 7 0 0 0 14 0', 'M3 13h4M17 13h4'],
  quill: ['M20 4c-7 0-12 5-13 13', 'M20 4c0 7-5 12-13 13', 'M4 20l3-3'],
  scissors: ['M6 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M8.2 8.2 20 17M8.2 15.8 20 7', 'M8.2 8.2l3.8 3.8'],
  arrow: ['M4 12h16', 'M14 6l6 6-6 6'],
};

export const DIVIDER_ORNAMENT_PATHS: Record<DividerOrnament, readonly string[]> = {
  ...OWN,
  ...CALLOUT_TONE_PATHS,
};

/**
 * The symbol as a ProseMirror DOM spec, for the divider's `toDOM`.
 *
 * Sits on the line and covers it with the page's background (CSS), so the
 * line appears to pause for the symbol rather than run through it.
 */
export function dividerMarkSpec(ornament: DividerOrnament): unknown[] {
  return [
    'span',
    { class: 'divider-mark', contenteditable: 'false', 'aria-hidden': 'true' },
    [
      `${SVG_NS} svg`,
      {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        // Heavier than in the menu, like the callout's symbol: on a line it is
        // the only thing there is to see.
        'stroke-width': '1.75',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      ...DIVIDER_ORNAMENT_PATHS[ornament].map((d) => [`${SVG_NS} path`, { d }]),
    ],
  ];
}
