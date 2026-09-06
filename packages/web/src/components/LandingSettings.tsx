/**
 * SONE web — where people land in this workspace (ADR-0119).
 *
 * Reported as: *„Die Einstellung ist Workspace gebunden. Dort kann ich also nur
 * auswählen aus den Seiten in dem Workspace in dem ich gerade bin. Das macht da
 * keinen Sinn."*
 *
 * It was right. The data has been per person **and** per workspace since
 * migration 0024, and the screen for it sat in the personal settings — which have
 * exactly one workspace in scope, whichever the person is standing in. So it
 * edited one workspace's row while looking like a preference about the person,
 * and offered pages from wherever they happened to be.
 *
 * ## Two settings, in the order they are decided
 *
 * **The workspace's**, first, editable by whoever edits the rest of the
 * workspace. A place with a page saying what it is for could not send anybody
 * there at all — the modes were "where you were" and "a page I chose", both
 * personal.
 *
 * **Mine**, under it, for everybody. Migration 0024's reason has not stopped being
 * true: two people in one workspace work on different things. What is new is
 * that "no opinion" is a state — a row used to say `last` whether somebody had
 * chosen it or merely been seen somewhere.
 */

import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type PageSummary } from '../api/client.ts';
import type { MessageKey } from '../i18n/messages.en.ts';
import { messageFor } from './Auth.tsx';

/** The four, in the order they are offered. */
const MODES: ReadonlyArray<{ value: LandingMode; label: MessageKey; hint: MessageKey }> = [
  { value: 'last', label: 'landing.lastPage', hint: 'landing.lastPage.hint' },
  { value: 'top', label: 'landing.top', hint: 'landing.top.hint' },
  { value: 'newest', label: 'landing.newest', hint: 'landing.newest.hint' },
  { value: 'fixed', label: 'landing.fixedPage', hint: 'landing.fixedPage.hint' },
];

type LandingMode = 'last' | 'top' | 'newest' | 'fixed';

export function LandingSettings({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  /** Whether this person may change the workspace's own answer. */
  canEdit: boolean;
}): ReactElement {
  const { t } = useT();
  // Fetched here rather than passed in: this screen is not otherwise given the
  // tree, and threading it through for one dropdown would make every other
  // section carry a list it does not use.
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [workspace, setWorkspace] = useState<{ mode: LandingMode; pageId: string | null }>({
    mode: 'last',
    pageId: null,
  });
  /** Null means "follow the workspace", which is now a state rather than a gap. */
  const [mine, setMine] = useState<{ mode: LandingMode | null; pageId: string | null }>({
    mode: null,
    pageId: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = (): void => {
    void api
      .landing(workspaceId)
      .then((result) => {
        setWorkspace(result.workspace);
        setMine({ mode: result.mode, pageId: result.pageId });
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  useEffect(() => {
    void api
      .pages(workspaceId)
      .then((result) => setPages(result.pages))
      .catch(() => {
        // Without the list there is no page to choose, and the mode somebody
        // already set still works.
      });
    load();
  }, [workspaceId]);

  const done = (err?: unknown): void => {
    if (err === undefined) {
      setSaved(true);
      load();
      return;
    }
    setError(err instanceof ApiError ? err.code : 'network_error');
  };

  const saveWorkspace = (next: { mode: LandingMode; pageId: string | null }): void => {
    setWorkspace(next);
    setError(null);
    void api.setWorkspaceLanding(workspaceId, next).then(() => done(), done);
  };

  const saveMine = (next: { mode: LandingMode | null; pageId: string | null }): void => {
    setMine(next);
    setError(null);
    void api.setLanding(workspaceId, next).then(() => done(), done);
  };

  /** The pages that can be landed on. A folder is a list, not something to read. */
  const landable = pages.filter((page) => page.kind !== 'folder');

  const chooser = (
    value: string | null,
    onChoose: (pageId: string | null) => void,
    id: string,
  ): ReactElement => (
    <div className="settings-card">
      <div className="settings-row">
        <span className="settings-row-label">
          <b>{t('landing.page')}</b>
          {/* The fallback is said rather than left to be discovered: a landing
              that refuses to land is worse than an arbitrary one, and it is the
              one page somebody cannot avoid. */}
          <span>{t('landing.gone')}</span>
        </span>
        <select
          id={id}
          aria-label={t('landing.page')}
          value={value ?? ''}
          onChange={(event) => onChoose(event.target.value || null)}
        >
          <option value="">{t('landing.choose')}</option>
          {landable.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title || t('page.untitled')}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <section className="settings-section">
      <h3 className="settings-heading">{t('landing.title')}</h3>
      <p className="muted">{t('landing.note')}</p>

      {error && <p className="error">{messageFor(error)}</p>}

      <div className="settings-card">
        {MODES.map((one) => (
          <label className="settings-row" key={one.value}>
            <span className="settings-row-label">
              <b>{t(one.label)}</b>
              <span>{t(one.hint)}</span>
            </span>
            <input
              type="radio"
              name="workspace-landing"
              checked={workspace.mode === one.value}
              // The rights decide whether it can be used, not whether it is
              // there: somebody who may only read should see what the workspace
              // does, which is the thing their own setting departs from.
              disabled={!canEdit}
              onChange={() => saveWorkspace({ mode: one.value, pageId: workspace.pageId })}
            />
          </label>
        ))}
      </div>

      {workspace.mode === 'fixed' &&
        chooser(
          workspace.pageId,
          (pageId) => saveWorkspace({ mode: 'fixed', pageId }),
          'workspace-landing-page',
        )}

      <h3 className="settings-heading">{t('landing.mine')}</h3>
      <p className="muted">{t('landing.mine.note')}</p>

      <div className="settings-card">
        <label className="settings-row">
          <span className="settings-row-label">
            <b>{t('landing.follow')}</b>
            {/* Named with what it is following, so choosing it is not a leap of
                faith: the workspace's answer is three lines above, and saying it
                again here is cheaper than making somebody look. */}
            <span>
              {t('landing.follow.hint', {
                what: t(MODES.find((one) => one.value === workspace.mode)?.label ?? 'landing.lastPage'),
              })}
            </span>
          </span>
          <input
            type="radio"
            name="my-landing"
            checked={mine.mode === null}
            onChange={() => saveMine({ mode: null, pageId: mine.pageId })}
          />
        </label>

        {MODES.map((one) => (
          <label className="settings-row" key={one.value}>
            <span className="settings-row-label">
              <b>{t(one.label)}</b>
              <span>{t(one.hint)}</span>
            </span>
            <input
              type="radio"
              name="my-landing"
              checked={mine.mode === one.value}
              onChange={() => saveMine({ mode: one.value, pageId: mine.pageId })}
            />
          </label>
        ))}
      </div>

      {mine.mode === 'fixed' &&
        chooser(mine.pageId, (pageId) => saveMine({ mode: 'fixed', pageId }), 'my-landing-page')}

      {saved && <p className="muted">{t('action.saved')}</p>}
    </section>
  );
}
