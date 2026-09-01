/**
 * SONE web — the workspace switcher.
 *
 * Opens from the workspace name, which is where people look for it and where
 * the settings and admin entries will belong once they exist.
 *
 * Switching workspaces changes the sync credentials, so it tears down the
 * connection and rebuilds it. That is handled by keying the client on the
 * workspace id rather than by anything here — this component only reports the
 * choice.
 *
 * The order of the list is the person's own and is dragged here (ADR-0031). It
 * is not a property of any workspace: two members of the same workspace have
 * different lists, so it lives on the membership row rather than in a document.
 */

import { useT } from '../i18n/useT.tsx';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceSummary } from '../api/client.ts';
import { useListDrag } from '../hooks/useListDrag.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { ChevronRightIcon, FolderPlusIcon, PlusIcon, SettingsIcon } from './icons.tsx';
import type { WorkspaceIcon } from '../api/client.ts';
import { WorkspaceMark } from './WorkspaceMark.tsx';
import { titleColorStyle } from './EntryIconView.tsx';

interface WorkspaceMenuProps {
  currentId: string;
  currentName: string;
  /** The mark for the workspace you are in (ADR-0030). */
  currentIcon: WorkspaceIcon | null;
  /** Whether to offer the way into the workspace administration (ADR-0027). */
  canManageWorkspaces: boolean;
  onSwitch: (workspaceId: string) => void;
  onCreated: (workspaceId: string) => void;
}

export function WorkspaceMenu({
  currentId,
  currentName,
  currentIcon,
  canManageWorkspaces,
  onSwitch,
  onCreated,
}: WorkspaceMenuProps): ReactElement {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Loaded when the menu opens rather than on mount: the list is only needed
  // once someone looks for it, and a sidebar should not make a request nobody
  // asked for.
  useEffect(() => {
    if (!open || workspaces !== null) return;
    void api
      .workspaces()
      .then((result) => setWorkspaces(result.workspaces))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.code : 'network_error'),
      );
  }, [open, workspaces]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setCreating(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        setCreating(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * Dragging a workspace into place.
   *
   * The list is reordered here first and the request follows, because a drop
   * that waits for a round trip reads as not having worked — and this is a
   * gesture somebody will repeat four times in a row.
   *
   * A failure puts the list back by discarding it: the next open reloads from
   * the server, which is the only thing that knows the real order. Keeping a
   * local guess after the write failed would show an order that does not exist.
   */
  const place = useCallback((movingId: string, afterId: string | null): void => {
    setWorkspaces((previous) => {
      if (previous === null) return previous;
      const moving = previous.find((entry) => entry.id === movingId);
      if (!moving) return previous;
      const rest = previous.filter((entry) => entry.id !== movingId);
      const at =
        afterId === null ? 0 : rest.findIndex((entry) => entry.id === afterId) + 1;
      return [...rest.slice(0, at), moving, ...rest.slice(at)];
    });

    void api.reorderWorkspace(movingId, afterId).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.code : 'network_error');
      setWorkspaces(null);
    });
  }, []);

  const drag = useListDrag({
    container: panelRef,
    onDrop: (draggedId, position) => place(draggedId, position.afterId),
  });

  /**
   * Reordering without a pointer (ADR-0031 named this as a gap).
   *
   * `⌥↑` and `⌥↓` on the row that has focus. The modifier is what keeps the
   * plain arrows doing what they do in every menu — moving between the entries —
   * and it is the combination the tree's "move up" and "move down" would bind to
   * if they had a shortcut.
   *
   * Expressed as "after which one", like every other placement here, rather than
   * as an index: one row moving up is the same operation as a drop into the gap
   * above it, and having two ways to say it is how they come to disagree.
   */
  const moveByKey = (event: React.KeyboardEvent, movingId: string): void => {
    if (!event.altKey) return;
    const up = event.key === 'ArrowUp';
    const down = event.key === 'ArrowDown';
    if (!up && !down) return;

    const list = workspaces ?? [];
    const at = list.findIndex((entry) => entry.id === movingId);
    if (at === -1) return;
    // Already at the end it is going towards. Refused quietly: a shortcut that
    // wraps around would move a workspace from the top to the bottom on a
    // keypress somebody meant as "no further".
    if ((up && at === 0) || (down && at === list.length - 1)) return;

    event.preventDefault();
    // Up: after whatever precedes the row above, which is null at the top.
    // Down: after the row below.
    place(movingId, up ? (list[at - 2]?.id ?? null) : (list[at + 1]?.id ?? null));

    // The row keeps focus, so a second press moves it again — which is the whole
    // point of a keyboard gesture and something a re-render loses by default.
    const element = event.currentTarget as HTMLElement;
    requestAnimationFrame(() => element.focus());
  };

  const create = async (): Promise<void> => {    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createWorkspace(trimmed);
      setOpen(false);
      setCreating(false);
      setName('');
      // Forces a reload of the list next time the menu opens.
      setWorkspaces(null);
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="switcher-wrap">
      <button
        ref={buttonRef}
        className="switcher-button"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((previous) => !previous)}
        title={currentName}
      >
        <WorkspaceMark name={currentName} icon={currentIcon} />
        <span className="switcher-name" style={titleColorStyle(currentIcon)}>
          {currentName}
        </span>
        <ChevronRightIcon className="switcher-caret" />
      </button>

      {/* What is travelling, drawn under the pointer.
        *
        * The two lines say where a drop lands; they do not say that a whole
        * workspace is what is moving — and in a panel four rows tall that is
        * easy to lose. The same treatment the tree uses, from the same class.
        *
        * A sibling of the panel rather than a child: the panel scrolls, and a
        * child of it would be clipped at its edge. */}
      {drag.dragging && drag.pointer && (
        <div
          className="drag-preview"
          style={{ left: drag.pointer.x, top: drag.pointer.y }}
          aria-hidden="true"
        >
          {(() => {
            const moving = workspaces?.find((entry) => entry.id === drag.dragging);
            if (!moving) return null;
            return (
              <>
                <WorkspaceMark name={moving.name} icon={moving.icon ?? null} />
                {moving.name || 'Untitled'}
              </>
            );
          })()}
        </div>
      )}

      {open && (
        <div className="switcher-menu" ref={panelRef} role="menu">
          {workspaces === null && !error && <p className="muted small">Loading…</p>}
          {error && <p className="error small">{messageFor(error)}</p>}

          {workspaces?.map((workspace, at) => (
            <button
              key={workspace.id}
              className="switcher-item"
              type="button"
              role="menuitem"
              aria-current={workspace.id === currentId}
              // The row is both the thing that switches and the thing that is
              // dragged (ADR-0031). Held still for a moment on a touch device,
              // moved straight away with a mouse; the click that follows a drag
              // is swallowed by the gesture hook, so arranging the list never
              // also switches workspace.
              data-list-row={workspace.id}
              onPointerDown={drag.onPointerDown}
              onKeyDown={(event) => moveByKey(event, workspace.id)}
              // Announced rather than printed. A hint beside every row would be
              // five lines of instruction in a five-line menu, and a screen
              // reader is where somebody who needs this is most likely to be.
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              data-dragging={drag.dragging === workspace.id ? 'true' : undefined}
              // One gap, one owner: a landing place is named by the row above
              // it, and "first" is drawn on the row that is currently first.
              data-drop={
                drag.target === null
                  ? undefined
                  : drag.target.afterId === workspace.id
                    ? 'after'
                    : drag.target.afterId === null && at === 0
                      ? 'before'
                      : undefined
              }
              onClick={() => {
                setOpen(false);
                if (workspace.id !== currentId) onSwitch(workspace.id);
              }}
            >
              {/* A mark and a name, on one line.
                *
                * The count went: how many pages a workspace holds is not how
                * anybody recognises it, and it was the reason every row needed
                * two lines. What tells them apart is the mark (ADR-0030). */}
              <WorkspaceMark
                name={workspace.name}
                icon={workspace.icon ?? null}
              />
              {/* The name colour, which was saved and never applied — the
                  chooser offered it and nothing read it back. */}
              <span
                className="switcher-item-name"
                style={titleColorStyle(workspace.icon ?? null)}
              >
                {workspace.name || 'Untitled'}
              </span>
              {workspace.memberCount > 1 && (
                <span className="switcher-item-meta">
                  {workspace.memberCount} people
                </span>
              )}
            </button>
          ))}

          <div className="switcher-footer">
            {creating ? (
              <div className="workspace-create">
                <input
                  value={name}
                  autoFocus
                  placeholder={t('workspaces.nameField')}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void create();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setCreating(false);
                    }
                  }}
                  aria-label={t('workspaces.nameField')}
                />
                <button
                  className="primary"
                  type="button"
                  disabled={busy || name.trim().length === 0}
                  onClick={() => void create()}
                >
                  {busy ? 'Creating…' : 'Create'}
                </button>
              </div>
            ) : (
              <button
                className="switcher-item"
                type="button"
                role="menuitem"
                onClick={() => setCreating(true)}
              >
                <PlusIcon /> {t('workspaces.new')}
              </button>
            )}

            {/* Straight to this workspace's row in the one list (ADR-0027).
              *
              * The section it points at is where every workspace is
              * administered, including this one — the shortcut saves the walk
              * through the list, it is not a second place to do the same thing.
              *
              * Absent for somebody who may not administer workspaces, rather
              * than present and refusing: a menu entry that answers "not found"
              * teaches people to distrust the menu. */}
            {/* The settings of the workspace you are in — where somebody
                already is when they think about it (ADR-0032). Offered to every
                member; what they may not change is disabled rather than
                hidden. */}
            <a
              className="switcher-item"
              href={paths.workspaceSettings()}
              role="menuitem"
            >
              <SettingsIcon /> {t('workspaces.settings')}
            </a>

            {canManageWorkspaces && (
              <a className="switcher-item" href={paths.admin('workspaces')} role="menuitem">
                <FolderPlusIcon /> {t('workspaces.all')}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
