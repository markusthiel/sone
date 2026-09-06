/**
 * SONE web — appearance.
 *
 * Two independent text scales, one for the interface and one for the editor,
 * and the light-or-dark scheme.
 *
 * **The scales are per browser and the scheme is not**, and that split is the
 * subject of ADR-0124. A text size is a property of the screen being read: a
 * scale that suits a phone is wrong on a 27-inch monitor, and syncing it would
 * make one device's setting the other's problem. A preference for dark is a
 * property of the *person*, and keeping it here meant somebody who chose dark
 * on their laptop signed in on their phone and got light.
 *
 * So the scheme is resolved elsewhere — person, then workspace over instance,
 * then the device (ADR-0124) — and arrives here already decided. What is kept
 * in storage is a **copy of the answer**, not the answer: the first paint
 * happens before the session has loaded, and a dark-theme reader must not be
 * shown a white screen for the half-second it takes to find out.
 *
 * Applied as attributes and custom properties on <html> rather than through
 * React context, so the whole document responds — including anything
 * ProseMirror renders, which React does not own.
 */

import type { ColorScheme } from '@sone/core';
import { useCallback, useEffect, useState } from 'react';

/**
 * What a person may choose for themselves.
 *
 * Null is a fourth state and not a missing one: "as the workspace says". It is
 * different from `system`, which is the choice to let the device decide and
 * overrides a workspace that says dark.
 */
export type ThemePreference = ColorScheme;

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
  /** The resolved scheme — what to paint, not what anybody chose. */
  theme: ColorScheme;
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
 * remembered scheme is in place on the first paint. Without that, a dark-theme
 * reader gets a white flash on every load.
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

export function useAppearance(
  /**
   * The resolved scheme, once it is known (ADR-0124).
   *
   * Undefined while the session is still loading, and then the stored copy of
   * last time's answer is what is painted — which is right far more often than
   * a default would be, and wrong only for the moment after somebody changes it
   * on another device.
   */
  scheme?: ColorScheme,
): {
  appearance: Appearance;
  setUiScale: (scale: TextScale) => void;
  setEditorScale: (scale: TextScale) => void;
} {
  const [appearance, setAppearance] = useState<Appearance>(read);

  /*
   * The resolved answer replaces the remembered one.
   *
   * Written back to storage by the effect below, so the next first paint starts
   * from what this account actually says rather than from what somebody once
   * chose in this browser. That is what makes the stored value a cache: it is
   * never read in preference to the resolved answer, only before there is one.
   */
  useEffect(() => {
    if (!scheme) return;
    setAppearance((previous) => (previous.theme === scheme ? previous : { ...previous, theme: scheme }));
  }, [scheme]);

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
