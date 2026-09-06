/**
 * SONE web — putting a workspace's theme on the page.
 *
 * The theme resolves to custom properties, and this sets them on the document
 * root. Nothing else changes: no component reads a theme, no document carries
 * one. The properties change what the existing variables resolve to, and the
 * stylesheet already falls back to its own answer where a property is absent —
 * which is what makes a theme gaps filled rather than a replacement design
 * (ADR-0023).
 *
 * Properties are removed as well as set. A theme that stops specifying a
 * heading colour has to leave no trace, or the last colour anybody chose would
 * survive its own deletion — which is the same class of mistake as storing an
 * explicit default.
 */

import { mergeThemes, themeProperties, type WorkspaceTheme } from '@sone/core';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client.ts';

/**
 * Every property a theme can set, so removing is as complete as setting.
 *
 * It was `--sone-theme-` alone, and `themeProperties` has always also emitted
 * `--accent`, `--accent-contrast` and `--sone-palette-*` — which were therefore
 * set and never removed. Leaving a workspace that had chosen an accent for one
 * that had not left the first one's accent on the page until a reload. The list
 * is asserted against what `themeProperties` can produce (`surfaces.test.ts`),
 * so a new prefix added there without being added here fails a test rather than
 * leaking quietly.
 */
const THEME_PREFIXES = [
  '--sone-theme-',
  '--sone-palette-',
  '--sone-radius',
  '--sone-font',
  '--accent',
];

function clearTheme(root: HTMLElement, keep: Record<string, string>): void {
  const stale: string[] = [];

  for (let i = 0; i < root.style.length; i++) {
    const name = root.style.item(i);
    if (name in keep) continue;
    if (THEME_PREFIXES.some((prefix) => name.startsWith(prefix))) stale.push(name);
  }

  for (const name of stale) root.style.removeProperty(name);
}

/**
 * Fetch the workspace's theme and keep it applied.
 *
 * A failure is silent on purpose. The theme is decorative: losing it costs
 * appearance and never content, and an error banner about a heading colour
 * would be louder than the thing it is reporting.
 */
export function useWorkspaceTheme(
  workspaceId: string | null,
  /**
   * The instance's own design, underneath this workspace's (ADR-0123).
   *
   * Merged here rather than by the server, because the settings form reads the
   * workspace's theme from the same route and has to show what the *workspace*
   * set: a form that displayed the instance's accent as its own would be a form
   * where clearing a setting changes nothing visible.
   */
  base: WorkspaceTheme = {},
): WorkspaceTheme {
  const [theme, setTheme] = useState<WorkspaceTheme>({});

  /*
   * The merged answer, memoised, because it is returned.
   *
   * Its caller resolves light or dark from it (ADR-0124), and a fresh object
   * each render would make that a dependency that never settles.
   */
  const merged = useMemo(() => mergeThemes(base, theme), [base, theme]);

  useEffect(() => {
    if (!workspaceId) {
      setTheme({});
      return undefined;
    }

    let cancelled = false;
    void api
      .workspaceTheme(workspaceId)
      .then((result) => {
        if (!cancelled) setTheme(result.theme);
      })
      .catch(() => {
        if (!cancelled) setTheme({});
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    const root = document.documentElement;
    const properties = themeProperties(merged);

    clearTheme(root, properties);
    for (const [name, value] of Object.entries(properties)) {
      root.style.setProperty(name, value);
    }

    // Cleared on unmount as well, so a workspace's look does not follow
    // somebody into the next one they open.
    return () => clearTheme(root, {});
  }, [merged]);

  /**
   * What is actually being drawn — the instance's design with this workspace's
   * over it.
   *
   * The merged one and not the workspace's own, because the only caller wants
   * to know what light-or-dark this adds up to (ADR-0124). The *settings* form
   * reads the workspace's own theme from the route directly, which is what
   * keeps it showing what the workspace set.
   */
  return merged;
}
