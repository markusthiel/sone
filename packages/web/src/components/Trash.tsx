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
 *
 * Two things a row can answer that it could not before (ADR-0071): what is in
 * it, without opening it — an archived page is not in the tree and the editor
 * cannot reach it — and where it should come back to, when the folder it was in
 * went as well.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type PageNode, type TrashEntry } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { useMessage } from './Auth.tsx';
import { FolderIcon, PageIcon } from './icons.tsx';
import { RestoreDialog } from './RestoreDialog.tsx';
import { daysLeft, entriesIn, type TrashView } from './TrashPanel.tsx';

interface TrashProps {
  workspaceId: string;
  /** Which of the panel's views is selected (ADR-0069). */
  view: TrashView;
  /** What is being looked for, from the panel's field (ADR-0071). */
  query: string;
  /** The entries, held by the shell so the panel can count them too. */
  entries: TrashEntry[] | null;
  onEntries: (entries: TrashEntry[] | null) => void;
  /** The living tree, to offer somewhere to restore into. */
  tree: PageNode[];
  /** Called after a restore, so the tree picks the entry up again. */
  onChanged: () => void;
}

/** What an entry says, once somebody has asked. */
type Preview =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'read'; blocks: Array<{ type: string; text: string }>; truncated: boolean };

export function Trash({
  workspaceId,
  view,
  query,
  entries,
  onEntries,
  tree,
  onChanged,
}: TrashProps): ReactElement {
  const { t } = useT();
  const message = useMessage();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<TrashEntry | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Previews, kept once read.
   *
   * Closing and reopening a row is something somebody does while comparing two
   * of them, and a second request for a page that cannot have changed — it is
   * archived — would be a request for nothing.
   */
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      onEntries((await api.trash(workspaceId)).entries);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = (entry: TrashEntry): void => {
    if (open === entry.id) {
      setOpen(null);
      return;
    }
    setOpen(entry.id);
    if (previews[entry.id]) return;
    setPreviews((current) => ({ ...current, [entry.id]: { state: 'loading' } }));
    void api
      .pagePreview(entry.id)
      .then((result) =>
        setPreviews((current) => ({
          ...current,
          [entry.id]: {
            state: 'read',
            blocks: result.blocks,
            truncated: result.truncated,
          },
        })),
      )
      .catch(() =>
        // Its own state rather than the page-level error: a preview that could
        // not be read must not look like the trash itself having failed.
        setPreviews((current) => ({ ...current, [entry.id]: { state: 'failed' } })),
      );
  };

  const restore = async (entry: TrashEntry, parentPageId?: string | null): Promise<void> => {
    setBusy(true);
    try {
      await api.restoreEntry(entry.id, parentPageId ?? undefined);
      setChoosing(null);
      await load();
      onChanged();
      setError(null);
    } catch (err) {
      /*
       * The one failure with an answer (ADR-0071).
       *
       * `parent_missing` is not a fault to report, it is a question: the folder
       * this was in is gone, so where should it go? The listing marks these
       * rows in advance, and this catch is for the case where the folder was
       * deleted by somebody else while this page was open.
       */
      if (err instanceof ApiError && err.code === 'parent_missing') {
        setChoosing(entry);
      } else {
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
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
        <h1 className="page-title">{t('trash.title')}</h1>
        <p className="muted">{t('trash.empty')}</p>
      </div>
    );
  }

  const shown = entriesIn(entries, view, query);

  return (
    <div className="page-body">
      <h1 className="page-title">{t('trash.title')}</h1>
      <p className="muted settings-note">{t('trash.note')}</p>

      {/* An empty view and an empty trash are different facts. Saying "nothing
          in the trash" while thirty things sit in another view would be
          untrue. */}
      {shown.length === 0 && (
        <p className="muted">
          {query.trim() === '' ? t('trash.emptyView') : t('trash.noMatch', { query })}
        </p>
      )}

      <div className="admin-table">
        {shown.map((entry) => (
          <div className="admin-row trash-row" key={entry.id}>
            <div className="admin-row-main">
              <span className="admin-name">
                {entry.kind === 'folder' ? <FolderIcon /> : <PageIcon />}{' '}
                {entry.title ||
                  (entry.kind === 'folder' ? t('folder.untitled') : t('page.untitled'))}
              </span>
              <span className="admin-meta">
                {t('trash.deletedAt', { at: new Date(entry.archivedAt).toLocaleString() })}
                {/* Restoring forty things by pressing one button should not be
                    a surprise. */}
                {entry.descendants > 0 && ` · ${t('trash.withInside', { count: entry.descendants })}`}
                {entry.parentMissing && ` · ${t('trash.folderGone')}`}
              </span>
              {/* How much of the thirty days is left (ADR-0027).
                *
                * A trash that does not say this is a trash that quietly loses
                * things: "deleted on the 12th" is a date somebody has to do
                * arithmetic on, and nobody does it until the thing is gone. */}
              <span
                className="admin-meta trash-left"
                data-soon={daysLeft(entry) <= 7 ? 'true' : undefined}
              >
                {t('trash.daysLeft', { count: daysLeft(entry) })}
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
                  {/* Reading before deciding. A folder holds no text of its
                      own, so it is offered nothing to read. */}
                  {entry.kind !== 'folder' && (
                    <button
                      type="button"
                      className="btn"
                      aria-expanded={open === entry.id}
                      onClick={() => preview(entry)}
                    >
                      {open === entry.id ? t('trash.hide') : t('trash.read')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    // A row whose folder is gone asks where before it acts:
                    // pressing "restore" and getting an error is not an answer
                    // anybody can do anything with.
                    onClick={() =>
                      entry.parentMissing && entry.kind !== 'folder'
                        ? setChoosing(entry)
                        : void restore(entry)
                    }
                  >
                    {entry.parentMissing && entry.kind !== 'folder'
                      ? t('trash.restoreTo')
                      : t('trash.restore')}
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

            {open === entry.id && (
              <div className="trash-preview">
                {previews[entry.id]?.state === 'loading' && (
                  <p className="muted">{t('panel.loading')}</p>
                )}
                {previews[entry.id]?.state === 'failed' && (
                  <p className="muted">{t('trash.unreadable')}</p>
                )}
                {(() => {
                  const read = previews[entry.id];
                  if (read?.state !== 'read') return null;
                  if (read.blocks.length === 0) {
                    return <p className="muted">{t('trash.nothingInIt')}</p>;
                  }
                  return (
                    <>
                      {read.blocks.map((block, at) => (
                        // Text, never the page. A preview that tried to render
                        // the document would be a second renderer to keep in
                        // step with the first.
                        <p key={at} data-block={block.type}>
                          {block.text}
                        </p>
                      ))}
                      {read.truncated && <p className="muted">{t('trash.andMore')}</p>}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        ))}
      </div>

      {choosing && (
        <RestoreDialog
          entry={choosing}
          tree={tree}
          onRestore={(parentPageId) => void restore(choosing, parentPageId)}
          onCancel={() => setChoosing(null)}
        />
      )}
    </div>
  );
}
