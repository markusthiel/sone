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
import { messageFor } from './Auth.tsx';

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
  entry: { id: string; title: string };
  session: SessionInfo;
  currentWorkspaceId: string;
  /** Reloads the tree; the entry is no longer in this workspace. */
  onMoved: () => void;
  onCancel: () => void;
}

/** The lines the confirmation shows. Only the ones that are not zero. */
function consequences(cost: Cost): string[] {
  const lines: string[] = [];
  const plural = (n: number, one: string, many: string): string =>
    `${n} ${n === 1 ? one : many}`;

  lines.push(`${plural(cost.pages, 'entry', 'entries')} will move.`);
  if (cost.files > 0) {
    lines.push(`${plural(cost.files, 'file', 'files')} will move with them.`);
  }
  if (cost.restrictions > 0) {
    // First of the losses, because it is the one that changes who can read
    // something. A restriction names members and groups of the workspace being
    // left, and there is no honest translation.
    lines.push(
      `${plural(cost.restrictions, 'entry', 'entries')} will arrive without the ` +
        `restriction they have now — everyone in the new workspace will be able to read them.`,
    );
  }
  if (cost.shareLinks > 0) {
    lines.push(`${plural(cost.shareLinks, 'share link', 'share links')} will stop working.`);
  }
  if (cost.references > 0) {
    lines.push(
      `${plural(cost.references, 'link', 'links')} between these entries and ones ` +
        `staying behind will be severed.`,
    );
  }
  if (cost.favourites > 0) {
    lines.push(
      `${plural(cost.favourites, 'favourite', 'favourites')} held by people who are ` +
        `not in the new workspace will be dropped.`,
    );
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
        aria-label={`Move ${entry.title || 'this entry'} to another workspace`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">Move to another workspace</h2>

        {error && <p className="error">{messageFor(error)}</p>}

        {destinations.length === 0 ? (
          <p className="muted">
            There is nowhere to move this. An entry can only go to a workspace you
            own or administer.
          </p>
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

        {busy && cost === null && <p className="muted">Working out what this moves…</p>}

        {cost && chosen && (
          <div className="move-consequences">
            <p>
              Moving <strong>{entry.title || 'this entry'}</strong> to{' '}
              <strong>{chosen.name}</strong>:
            </p>
            <ul>
              {consequences(cost).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {/* Said once, plainly, because it is the answer to "can I undo
                this": no, and moving it back is a second move with its own
                losses. */}
            <p className="muted">
              Moving it back later is another move, with the same kinds of
              consequence.
            </p>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || cost === null}
            onClick={() => void move()}
          >
            {busy && cost !== null ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
