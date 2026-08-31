/**
 * SONE web — the trash.
 *
 * Deleting archives, and until now nothing showed what had been archived — so
 * "delete" was in practice irreversible, which is not what the word promises in
 * a note tool. This is the way back.
 *
 * One archiving action is one row here. Deleting a folder archives everything
 * inside it, and listing all of that would show one deletion as forty entries
 * and bury what somebody is looking for. The count of what went with it is
 * shown instead, because restoring forty things by pressing one button should
 * not be a surprise.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type TrashEntry } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { useMessage } from './Auth.tsx';
import { FolderIcon, PageIcon } from './icons.tsx';

interface TrashProps {
  workspaceId: string;
  /** Called after a restore, so the tree picks the entry up again. */
  onChanged: () => void;
}

export function Trash({ workspaceId, onChanged }: TrashProps): ReactElement {
  const { t } = useT();
  const message = useMessage();
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries((await api.trash(workspaceId)).entries);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (entry: TrashEntry): Promise<void> => {
    setBusy(true);
    try {
      await api.restoreEntry(entry.id);
      await load();
      onChanged();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (entry: TrashEntry): Promise<void> => {
    setBusy(true);
    try {
      await api.deleteEntryPermanently(entry.id);
      setConfirming(null);
      await load();
      onChanged();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="error">{message(error)}</p>;
  if (!entries) return <p className="muted">{t('trash.loading')}</p>;

  if (entries.length === 0) {
    return (
      <div className="page-body">
        <h1>{t('trash.title')}</h1>
        <p className="muted">{t('trash.empty')}</p>
      </div>
    );
  }

  return (
    <div className="page-body">
      <h1>{t('trash.title')}</h1>
      <p className="muted settings-note">
        {t('trash.note')}
      </p>

      <div className="admin-table">
        {entries.map((entry) => (
          <div className="admin-row" key={entry.id}>
            <div className="admin-row-main">
              <span className="admin-name">
                {entry.kind === 'folder' ? <FolderIcon /> : <PageIcon />}{' '}
                {entry.title || (entry.kind === 'folder' ? 'Untitled folder' : 'Untitled')}
              </span>
              <span className="admin-meta">
                deleted {new Date(entry.archivedAt).toLocaleString()}
                {/* Restoring forty things by pressing one button should not be
                    a surprise. */}
                {entry.descendants > 0 &&
                  ` · with ${entry.descendants} entr${entry.descendants === 1 ? 'y' : 'ies'} inside`}
                {entry.parentMissing && ' · the folder it was in is gone'}
              </span>
            </div>

            <div className="admin-row-actions">
              {confirming === entry.id ? (
                <>
                  {/* The confirmation says what cannot be undone rather than
                      asking "are you sure", which nobody reads. */}
                  <span className="muted">{t('trash.confirm')}</span>
                  <button
                    type="button"
                    className="btn destructive"
                    disabled={busy}
                    onClick={() => void destroy(entry)}
                  >
                    {t('trash.destroy')}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirming(null)}>
                    {t('trash.keep')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void restore(entry)}
                  >
                    {t('trash.restore')}
                  </button>
                  <button
                    type="button"
                    className="btn destructive"
                    disabled={busy}
                    onClick={() => setConfirming(entry.id)}
                  >
                    {t('trash.destroy')}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
