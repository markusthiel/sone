/**
 * SONE web — what a page said before (ADR-0047).
 *
 * A list of moments, and the two facts the record insists are said out loud
 * rather than implied: how far back this goes, and that it does not go all the
 * way. Every page that existed before versions were kept has one collapsed
 * state and no past — a list that simply stops looks like a page nobody edited
 * until then.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { api, ApiError, type WorkspaceMember } from '../api/client.ts';
import { guestName, isGuestKey } from '@sone/client';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';

interface Version {
  id: string;
  takenAt: string;
  authors: string[];
  reason: 'quiet' | 'compaction' | 'restore';
}

/** Who wrote in the stretch this version closed. */
function authorNames(authors: string[], members: WorkspaceMember[]): string {
  return authors
    .map((author) => {
      if (isGuestKey(author)) return guestName(author);
      return members.find((one) => one.userId === author)?.displayName ?? '';
    })
    .filter((name) => name !== '')
    .join(', ');
}

export function HistoryPanel({
  pageId,
  members,
  viewing,
  onView,
}: {
  pageId: string | null;
  members: WorkspaceMember[];
  /** Which version is being read, if any. */
  viewing: string | null;
  onView: (versionId: string | null) => void;
}): ReactElement {
  const { t } = useT();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pageId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    void api
      .versions(pageId)
      .then((result) => {
        if (cancelled) return;
        setVersions(result.versions);
        setRetentionDays(result.retentionDays);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
    // Re-read when the panel is reopened on another page. Not on every edit: a
    // version appears when a sitting ends, which is minutes away, and polling
    // for it would be a request per keystroke for news that is never urgent.
  }, [pageId]);

  if (error) {
    return (
      <div className="panel-section">
        <p className="muted">{t(`error.${error}` as MessageKey)}</p>
      </div>
    );
  }

  if (versions === null) {
    return (
      <div className="panel-section">
        <p className="muted">{t('panel.loading')}</p>
      </div>
    );
  }

  return (
    <div className="panel-section">
      {viewing && (
        <button type="button" className="btn primary history-back" onClick={() => onView(null)}>
          {t('history.backToNow')}
        </button>
      )}

      {versions.length === 0 ? (
        <p className="muted">{t('history.none')}</p>
      ) : (
        <ul className="history-list">
          {versions.map((version) => {
            const who = authorNames(version.authors, members);
            return (
              <li key={version.id}>
                <button
                  type="button"
                  className={
                    viewing === version.id ? 'history-entry current' : 'history-entry'
                  }
                  aria-current={viewing === version.id}
                  onClick={() => onView(version.id)}
                >
                  <span className="history-when">
                    {new Date(version.takenAt).toLocaleString()}
                  </span>
                  {/* Who wrote in the stretch this closed, when it is known. A
                      version taken by housekeeping often has nobody, and
                      inventing a name for it would be worse than a blank. */}
                  {who && <span className="history-who">{who}</span>}
                  {version.reason === 'restore' && (
                    <span className="history-reason">{t('history.wasRestore')}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Both stated rather than implied, per ADR-0047. */}
      <p className="muted history-note">
        {t('history.retention', { days: retentionDays })}
      </p>
      <p className="muted history-note">{t('history.incomplete')}</p>
    </div>
  );
}
