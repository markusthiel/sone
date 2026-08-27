/**
 * SONE web — appearance.
 *
 * Theme and two independent text scales: one for the interface, one for the
 * editor. Independent because they answer different questions. Someone who
 * wants a denser sidebar does not necessarily want smaller prose, and someone
 * writing long documents may want larger prose without a larger sidebar.
 *
 * Stored per browser, not per account. A text size is a property of the screen
 * being read — a scale that suits a phone is wrong on a 27-inch monitor, and
 * syncing it would make one device's setting the other's problem.
 *
 * Instance-wide *defaults* are a different thing and belong in an admin area:
 * that is what an administrator setting the look of a deployment means. This is
 * the per-person layer that sits on top.
 *
 * Applied as attributes and custom properties on <html> rather than through
 * React context, so the whole document responds — including anything
 * ProseMirror renders, which React does not own.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Text scale.
 *
 * Named rather than numeric so the stored value keeps meaning: a stored 1.125
 * says nothing about intent, and changing the underlying step would silently
 * change what everyone had chosen.
 */
export const TEXT_SCALES = ['small', 'default', 'large', 'larger'] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

export interface Appearance {
  theme: ThemePreference;
  uiScale: TextScale;
  editorScale: TextScale;
}

const DEFAULTS: Appearance = {
  theme: 'system',
  uiScale: 'default',
  editorScale: 'default',
};

const KEY = 'sone.appearance';

function read(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      // Each field validated separately, so one unrecognised value does not
      // discard the others.
      theme:
        parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
          ? parsed.theme
          : DEFAULTS.theme,
      uiScale: isScale(parsed.uiScale) ? parsed.uiScale : DEFAULTS.uiScale,
      editorScale: isScale(parsed.editorScale) ? parsed.editorScale : DEFAULTS.editorScale,
    };
  } catch {
    // Corrupt or unavailable storage must not stop the app rendering.
    return DEFAULTS;
  }
}

const isScale = (value: unknown): value is TextScale =>
  typeof value === 'string' && (TEXT_SCALES as readonly string[]).includes(value);

/**
 * Apply to the document.
 *
 * Exported and called before React mounts as well as from the hook, so the
 * chosen theme is in place on the first paint. Without that, a dark-theme user
 * gets a white flash on every load.
 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset['theme'] = appearance.theme;
  root.dataset['uiScale'] = appearance.uiScale;
  root.dataset['editorScale'] = appearance.editorScale;

  // color-scheme drives form controls, scrollbars and the browser's own
  // rendering, which CSS variables cannot reach.
  root.style.colorScheme =
    appearance.theme === 'system' ? 'light dark' : appearance.theme;
}

export function useAppearance(): {
  appearance: Appearance;
  setTheme: (theme: ThemePreference) => void;
  setUiScale: (scale: TextScale) => void;
  setEditorScale: (scale: TextScale) => void;
} {
  const [appearance, setAppearance] = useState<Appearance>(read);

  useEffect(() => {
    applyAppearance(appearance);
    try {
      localStorage.setItem(KEY, JSON.stringify(appearance));
    } catch {
      // Private browsing with storage disabled. Losing the preference is
      // acceptable; failing to render is not.
    }
  }, [appearance]);

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((previous) => ({ ...previous, ...patch }));
  }, []);

  return {
    appearance,
    setTheme: (theme) => update({ theme }),
    setUiScale: (uiScale) => update({ uiScale }),
    setEditorScale: (editorScale) => update({ editorScale }),
  };
}

export const SCALE_LABELS: Record<TextScale, string> = {
  small: 'Small',
  default: 'Default',
  large: 'Large',
  larger: 'Larger',
};
