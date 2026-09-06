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

/**
 * What each of the eight names looks like in this workspace.
 *
 * Only the ones a workspace has changed; the rest keep the design's own values.
 * This is the half that makes names worth having: change `blue` here and every
 * blue thing follows, wherever the name was stored (ADR-0023).
 */
export type WorkspacePalette = Partial<Record<ThemeColor, `#${string}`>>;

export type WorkspaceTheme = Partial<Record<ThemedElement, ElementTheme>> & {
  palette?: WorkspacePalette;
  /**
   * A hue mixed into the neutral surfaces — the sidebar, the panels, the menus.
   *
   * One knob rather than eight. The design system's surfaces are a ramp of one
   * warm grey (ADR-0028), and letting a workspace set each of them separately
   * would let it set them inconsistently: a sidebar that no longer belongs to
   * the panel beside it. A tint mixed into the whole ramp keeps the relationships
   * the ramp was built to express, and keeps the dark theme working without a
   * second set of choices.
   */
  tint?: ThemeColor | `#${string}`;
  /**
   * The accent: what defined text, links and filled buttons are drawn in.
   *
   * Its contrast colour is computed rather than chosen. Somebody picking a pale
   * yellow accent has not asked for white text on it, and offering them the
   * choice would be offering them a way to make a button unreadable.
   */
  accent?: ThemeColor | `#${string}`;
};

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

  // The two whole-interface knobs, from the same eight names entries use or a
  // literal — the same rule the palette follows, so somebody who has coloured a
  // folder already knows what is accepted here.
  const tint = (input as Record<string, unknown>)['tint'];
  if (inList(THEME_COLORS, tint) || isCustomColor(tint)) {
    out.tint = isCustomColor(tint) ? (tint.toLowerCase() as `#${string}`) : tint;
  }
  const accent = (input as Record<string, unknown>)['accent'];
  if (inList(THEME_COLORS, accent) || isCustomColor(accent)) {
    out.accent = isCustomColor(accent) ? (accent.toLowerCase() as `#${string}`) : accent;
  }

  const palette = sanitisePalette((input as Record<string, unknown>)['palette']);
  if (Object.keys(palette).length > 0) out.palette = palette;

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
 * Black or white on this colour, whichever can be read.
 *
 * The sRGB relative luminance from WCAG, and the same threshold every
 * implementation of that formula uses. Not a guess at "is this light": a mid
 * green and a mid blue of the same lightness need different answers, and the
 * formula is why.
 */
export function readableOn(color: string): string {
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const channel = (at: number): number => {
    const value = Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // 0.179 is where white and black are equally readable by the WCAG ratio.
  return luminance > 0.179 ? '#141210' : '#ffffff';
}

/** The eight names, and what this workspace makes of them. */
function sanitisePalette(input: unknown): WorkspacePalette {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const out: WorkspacePalette = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    // Only the eight, and only a literal. A name mapped to another name would
    // be an alias — one more thing that can point at itself, for no gain.
    if (!inList(THEME_COLORS, name)) continue;
    if (isCustomColor(value)) out[name] = value.toLowerCase() as `#${string}`;
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

  /*
   * The tint, mixed into the surfaces by the stylesheet rather than here.
   *
   * A single property, because the stylesheet is where the ramp's proportions
   * live: it knows that the sunken surface takes more of the hue than the raised
   * one, and that the dark theme takes less of it than the light one. Emitting
   * eight computed colours from here would move that knowledge somewhere it
   * cannot be read beside the design tokens.
   */
  const tint = colorValue(theme.tint);
  if (tint !== undefined) properties['--sone-theme-tint'] = tint;

  const accent = colorValue(theme.accent);
  if (accent !== undefined) {
    properties['--accent'] = accent;
    // Computed, never chosen. A pale accent needs dark text on it and a deep one
    // needs light text, and a workspace that picked the wrong one would have a
    // button nobody can read.
    properties['--accent-contrast'] = readableOn(accent);
  }

  for (const [name, value] of Object.entries(theme.palette ?? {})) {
    // The same variable the stylesheet defines, overridden for this workspace.
    // Everything that stored the *name* follows without knowing this happened.
    properties[`--sone-palette-${name}`] = value;
  }

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

/**
 * A cover on a page or a folder (ADR-0117).
 *
 * `pages.cover_url` has been a column since the first migration and a document
 * key for as long, read by the projection and written by nothing — the same
 * history the icon column had, and it ends the same way: the shape is decided
 * when there is finally something to put in it.
 *
 * `text` was not that shape. A cover may be a colour or a gradient as well as a
 * picture, so the column becomes `jsonb` beside `icon` and this is what goes in
 * it. The three kinds are one field rather than three, for the reason
 * `readEntryIcon` gives about its own: a fourth becomes possible without a
 * migration, and a reader that does not know it draws nothing rather than
 * breaking.
 */
export type EntryCover =
  | { kind: 'image'; url: string }
  | { kind: 'color'; color: ChosenColor }
  | { kind: 'gradient'; from: ChosenColor; to: ChosenColor };

/**
 * A file uploaded to this instance, and nothing else.
 *
 * Asked for in those words — *„nur eigene Bilder, kein Unsplash"* — and
 * enforced here rather than in the picker, because a cover is drawn on every
 * page load: a foreign URL in one is a page that reports every reader to
 * somebody else's server, and the document is written by clients rather than by
 * the picker alone.
 *
 * Anchored at both ends, so no `..` and no second path can ride along. The id
 * is a uuid because `files.id` is one; a value that cannot name a row is not a
 * picture, whatever it looks like.
 */
const FILE_URL = /^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a cover from whatever is stored, or null.
 *
 * Unknown and malformed shapes yield null rather than throwing, the rule
 * `readEntryIcon` states: an entry with a broken cover loses its cover and not
 * its place in the tree.
 */
export function readEntryCover(value: unknown): EntryCover | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  if (raw['kind'] === 'image') {
    const url = raw['url'];
    if (typeof url !== 'string' || !FILE_URL.test(url)) return null;
    return { kind: 'image', url };
  }

  if (raw['kind'] === 'color') {
    const color = readChosenColor(raw['color']);
    return color ? { kind: 'color', color } : null;
  }

  if (raw['kind'] === 'gradient') {
    // Both ends, or it is not a gradient. Filling the missing one in with a
    // default would put a colour on the page that nobody chose.
    const from = readChosenColor(raw['from']);
    const to = readChosenColor(raw['to']);
    return from && to ? { kind: 'gradient', from, to } : null;
  }

  return null;
}

/**
 * What to paint behind the heading for a cover that is not a picture.
 *
 * Undefined for a picture, which is drawn as an `<img>` instead: a background
 * image means building a CSS string out of a value from the document, and the
 * escaping rules for that are their own subject, while an `<img src>` is
 * escaped by the framework, can carry alternative text and can be told to load
 * lazily.
 *
 * Here rather than in the component because a page and a folder both draw one,
 * and two drawing sites are two chances to answer differently — which is how
 * the same colour ends up looking like two colours.
 */
export function coverBackground(cover: EntryCover | null | undefined): string | undefined {
  if (!cover) return undefined;
  if (cover.kind === 'color') return colorValue(cover.color);
  if (cover.kind === 'gradient') {
    const from = colorValue(cover.from);
    const to = colorValue(cover.to);
    // Both resolved or neither: half a gradient drawn against the page's own
    // background is a cover that looks like a rendering fault.
    if (!from || !to) return undefined;
    // Diagonal, so the two ends are both visible in a band this short.
    return `linear-gradient(150deg, ${from}, ${to})`;
  }
  return undefined;
}
