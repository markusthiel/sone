/**
 * SONE web — setting a workspace's defaults for how elements look.
 *
 * One row per element kind, and every control is a step or a palette name
 * rather than a free value. That is not the interface being coy: free numbers
 * produce a heading that no longer relates to the body text under it, and the
 * person who set it cannot see that is what happened (ADR-0023).
 *
 * ## Nothing is a default here
 *
 * Every control offers "As designed" first, and choosing it removes the setting
 * rather than storing the value it happens to equal today. A stored default
 * stops following the design the moment the design changes, which is the whole
 * reason block attributes use null for this.
 */

import {
  SIZE_STEPS,
  SPACE_STEPS,
  THEMED_ELEMENTS,
  THEME_COLORS,
  type ElementTheme,
  type ThemedElement,
  type WorkspaceTheme,
} from '@sone/core';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

/** What each element is called, in words somebody writing would use. */
const LABELS: Record<ThemedElement, string> = {
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  body: 'Body text',
  quote: 'Quote',
  callout: 'Callout',
  code: 'Code',
  list: 'Lists',
};

/** A size step, said as a person would say it rather than as a number. */
const SIZE_LABELS: Record<number, string> = {
  [-2]: 'Much smaller',
  [-1]: 'Smaller',
  0: 'As designed',
  1: 'Larger',
  2: 'Much larger',
  3: 'Largest',
};

interface ThemeSettingsProps {
  workspaceId: string;
  /** Owners and admins may change it; everybody else sees what it says. */
  canEdit: boolean;
}

export function ThemeSettings({ workspaceId, canEdit }: ThemeSettingsProps): ReactElement {
  const [theme, setTheme] = useState<WorkspaceTheme>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .workspaceTheme(workspaceId)
      .then((result) => {
        if (!cancelled) setTheme(result.theme);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  /**
   * Change one property of one element.
   *
   * `undefined` removes it, and removing the last property removes the element
   * entirely — so "has a theme" and "has settings" keep meaning the same thing,
   * exactly as the server's own validation does.
   */
  const change = (
    element: ThemedElement,
    property: keyof ElementTheme,
    value: number | string | undefined,
  ): void => {
    setSaved(false);
    setTheme((current) => {
      const entry: ElementTheme = { ...(current[element] ?? {}) };
      if (value === undefined) delete entry[property];
      else Object.assign(entry, { [property]: value });

      const next: WorkspaceTheme = { ...current };
      if (Object.keys(entry).length === 0) delete next[element];
      else next[element] = entry;
      return next;
    });
  };

  const save = (): void => {
    setBusy(true);
    setError(null);
    void api
      .setWorkspaceTheme(workspaceId, theme)
      // What comes back is what was stored, which can differ from what was sent
      // if something was not usable. Shown rather than kept, so the form never
      // claims a setting the server dropped.
      .then((result) => {
        setTheme(result.theme);
        setSaved(true);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  return (
    <section className="settings-section">
      <p className="muted">
        Defaults for this workspace. A block that carries its own size or colour
        keeps it — these apply where nobody has chosen.
      </p>

      {error && <p className="error">{messageFor(error)}</p>}

      <table className="theme-table">
        <thead>
          <tr>
            <th>Element</th>
            <th>Size</th>
            <th>Colour</th>
            <th>Space above</th>
            <th>Space below</th>
          </tr>
        </thead>
        <tbody>
          {THEMED_ELEMENTS.map((element) => {
            const entry = theme[element] ?? {};
            return (
              <tr key={element}>
                <th scope="row">{LABELS[element]}</th>

                <td>
                  <select
                    value={entry.size ?? ''}
                    disabled={!canEdit}
                    aria-label={`${LABELS[element]} size`}
                    onChange={(event) =>
                      change(
                        element,
                        'size',
                        event.target.value === '' ? undefined : Number(event.target.value),
                      )
                    }
                  >
                    <option value="">As designed</option>
                    {SIZE_STEPS.filter((step) => step !== 0).map((step) => (
                      <option key={step} value={step}>
                        {SIZE_LABELS[step] ?? step}
                      </option>
                    ))}
                  </select>
                </td>

                <td>
                  <select
                    value={entry.color ?? ''}
                    disabled={!canEdit}
                    aria-label={`${LABELS[element]} colour`}
                    onChange={(event) =>
                      change(
                        element,
                        'color',
                        event.target.value === '' ? undefined : event.target.value,
                      )
                    }
                  >
                    <option value="">As designed</option>
                    {THEME_COLORS.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </td>

                {(['spaceAbove', 'spaceBelow'] as const).map((property) => (
                  <td key={property}>
                    <select
                      value={entry[property] ?? ''}
                      disabled={!canEdit}
                      aria-label={`${LABELS[element]} ${property === 'spaceAbove' ? 'space above' : 'space below'}`}
                      onChange={(event) =>
                        change(
                          element,
                          property,
                          event.target.value === '' ? undefined : Number(event.target.value),
                        )
                      }
                    >
                      <option value="">As designed</option>
                      {SPACE_STEPS.filter((step) => step !== 0).map((step) => (
                        <option key={step} value={step}>
                          {'+'.repeat(step)}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {canEdit && (
        <div className="settings-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="muted">Saved.</span>}
        </div>
      )}
    </section>
  );
}
