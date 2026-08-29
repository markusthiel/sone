/**
 * SONE core — a workspace's defaults for how elements look.
 *
 * The rules for what a theme may say, kept here so the server that validates it
 * and the client that renders it cannot disagree about the answer.
 *
 * ## Steps, not values
 *
 * A size is a step on a scale and not a pixel count; a colour is a palette name
 * and not a hex value. Free numbers produce a heading that no longer relates to
 * the body text underneath it, and the person who set it cannot see that is
 * what happened — the scale exists precisely so those relationships hold. A
 * stored hex would also stop being right the moment somebody switched theme.
 *
 * ## It fills gaps, it does not override
 *
 * A block attribute of `null` means "as the design decides" (ADR-0021), and
 * this is what decides. A block carrying its own value keeps it. Nothing here
 * is written into a document, and a workspace with no theme renders the way
 * every workspace rendered before themes existed.
 */

/** The kinds of element a theme can speak about. */
export const THEMED_ELEMENTS = [
  'heading1',
  'heading2',
  'heading3',
  'body',
  'quote',
  'callout',
  'code',
  'list',
] as const;

export type ThemedElement = (typeof THEMED_ELEMENTS)[number];

/**
 * Size steps, relative to the element's own default.
 *
 * Zero is "as it is now", so a theme that sets only a colour leaves every size
 * alone and a theme reset to zero is indistinguishable from no theme. The range
 * is deliberately short: past a few steps a heading stops being a heading and
 * starts being a banner.
 */
export const SIZE_STEPS = [-2, -1, 0, 1, 2, 3] as const;
export type SizeStep = (typeof SIZE_STEPS)[number];

/** Spacing steps above and below, in the same spirit. */
export const SPACE_STEPS = [0, 1, 2, 3] as const;
export type SpaceStep = (typeof SPACE_STEPS)[number];

/**
 * The palette.
 *
 * The same names as tags, select options and block colours, so a workspace has
 * one vocabulary for colour rather than four.
 */
export const THEME_COLORS = [
  'grey',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

export interface ElementTheme {
  size?: SizeStep;
  color?: ThemeColor;
  spaceAbove?: SpaceStep;
  spaceBelow?: SpaceStep;
}

export type WorkspaceTheme = Partial<Record<ThemedElement, ElementTheme>>;

const inList = <T>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);

/**
 * Keep only what a theme is allowed to say.
 *
 * Unknown elements and unusable values are dropped rather than rejected. A
 * theme arrives from a form, and one stale field should not cost somebody the
 * rest of their settings — the same reasoning as a collection view naming a
 * deleted column.
 *
 * Returns a new object; the input is never modified.
 */
export function sanitiseTheme(input: unknown): WorkspaceTheme {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const out: WorkspaceTheme = {};

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!inList(THEMED_ELEMENTS, key)) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const entry = raw as Record<string, unknown>;
    const element: ElementTheme = {};

    if (inList(SIZE_STEPS, entry['size'])) element.size = entry['size'];
    if (inList(THEME_COLORS, entry['color'])) element.color = entry['color'];
    if (inList(SPACE_STEPS, entry['spaceAbove'])) element.spaceAbove = entry['spaceAbove'];
    if (inList(SPACE_STEPS, entry['spaceBelow'])) element.spaceBelow = entry['spaceBelow'];

    // An element with nothing usable left is omitted rather than stored empty,
    // so "has a theme" and "has settings" mean the same thing.
    if (Object.keys(element).length > 0) out[key] = element;
  }

  return out;
}

/**
 * The custom properties a theme resolves to.
 *
 * Returned as a plain map so the caller decides where to put them; nothing here
 * touches the document. A property is emitted only for a value the theme
 * actually sets, so everything else keeps falling through to the stylesheet's
 * own answer — which is what makes a theme a set of gaps filled rather than a
 * replacement design.
 */
export function themeProperties(theme: WorkspaceTheme): Record<string, string> {
  const properties: Record<string, string> = {};

  for (const element of THEMED_ELEMENTS) {
    const entry = theme[element];
    if (!entry) continue;

    if (entry.size !== undefined) {
      // A step is a multiplier rather than a size, so it composes with the
      // reading scale instead of fighting it: somebody who reads at a larger
      // scale sees this workspace's proportions, larger.
      properties[`--sone-theme-${element}-size`] = `${(1.125 ** entry.size).toFixed(4)}`;
    }
    if (entry.color !== undefined) {
      properties[`--sone-theme-${element}-color`] = `var(--sone-palette-${entry.color})`;
    }
    if (entry.spaceAbove !== undefined) {
      properties[`--sone-theme-${element}-space-above`] = `${entry.spaceAbove}`;
    }
    if (entry.spaceBelow !== undefined) {
      properties[`--sone-theme-${element}-space-below`] = `${entry.spaceBelow}`;
    }
  }

  return properties;
}
