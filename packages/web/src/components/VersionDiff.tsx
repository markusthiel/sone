/**
 * SONE web — what changed between two versions (ADR-0053).
 *
 * Inline, in the order of the newer side, so reading the diff reads like
 * reading the page. Not side by side: two columns on a phone is one column, and
 * the inline form is what somebody reading a page wants.
 *
 * A moved block says it moved. That is the property the block model buys and a
 * text diff cannot have, so it is worth drawing plainly rather than hiding among
 * additions and removals.
 */

import { useEffect, useState, type ReactElement } from 'react';

import type { DiffBlock, WordChange } from '@sone/core';

import { api, ApiError } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';

type Change =
  | { kind: 'added'; block: DiffBlock }
  | { kind: 'removed'; block: DiffBlock }
  | { kind: 'changed'; block: DiffBlock; words: WordChange[] }
  | { kind: 'moved'; block: DiffBlock; from: number; to: number };

export function VersionDiff({
  pageId,
  versionId,
  onClose,
}: {
  pageId: string;
  versionId: string;
  onClose: () => void;
}): ReactElement {
  const { t } = useT();
  const [against, setAgainst] = useState<'previous' | 'now'>('previous');
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [unmatched, setUnmatched] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChanges(null);
    void api
      .versionDiff(pageId, versionId, against)
      .then((result) => {
        if (cancelled) return;
        setChanges(result.changes as Change[]);
        setUnmatched(result.unmatched);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, versionId, against]);

  return (
    <div className="version-view">
      <div className="version-bar" role="status">
        {/* Two questions, and the words say which is which rather than
            "previous" and "now" — "what did this change" and "what has changed
            since" are what somebody is actually asking (ADR-0053). */}
        <div className="diff-choice">
          <button
            type="button"
            className={against === 'previous' ? 'panel-choice current' : 'panel-choice'}
            onClick={() => setAgainst('previous')}
          >
            {t('diff.whatThisDid')}
          </button>
          <button
            type="button"
            className={against === 'now' ? 'panel-choice current' : 'panel-choice'}
            onClick={() => setAgainst('now')}
          >
            {t('diff.sinceThen')}
          </button>
        </div>
        <button type="button" className="btn subtle" onClick={onClose}>
          {t('history.backToNow')}
        </button>
      </div>

      {error && <p className="error">{t(`error.${error}` as MessageKey)}</p>}
      {changes === null && !error && <p className="muted">{t('panel.loading')}</p>}

      {changes?.length === 0 && <p className="muted">{t('diff.nothing')}</p>}

      {changes && changes.length > 0 && (
        <div className="diff-body">
          {changes.map((change) => (
            <div key={`${change.kind}-${change.block.id}`} className="diff-block" data-kind={change.kind}>
              <span className="diff-label">{t(`diff.${change.kind}` as MessageKey)}</span>

              {change.kind === 'changed' ? (
                <p>
                  {change.words.map((word, at) => (
                    // The index is part of the key because the same word can
                    // appear twice in one paragraph with different fates.
                    <span key={`${at}-${word.kind}`} className={`diff-word ${word.kind}`}>
                      {word.text}
                    </span>
                  ))}
                </p>
              ) : (
                <p>{change.block.text || t('diff.empty')}</p>
              )}

              {change.kind === 'moved' && (
                <span className="diff-detail">
                  {t('diff.movedFrom', { from: change.from + 1, to: change.to + 1 })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Both limits said where the comparison is shown, not in a document
          somebody would have to find (ADR-0053). */}
      <p className="settings-note">{t('diff.noFormatting')}</p>
      {unmatched > 0 && (
        <p className="settings-note">{t('diff.approximate', { count: unmatched })}</p>
      )}
    </div>
  );
}
