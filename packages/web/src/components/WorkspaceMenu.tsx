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
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceSummary } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { ChevronRightIcon, FolderPlusIcon, PlusIcon } from './icons.tsx';
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

  const create = async (): Promise<void> => {
    const trimmed = name.trim();
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
    <div className="workspace-menu-wrap">
      <button
        ref={buttonRef}
        className="workspace-button"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((previous) => !previous)}
        title={currentName}
      >
        <WorkspaceMark name={currentName} icon={currentIcon} />
        <span className="workspace-name" style={titleColorStyle(currentIcon)}>
          {currentName}
        </span>
        <ChevronRightIcon className="workspace-caret" />
      </button>

      {open && (
        <div className="workspace-menu" ref={panelRef} role="menu">
          {workspaces === null && !error && <p className="muted small">Loading…</p>}
          {error && <p className="error small">{messageFor(error)}</p>}

          {workspaces?.map((workspace) => (
            <button
              key={workspace.id}
              className="workspace-item"
              type="button"
              role="menuitem"
              aria-current={workspace.id === currentId}
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
                className="workspace-item-name"
                style={titleColorStyle(workspace.icon ?? null)}
              >
                {workspace.name || 'Untitled'}
              </span>
              {workspace.memberCount > 1 && (
                <span className="workspace-item-meta">
                  {workspace.memberCount} people
                </span>
              )}
            </button>
          ))}

          <div className="workspace-menu-footer">
            {creating ? (
              <div className="workspace-create">
                <input
                  value={name}
                  autoFocus
                  placeholder="Workspace name"
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
                  aria-label="Workspace name"
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
                className="workspace-item"
                type="button"
                role="menuitem"
                onClick={() => setCreating(true)}
              >
                <PlusIcon /> New workspace
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
            {canManageWorkspaces && (
              <a
                className="workspace-item"
                href={paths.settings('workspaces')}
                role="menuitem"
              >
                <FolderPlusIcon /> Manage workspaces
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
