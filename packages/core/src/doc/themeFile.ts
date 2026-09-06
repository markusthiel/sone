/**
 * SONE core — a theme as a file (ADR-0125).
 *
 * Asked for as *„Ggf. auch Themes die man importieren und exportieren kann, die
 * dann wirklich alles verändern."* The second half is what took four records to
 * earn: a theme now carries the surfaces, the corners and light-or-dark
 * (ADR-0122, ADR-0124), so a file of one really does change what the place
 * looks like rather than only recolouring it.
 *
 * ## It is not a second way into a theme
 *
 * What comes out of a file goes through the same `sanitiseTheme` the form and
 * the server run, so **an imported file can do nothing the form could not**.
 * That is what makes it safe to accept one somebody downloaded from a stranger:
 * there is nothing to express in it that a workspace could not already type in.
 *
 * ## And it refuses what it does not recognise
 *
 * The rule everywhere else here is the opposite — drop the unusable field and
 * keep the rest — and it is right there, because the input is a form somebody
 * is filling in. Here the input is a file somebody *picked*, and picking the
 * wrong one is the ordinary mistake. Sanitising an arbitrary JSON file into an
 * empty theme and loading it would silently empty a workspace's appearance and
 * show a form that looked reset with no reason why.
 */

import { sanitiseTheme, type WorkspaceTheme } from './theme.js';

/** What the file says it is, in the file. */
const MARKER = 'theme';

/**
 * The shape of the file's format.
 *
 * Not branched on when reading, deliberately: the sanitiser already drops what
 * it does not know, so a later release adding a field costs an older one
 * nothing, and refusing on a number would turn a compatible file into an error
 * message. It is written so that a *breaking* rename one day has something to
 * look at.
 */
const VERSION = 1;

export interface ThemeFile {
  /** What a person called it. Empty is fine; it is only ever shown. */
  name: string;
  theme: WorkspaceTheme;
}

/**
 * A theme, as text to hand somebody.
 *
 * Indented, because a theme file is small and gets mailed around and pasted
 * into issues: one line of JSON is a file nobody can diff or correct by hand.
 */
export function writeThemeFile(name: string, theme: WorkspaceTheme): string {
  return `${JSON.stringify({ sone: MARKER, version: VERSION, name, theme }, null, 2)}\n`;
}

/**
 * Read one, or null if it is not one.
 *
 * Null rather than a thrown error or an empty theme: the caller has a person
 * standing in front of it who has just chosen a file, and "that is not a theme"
 * is the whole of what they need to be told.
 */
export function readThemeFile(text: string): ThemeFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;

  // The marker and not the shape: a theme is almost entirely optional fields,
  // so "looks like a theme" matches nearly any object — including `{}`.
  if (raw['sone'] !== MARKER) return null;

  const theme = raw['theme'];
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return null;

  return {
    // It reaches a heading and a download's filename. Absent is a fine answer;
    // `[object Object]` in either is not.
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    theme: sanitiseTheme(theme),
  };
}

/**
 * A filename for one.
 *
 * Here rather than at the two call sites, because a downloaded file's name is
 * the only label it keeps once it has left the application.
 */
export function themeFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${slug || 'theme'}.sone-theme.json`;
}
