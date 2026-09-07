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
  FONT_PAIRS,
  PALETTE_DEFAULTS,
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
  readThemeFile,
  themeFileName,
  writeThemeFile,
  type WorkspaceTheme,
} from '@sone/core';
import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { useMessage } from './Auth.tsx';

/**
 * What the design makes of each name, shown when a workspace has not chosen. A
 * colour input needs *a* value, and showing black for every unset name would
 * suggest the palette is black.
 *
 * From `@sone/core` rather than typed here (ADR-0136): the server has to
 * measure these now — an accent stored as a name still needs a contrast colour
 * computed — so the list moved to where the measuring happens, and this is the
 * same list rather than a second one. The stylesheet's own values are still
 * compared against it by a test, because those two genuinely are two.
 */
const DEFAULT_PALETTE: Record<string, string> = PALETTE_DEFAULTS;

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
  /** What to call an exported file: the workspace's name, or the instance's. */
  name: string;
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
  /** The name of a file just read in, so the form says where its values came from. */
  const [imported, setImported] = useState<string | null>(null);

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

  /**
   * Hand the theme over as a file (ADR-0125).
   *
   * Built from what is *on the form*, unsaved changes included. Exporting the
   * stored version instead would be a button that quietly ignores what somebody
   * is looking at.
   *
   * A blob and a click rather than a route: there is nothing for the server to
   * do — it holds the theme the browser is already showing.
   */
  const exportTheme = (): void => {
    const blob = new Blob([writeThemeFile(owner.name, theme)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = themeFileName(owner.name);
    link.click();
    // Released on the next turn: revoking immediately can cancel the download
    // in some browsers, and holding it for the life of the page is a leak.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  /**
   * Read one in, into the form.
   *
   * Into the form and **not** straight to the server, so the last step is still
   * somebody pressing Save — which is what makes an import undoable by walking
   * away, and what keeps one path to writing a theme rather than two.
   *
   * It replaces the whole theme, including the half this screen is not showing:
   * it is one theme, and a file that changed only the visible half would be a
   * file that means something different depending on which tab was open.
   */
  const importTheme = (text: string): void => {
    const file = readThemeFile(text);
    if (!file) {
      setImported(null);
      setError('not_a_theme');
      return;
    }
    setError(null);
    setSaved(false);
    setTheme(file.theme);
    setImported(file.name || t('type.file.unnamed'));
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
                    aria-label={t('theme.reset', { name })}
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
        {/* The typeface, before the elements (ADR-0127).
          *
          * On this half and not the other: it is the one thing on these two
          * screens that is unambiguously typography, which is what the split
          * was asked for.
          *
          * A named pair rather than a family: a font typed into a box is a font
          * somebody's machine may not have, and the person who typed it sees
          * their own machine and cannot tell. */}
        <h3 className="settings-heading">{t('type.fonts')}</h3>
        <p className="settings-note">{t('type.fonts.note')}</p>

        <div className="theme-surfaces">
          <label className="theme-surface">
            <span>{t('type.fonts')}</span>
            <select
              value={theme.fonts ?? 'designed'}
              disabled={!canEdit}
              onChange={(event) => {
                setSaved(false);
                const chosen = event.target.value;
                setTheme((current) => {
                  const { fonts: _dropped, ...rest } = current;
                  const next: WorkspaceTheme = { ...rest };
                  if (chosen !== 'designed') {
                    next.fonts = chosen as Exclude<(typeof FONT_PAIRS)[number], 'designed'>;
                  }
                  return next;
                });
              }}
            >
              {FONT_PAIRS.map((pair) => (
                <option key={pair} value={pair}>
                  {t(`type.fonts.${pair}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

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
                      aria-label={t('theme.elementSize', { element: LABELS[element] })}
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
                      aria-label={t('theme.elementColour', { element: LABELS[element] })}
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
                        aria-label={t(
                          property === 'spaceAbove'
                            ? 'theme.elementSpaceAbove'
                            : 'theme.elementSpaceBelow',
                          { element: LABELS[element] },
                        )}
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

      {/* A whole theme, in and out (ADR-0125).
        *
        * Under both halves rather than on a screen of its own, because a file
        * is the *whole* theme — putting the control on one of the two screens
        * would suggest it carried only that screen's half. */}
      <h3 className="settings-heading">{t('type.file')}</h3>
      <p className="settings-note">{t('type.file.note')}</p>
      <div className="settings-actions">
        <button type="button" className="btn quiet" onClick={exportTheme}>
          {t('type.file.export')}
        </button>
        {canEdit && (
          <label className="btn quiet">
            {t('type.file.import')}
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so picking the same file twice fires again — which is
                // exactly what somebody does after correcting it in an editor.
                event.target.value = '';
                if (file) void file.text().then(importTheme);
              }}
            />
          </label>
        )}
        {imported && <span className="muted">{t('type.file.loaded', { name: imported })}</span>}
      </div>

      {canEdit && (
        <div className="settings-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            {busy ? t('action.saving') : t('action.save')}
          </button>
          {saved && <span className="muted">{t('action.saved')}</span>}
        </div>
      )}
    </section>
  );
}
