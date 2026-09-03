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
  onCompare,
}: {
  pageId: string | null;
  members: WorkspaceMember[];
  /** Which version is being read, if any. */
  viewing: string | null;
  onView: (versionId: string | null) => void;
  /** Show what a version changed, rather than what it said (ADR-0053). */
  onCompare: (versionId: string) => void;
}): ReactElement {
  const { t } = useT();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <>
          <button
            type="button"
            className="btn primary history-back"
            onClick={() => onView(null)}
          >
            {t('history.backToNow')}
          </button>

          {/* What restoring actually does, said before it is done.
            *
            * "Restore" in most applications means going back and losing what
            * came after. Here it is an edit applied forward: the page reads as
            * it did, the versions in between stay, and the restore itself
            * becomes one of them (ADR-0047). Somebody who expects the usual
            * meaning has to be told the truth, not reassured. */}
          <button
            type="button"
            className="btn history-restore"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api
                .restoreVersion(pageId ?? '', viewing)
                .then(() => {
                  onView(null);
                })
                .catch((err: unknown) => {
                  setError(err instanceof ApiError ? err.code : 'network_error');
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('history.restore')}
          </button>
          <p className="muted history-note">{t('history.restoreMeans')}</p>
        </>
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
                {/* Beside the entry rather than inside it: the entry opens the
                    version, and this asks a different question about it
                    (ADR-0053). One control doing both would make somebody
                    choose before they knew which they wanted. */}
                <button
                  type="button"
                  className="history-compare"
                  onClick={() => onCompare(version.id)}
                >
                  {t('diff.compare')}
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
