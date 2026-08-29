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

/**
 * A colour somebody chose: one of the eight names, or their own.
 *
 * One field, two shapes (ADR-0023). A name is what makes a workspace
 * restylable — change what `blue` means and every blue thing follows — and a
 * literal is the escape for the case a palette cannot cover. Distinguished by
 * shape rather than by a second field, so nothing has two places to look.
 */
export type ChosenColor = ThemeColor | `#${string}`;

/** Is this one of the eight? */
export const isPaletteName = (value: unknown): value is ThemeColor =>
  inList(THEME_COLORS, value);

/** A colour of one's own. Six digits only: shorthand and alpha are not offered. */
export const isCustomColor = (value: unknown): value is `#${string}` =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** Either, or null for anything else. */
export function readChosenColor(value: unknown): ChosenColor | null {
  if (isPaletteName(value)) return value;
  if (isCustomColor(value)) return value.toLowerCase() as `#${string}`;
  return null;
}

/**
 * What to put in a stylesheet for a chosen colour.
 *
 * A name becomes the workspace's variable, so it keeps following the palette; a
 * literal is itself. Returning undefined for anything else is what lets an
 * older client draw the design's own answer instead of breaking on a value it
 * does not recognise.
 */
export function colorValue(value: unknown): string | undefined {
  if (isPaletteName(value)) return `var(--sone-palette-${value})`;
  if (isCustomColor(value)) return value;
  return undefined;
}

export interface ElementTheme {
  size?: SizeStep;
  color?: ChosenColor;
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
    const color = readChosenColor(entry['color']);
    if (color) element.color = color;
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
    const color = colorValue(entry.color);
    if (color !== undefined) {
      properties[`--sone-theme-${element}-color`] = color;
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

// --- entry appearance -------------------------------------------------------

/**
 * The icons an entry may carry.
 *
 * Lucide, which is ISC-licensed line work that matches the rest of this
 * interface — the alternative first attempt was emoji, and it was the wrong
 * answer: emoji are somebody else's drawings in somebody else's style, they
 * differ on every platform, and a sidebar of them does not look designed.
 *
 * A curated list rather than the whole set. Two thousand icons is a search
 * problem rather than a choice, and a name stored here has to keep resolving —
 * a closed list is a promise that it will, and the names are checked against
 * what the interface actually renders.
 */
export const ENTRY_ICONS = [
  'folder',
  'folder-open',
  'file-text',
  'notebook',
  'book',
  'bookmark',
  'star',
  'heart',
  'flag',
  'target',
  'lightbulb',
  'rocket',
  'briefcase',
  'building',
  'home',
  'users',
  'user',
  'message-circle',
  'mail',
  'phone',
  'calendar',
  'clock',
  'check-circle',
  'list-todo',
  'chart-bar',
  'trending-up',
  'coins',
  'shopping-cart',
  'package',
  'truck',
  'wrench',
  'settings',
  'code',
  'database',
  'server',
  'cloud',
  'lock',
  'key',
  'shield',
  'archive',
  'camera',
  'image',
  'music',
  'video',
  'map-pin',
  'globe',
  'plane',
  'car',
  'leaf',
  'sun',
  // Widened after the first fifty turned out to lean heavily on office work.
  // A notes tool holds recipes, training plans, house repairs and holidays as
  // readily as it holds meetings.
  'moon',
  'cloud-rain',
  'flame',
  'droplet',
  'mountain',
  'tree-pine',
  'flower',
  'bug',
  'cat',
  'dog',
  'bird',
  'fish',
  'coffee',
  'utensils',
  'pizza',
  'cake',
  'apple',
  'wine',
  'shopping-bag',
  'gift',
  'shirt',
  'bed',
  'lamp',
  'sofa',
  'bath',
  'hammer',
  'paintbrush',
  'palette',
  'scissors',
  'ruler',
  'pen-tool',
  'guitar',
  'headphones',
  'film',
  'gamepad-2',
  'dice-5',
  'puzzle',
  'trophy',
  'medal',
  'dumbbell',
  'bike',
  'footprints',
  'tent',
  'anchor',
  'ship',
  'train-front',
  'bus',
  'fuel',
  'compass',
  'map',
  'luggage',
  'hospital',
  'pill',
  'stethoscope',
  'heart-pulse',
  'baby',
  'graduation-cap',
  'school',
  'library',
  'newspaper',
  'quote',
  'languages',
  'microscope',
  'atom',
  'flask-conical',
  'telescope',
  'sprout',
  'recycle',
  'battery-charging',
  'plug',
  'wifi',
  'smartphone',
  'laptop',
  'printer',
  'hard-drive',
  'terminal',
  'git-branch',
  'bug-play',
  'banknote',
  'credit-card',
  'receipt',
  'calculator',
  'scale',
  'gavel',
  'landmark',
  'church',
  'store',
  'factory',
  'warehouse',
  'sun-medium',
  'snowflake',
  'umbrella',
  'wind',
] as const;

/**
 * A name the picker suggests. Any well-formed name is accepted, so this is a
 * starting point rather than the limit — see readEntryIcon.
 */
export type EntryIconName = string;

/**
 * An entry's own icon and the colours around it.
 *
 * `pages.icon` has been a jsonb column and a document key since the first
 * migration, and nothing ever wrote one. This is the shape that goes in it, so
 * none of this needs a migration.
 *
 * The two colours are separate on purpose. Colouring a folder's name and its
 * icon together is one decision made twice, and a coloured icon beside a plain
 * name is a common thing to want — the other way round is rarer but not ours to
 * forbid.
 */
export interface EntryIcon {
  /** The field exists so a second kind could be added without a migration. */
  kind: 'icon';
  value: EntryIconName;
  /** A palette name or a colour of one's own; absent means the design decides. */
  color?: ChosenColor;
}

/**
 * Read an icon from whatever is stored, or null.
 *
 * Unknown shapes yield null rather than throwing: this comes out of a document
 * another client wrote, and an entry with a malformed icon should lose its icon
 * and not its place in the tree.
 */
export function readEntryIcon(value: unknown): EntryIcon | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  if (raw['kind'] !== 'icon') return null;

  // Checked by shape rather than against a list.
  //
  // It was a closed list, on the reasoning that a stored name has to keep
  // resolving. That reasoning was weaker than it sounded: the guarantee only
  // ever held for the icon set installed at the time, and an upgrade that
  // renames one breaks it either way. What actually protects an entry is the
  // interface drawing its default when a name does not resolve, which it does.
  //
  // So the shape is what is enforced — lower-case, digits and hyphens, bounded
  // — which keeps the value safe to put in a class name or a lookup, and lets
  // the picker offer every icon it has rather than the fifty somebody once
  // chose.
  const name = raw['value'];
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,48}$/.test(name)) return null;

  const color = readChosenColor(raw['color']);
  return {
    kind: 'icon',
    value: name,
    ...(color ? { color } : {}),
  };
}

/** A title colour, or null. Stored beside the icon, kept separate from it. */
export function readTitleColor(value: unknown): ChosenColor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return readChosenColor((value as Record<string, unknown>)['titleColor']);
}
