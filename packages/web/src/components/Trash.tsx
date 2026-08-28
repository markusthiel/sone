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
import { messageFor } from './Auth.tsx';
import { FolderIcon, PageIcon } from './icons.tsx';

interface TrashProps {
  workspaceId: string;
  /** Called after a restore, so the tree picks the entry up again. */
  onChanged: () => void;
}

export function Trash({ workspaceId, onChanged }: TrashProps): ReactElement {
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

  if (error) return <p className="error">{messageFor(error)}</p>;
  if (!entries) return <p className="muted">Loading…</p>;

  if (entries.length === 0) {
    return (
      <div className="page-body">
        <h1>Trash</h1>
        <p className="muted">Nothing has been deleted.</p>
      </div>
    );
  }

  return (
    <div className="page-body">
      <h1>Trash</h1>
      <p className="muted settings-note">
        Deleted entries stay here until they are destroyed. Nothing is removed on
        a schedule — an instance that quietly empties its own trash is one that
        loses somebody’s work while they are on holiday.
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
                  <span className="muted">Destroy permanently? This cannot be undone.</span>
                  <button
                    type="button"
                    className="btn destructive"
                    disabled={busy}
                    onClick={() => void destroy(entry)}
                  >
                    Destroy
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirming(null)}>
                    Keep
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
                    Restore
                  </button>
                  <button
                    type="button"
                    className="btn destructive"
                    disabled={busy}
                    onClick={() => setConfirming(entry.id)}
                  >
                    Destroy
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
