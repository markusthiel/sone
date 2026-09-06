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
  COLOR_SCHEMES,
  CORNERS,
  SIZE_STEPS,
  SPACE_STEPS,
  SURFACE_TREATMENTS,
  THEMED_ELEMENTS,
  THEMED_SURFACES,
  THEME_COLORS,
  type ElementTheme,
  type StoredTreatment,
  type ThemedElement,
  type ThemedSurface,
  type WorkspaceTheme,
} from '@sone/core';
import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { useMessage } from './Auth.tsx';

/**
 * What the stylesheet makes of each name, shown when a workspace has not
 * chosen. A colour input needs *a* value, and showing black for every unset
 * name would suggest the palette is black.
 *
 * Kept in step with the stylesheet by a test, because two lists of the same
 * eight colours will otherwise drift.
 */
const DEFAULT_PALETTE: Record<string, string> = {
  grey: '#8a8a8a',
  red: '#d64545',
  orange: '#d97706',
  yellow: '#ca8a04',
  green: '#16a34a',
  blue: '#2563eb',
  purple: '#7c3aed',
  pink: '#db2777',
};

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

/**
 * Where a theme is read from and written to (ADR-0123).
 *
 * A pair of functions rather than a workspace id, because there are two owners
 * now: a workspace, and the instance underneath every workspace. The form is
 * the same form — the same controls, the same "as designed" meaning the same
 * thing — and a second copy of it for the instance would be the screen where
 * one of the two forgets a control.
 */
export interface ThemeOwner {
  /** Something stable per owner, so a change of owner refetches. */
  key: string;
  load: () => Promise<{ theme: WorkspaceTheme }>;
  save: (theme: WorkspaceTheme) => Promise<{ theme: WorkspaceTheme }>;
}

interface ThemeSettingsProps {
  owner: ThemeOwner;
  /** Owners and admins may change it; everybody else sees what it says. */
  canEdit: boolean;
  /**
   * Which half of the theme this instance of the screen is showing (ADR-0120).
   *
   * Reported as: *„der Bereich Typografie [sollte] aufgeteilt werden. Schrift
   * Design kann gerne alleine stehen, aber die Oberfläche, Tönung,
   * Akzent-Farbe gehört da nicht hin."*
   *
   * One component and not two, because it is one theme with one fetch and one
   * save. Two components would be two copies of the state — and a workspace
   * whose surfaces saved without its type, or the other way round, is two
   * requests racing to write one row.
   */
  show: 'type' | 'colour';
}

export function ThemeSettings({
  owner,
  canEdit,
  show,
}: ThemeSettingsProps): ReactElement {
  const { t } = useT();
  const message = useMessage();
  const [theme, setTheme] = useState<WorkspaceTheme>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void owner
      .load()
      .then((result) => {
        if (!cancelled) setTheme(result.theme);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
    // The key and not the pair: `owner` is rebuilt on every render of the
    // screen above, and depending on it would refetch the theme forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.key]);

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

  /**
   * Treat one surface, or stop treating it.
   *
   * `follow` removes the entry, and an empty set removes `surfaces` entirely —
   * the same rule an element follows, so "has a theme" and "has settings" go on
   * meaning the same thing here too.
   */
  const treat = (surface: ThemedSurface, treatment: string): void => {
    setSaved(false);
    setTheme((current) => {
      const surfaces = { ...(current.surfaces ?? {}) };
      if (treatment === 'follow') delete surfaces[surface];
      else surfaces[surface] = treatment as StoredTreatment;

      const { surfaces: _dropped, ...rest } = current;
      const next: WorkspaceTheme = { ...rest };
      if (Object.keys(surfaces).length > 0) next.surfaces = surfaces;
      return next;
    });
  };

  const save = (): void => {
    setBusy(true);
    setError(null);
    void owner
      .save(theme)
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
      <p className="muted">{t(show === 'type' ? 'type.note.type' : 'type.note.colour')}</p>

      {error && <p className="error">{message(error)}</p>}

      {show === 'colour' && (
        <>
        {/* The two whole-interface colours first, because they decide what
          * everything else sits on and in. One tint rather than a colour per
          * surface: the surfaces are a ramp of one grey, and setting them
          * separately would let a workspace set them inconsistently — a sidebar
          * that no longer belongs to the panel beside it (ADR-0023). */}
        <h3 className="settings-heading">{t('type.base')}</h3>
        <p className="muted">{t('type.base.note')}</p>

        <div className="theme-base">
          <label className="theme-base-entry">
            <span>{t('type.tint')}</span>
            <input
              type="color"
              disabled={!canEdit}
              value={typeof theme.tint === 'string' && theme.tint.startsWith('#') ? theme.tint : '#f7f5f0'}
              aria-label={t('type.tint')}
              onChange={(event) => {
                setSaved(false);
                // Cast to the literal shape the type asks for: an `<input
                // type="color">` yields a string and the theme wants `#…`, and the
                // element cannot produce anything else.
                const value = event.target.value as `#${string}`;
                setTheme((current) => ({ ...current, tint: value }));
              }}
            />
            {/* Removing it has to be possible, and it has to leave no trace: a
                workspace that stops tinting must look like one that never did. */}
            {theme.tint !== undefined && canEdit && (
              <button
                type="button"
                className="btn quiet"
                onClick={() => {
                  setSaved(false);
                  setTheme((current) => {
                    const next = { ...current };
                    delete next.tint;
                    return next;
                  });
                }}
              >
                {t('type.clear')}
              </button>
            )}
          </label>

          <label className="theme-base-entry">
            <span>{t('type.accent')}</span>
            <input
              type="color"
              disabled={!canEdit}
              value={
                typeof theme.accent === 'string' && theme.accent.startsWith('#')
                  ? theme.accent
                  : '#4f7d6f'
              }
              aria-label={t('type.accent')}
              onChange={(event) => {
                setSaved(false);
                const value = event.target.value as `#${string}`;
                setTheme((current) => ({ ...current, accent: value }));
              }}
            />
            {theme.accent !== undefined && canEdit && (
              <button
                type="button"
                className="btn quiet"
                onClick={() => {
                  setSaved(false);
                  setTheme((current) => {
                    const next = { ...current };
                    delete next.accent;
                    return next;
                  });
                }}
              >
                {t('type.clear')}
              </button>
            )}
          </label>
        </div>
        {/* Said rather than left to be discovered: the text colour on a filled
            button is computed from the accent, so a pale accent gets dark text
            and nobody can make a button unreadable by choosing badly. */}
        <p className="settings-note">{t('type.accent.note')}</p>

        {/* The palette first.
          *
          * It is the setting the others are expressed in: an element's colour is
          * one of these names, so deciding what the names look like comes before
          * deciding which to use. */}
        <h3 className="settings-heading">{t('type.palette')}</h3>
        <p className="muted">
          {t('type.palette.note')}
        </p>

        <div className="theme-palette">
          {THEME_COLORS.map((name) => {
            const value = theme.palette?.[name];
            return (
              <label key={name} className="theme-palette-entry">
                <input
                  type="color"
                  disabled={!canEdit}
                  value={value ?? DEFAULT_PALETTE[name]}
                  aria-label={name}
                  onChange={(event) => {
                    setSaved(false);
                    setTheme((current) => ({
                      ...current,
                      palette: { ...(current.palette ?? {}), [name]: event.target.value },
                    }));
                  }}
                />
                <span>{name}</span>
                {value && canEdit && (
                  <button
                    type="button"
                    className="theme-palette-reset"
                    aria-label={`Reset ${name}`}
                    title={t('type.asDesigned')}
                    onClick={() => {
                      setSaved(false);
                      setTheme((current) => {
                        // Removed rather than set back to the design's value.
                        // Stored, it would stop following a change to the design
                        // — the same distinction every other setting here makes.
                        const palette: Record<string, string> = {
                          ...(current.palette ?? {}),
                        };
                        delete palette[name];

                        const { palette: _dropped, ...rest } = current;
                        const next: WorkspaceTheme = { ...rest };
                        if (Object.keys(palette).length > 0) {
                          next.palette = palette as NonNullable<WorkspaceTheme['palette']>;
                        }
                        return next;
                      });
                    }}
                  >
                    ×
                  </button>
                )}
              </label>
            );
          })}
        </div>

        {/* One piece of furniture at a time (ADR-0122).
          *
          * Asked for against the complaint that a theme which only recolours
          * everything at once is what every tool already has. What is offered
          * is a relationship rather than a colour — a chosen `#101010` would be
          * black in both schemes, and a black rail against a black page for
          * everybody reading in the dark. The page itself is deliberately not
          * in the list: inverting what you read on is the reader's decision. */}
        <h3 className="settings-heading">{t('type.surfaces')}</h3>
        <p className="muted">{t('type.surfaces.note')}</p>

        <div className="theme-surfaces">
          {THEMED_SURFACES.map((surface) => (
            <label key={surface} className="theme-surface">
              <span>{t(`type.surface.${surface}`)}</span>
              <select
                value={theme.surfaces?.[surface] ?? 'follow'}
                disabled={!canEdit}
                onChange={(event) => treat(surface, event.target.value)}
              >
                {SURFACE_TREATMENTS.map((treatment) => (
                  <option key={treatment} value={treatment}>
                    {t(`type.treatment.${treatment}`)}
                  </option>
                ))}
              </select>
            </label>
          ))}

          {/* Light or dark, where nobody more specific has said (ADR-0124).
            *
            * On this screen and not on its own, because it is one more thing a
            * theme says — an instance sets it, a workspace fills in over it,
            * and a person overrides both from their own settings. Absent is a
            * fourth state: "as the level above says". */}
          <label className="theme-surface">
            <span>{t('type.scheme')}</span>
            <select
              value={theme.scheme ?? ''}
              disabled={!canEdit}
              onChange={(event) => {
                setSaved(false);
                const chosen = event.target.value;
                setTheme((current) => {
                  const { scheme: _dropped, ...rest } = current;
                  const next: WorkspaceTheme = { ...rest };
                  if (chosen !== '') next.scheme = chosen as (typeof COLOR_SCHEMES)[number];
                  return next;
                });
              }}
            >
              <option value="">{t('type.scheme.inherit')}</option>
              {COLOR_SCHEMES.map((scheme) => (
                <option key={scheme} value={scheme}>
                  {t(`type.scheme.${scheme}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="theme-surface">
            <span>{t('type.corners')}</span>
            <select
              // `soft` is the design's own and is stored as nothing, so an
              // unset theme shows it selected without it ever being written.
              value={theme.corners ?? 'soft'}
              disabled={!canEdit}
              onChange={(event) => {
                setSaved(false);
                const chosen = event.target.value;
                setTheme((current) => {
                  const { corners: _dropped, ...rest } = current;
                  const next: WorkspaceTheme = { ...rest };
                  if (chosen === 'sharp' || chosen === 'round') next.corners = chosen;
                  return next;
                });
              }}
            >
              {CORNERS.map((corner) => (
                <option key={corner} value={corner}>
                  {t(`type.corners.${corner}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="settings-note">{t('type.corners.note')}</p>
        </>
      )}

      {show === 'type' && (
        <>
        <h3 className="settings-heading">{t('type.elements')}</h3>

        <table className="theme-table">
          <thead>
            <tr>
              <th>{t('type.element')}</th>
              <th>{t('type.size')}</th>
              <th>{t('type.colour')}</th>
              <th>{t('type.spaceAbove')}</th>
              <th>{t('type.spaceBelow')}</th>
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
                      <option value="">{t('type.asDesigned')}</option>
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
                      <option value="">{t('type.asDesigned')}</option>
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
                        <option value="">{t('type.asDesigned')}</option>
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
        </>
      )}

      {canEdit && (
        <div className="settings-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="muted">{t('action.saved')}</span>}
        </div>
      )}
    </section>
  );
}
