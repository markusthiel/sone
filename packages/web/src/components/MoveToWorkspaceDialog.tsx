/**
 * SONE web — moving an entry to another workspace (ADR-0038).
 *
 * The decision the record settled is that a move *loses* things — restrictions
 * cannot be translated, share links have to be revoked, relations across the new
 * boundary have to be severed — and that showing what will be lost is better than
 * refusing until somebody has cleared it themselves. Refusing is stricter and
 * reads as tidier, but it makes a person guess what to clear and then do it
 * blind.
 *
 * So this asks twice. First which workspace, then a sentence per consequence,
 * counted from the actual subtree by a dry run of the same code that performs the
 * move. The real move counts again inside its own transaction, so what was shown
 * is what happened rather than what was true a minute ago.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type SessionInfo } from '../api/client.ts';
import type { MessageKey } from '../i18n/messages.en.ts';
import { useT } from '../i18n/useT.tsx';
import { useMessage } from './Auth.tsx';

interface Cost {
  pages: number;
  files: number;
  shareLinks: number;
  restrictions: number;
  references: number;
  favourites: number;
}

interface Props {
  /** What is moving, and where it is now. */
  /** A title can be absent for a page kept only as a path (ADR-0026) — and
   *  such a page offers no menu, so this dialog never opens for one. Typed
   *  honestly all the same: the alternative is a cast at the call site. */
  entry: { id: string; title: string | null };
  session: SessionInfo;
  currentWorkspaceId: string;
  /** Reloads the tree; the entry is no longer in this workspace. */
  onMoved: () => void;
  onCancel: () => void;
}

/**
 * The lines the confirmation shows. Only the ones that are not zero.
 *
 * Each line is one catalogue message with a `plural` branch (ADR-0041). It used
 * to be `n === 1 ? 'entry' : 'entries'`, which is not a string with a variant —
 * it is English grammar in code, and no translator can do anything with it. The
 * German catalogue needs a different verb *and* a different pronoun in the
 * restriction line, which that shape could not express at all.
 *
 * The restriction line comes first among the losses, because it is the only one
 * that changes who can read something.
 */
function consequences(
  cost: Cost,
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
): string[] {
  const lines = [t('move.workspace.entries', { count: cost.pages })];
  const maybe: Array<[number, MessageKey]> = [
    [cost.files, 'move.workspace.files'],
    [cost.restrictions, 'move.workspace.restrictions'],
    [cost.shareLinks, 'move.workspace.shareLinks'],
    [cost.references, 'move.workspace.references'],
    [cost.favourites, 'move.workspace.favourites'],
  ];
  for (const [count, key] of maybe) {
    if (count > 0) lines.push(t(key, { count }));
  }
  return lines;
}

export function MoveToWorkspaceDialog({
  entry,
  session,
  currentWorkspaceId,
  onMoved,
  onCancel,
}: Props): ReactElement {
  /**
   * Where it could go.
   *
   * Only workspaces this person owns or administers, which is the same rule the
   * route enforces — anything less would be a way to push content into a
   * workspace where you have no standing, and its owners would find pages they
   * did not put there. Filtering here as well means the impossible choice is
   * never offered rather than offered and refused.
   */
  const destinations = session.workspaces.filter(
    (workspace) =>
      workspace.id !== currentWorkspaceId &&
      (workspace.role === 'owner' || workspace.role === 'admin'),
  );

  const { t } = useT();
  const message = useMessage();
  const [target, setTarget] = useState<string | null>(null);
  const [cost, setCost] = useState<Cost | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** Ask what it would cost, without changing anything. */
  const ask = async (workspaceId: string): Promise<void> => {
    setTarget(workspaceId);
    setCost(null);
    setError(null);
    setBusy(true);
    try {
      const answer = await api.moveToWorkspace(entry.id, workspaceId, true);
      setCost(answer.cost);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
      setTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const move = async (): Promise<void> => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.moveToWorkspace(entry.id, target);
      onMoved();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  const chosen = destinations.find((workspace) => workspace.id === target);

  return (
    <div className="dialog-scrim" onPointerDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('move.workspace.label', { title: entry.title || 'this entry' })}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t('move.workspace.title')}</h2>

        {error && <p className="error">{message(error)}</p>}

        {destinations.length === 0 ? (
          <p className="muted">{t('move.workspace.nowhere')}</p>
        ) : (
          <div className="dialog-list">
            {destinations.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className={
                  workspace.id === target ? 'dialog-item current' : 'dialog-item'
                }
                aria-pressed={workspace.id === target}
                disabled={busy}
                onClick={() => void ask(workspace.id)}
              >
                <span className="dialog-item-label">{workspace.name}</span>
                <span className="muted">{workspace.role}</span>
              </button>
            ))}
          </div>
        )}

        {busy && cost === null && (
          <p className="muted">{t('move.workspace.working')}</p>
        )}

        {cost && chosen && (
          <div className="move-consequences">
            {/* One message with both names in it rather than a sentence built
                from pieces: word order differs by language, and concatenation
                cannot express that (ADR-0011). */}
            <p>
              {t('move.workspace.intro', {
                title: entry.title || 'this entry',
                workspace: chosen.name,
              })}
            </p>
            <ul>
              {consequences(cost, t).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {/* Said once, plainly, because it is the answer to "can I undo
                this": no, and moving it back is a second move with its own
                losses. */}
            <p className="muted">{t('move.workspace.again')}</p>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || cost === null}
            onClick={() => void move()}
          >
            {busy && cost !== null ? t('action.moving') : t('action.move')}
          </button>
        </div>
      </div>
    </div>
  );
}
