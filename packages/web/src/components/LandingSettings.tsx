/**
 * SONE web — where you land in this workspace.
 *
 * Per person and per workspace: a page in one workspace is no use in another,
 * and two people in the same one work on different things.
 */

import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type PageSummary } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

export function LandingSettings({ workspaceId }: { workspaceId: string }): ReactElement {
  const { t } = useT();
  // Fetched here rather than passed in: settings is not otherwise given the
  // tree, and threading it through for one dropdown would make every other
  // section carry a list it does not use.
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [mode, setMode] = useState<'last' | 'fixed'>('last');
  const [pageId, setPageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api
      .pages(workspaceId)
      .then((result) => setPages(result.pages))
      .catch(() => {
        // Without the list there is no page to choose, and the mode somebody
        // already set still works.
      });

    void api
      .landing(workspaceId)
      .then((result) => {
        setMode(result.mode);
        setPageId(result.pageId);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  }, [workspaceId]);

  const save = (next: { mode: 'last' | 'fixed'; pageId: string | null }): void => {
    setMode(next.mode);
    setPageId(next.pageId);
    setError(null);
    void api
      .setLanding(workspaceId, next)
      .then(() => setSaved(true))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  return (
    <section className="settings-section">
      <h3 className="settings-heading">{t('landing.title')}</h3>
      <p className="muted">
        When you sign in, switch to this workspace, or open SONE without a
        particular page in mind.
      </p>

      {error && <p className="error">{messageFor(error)}</p>}

      <div className="settings-card">
        <label className="settings-row">
          <span className="settings-row-label">
            <b>{t('landing.lastPage')}</b>
            <span>{t('landing.lastPage.hint')}</span>
          </span>
          <input
            type="radio"
            name="landing"
            checked={mode === 'last'}
            onChange={() => save({ mode: 'last', pageId })}
          />
        </label>

        <label className="settings-row">
          <span className="settings-row-label">
            <b>{t('landing.fixedPage')}</b>
            <span>{t('landing.fixedPage.hint')}</span>
          </span>
          <input
            type="radio"
            name="landing"
            checked={mode === 'fixed'}
            onChange={() => save({ mode: 'fixed', pageId })}
          />
        </label>
      </div>

      {mode === 'fixed' && (
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('landing.page')}</b>
              <span>
                If it is ever deleted or closed to you, SONE opens the first one
                instead rather than refusing.
              </span>
            </span>
            {/* The fallback is said rather than left to be discovered: a
              * landing that refuses to land is worse than an arbitrary one, and
              * it is the one page somebody cannot avoid. */}
            <select
              id="landing-page"
              aria-label={t('landing.page')}
              value={pageId ?? ''}
              onChange={(event) => save({ mode: 'fixed', pageId: event.target.value || null })}
            >
              <option value="">{t('landing.choose')}</option>
              {pages
                .filter((page) => page.kind !== 'folder')
                .map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title || 'Untitled'}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {saved && <p className="muted">{t('action.saved')}</p>}
    </section>
  );
}
