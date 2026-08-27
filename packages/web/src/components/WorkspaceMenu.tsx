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

interface WorkspaceMenuProps {
  currentId: string;
  currentName: string;
  onSwitch: (workspaceId: string) => void;
  onCreated: (workspaceId: string) => void;
}

export function WorkspaceMenu({
  currentId,
  currentName,
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
        <span className="workspace-name">{currentName}</span>
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
              <span className="workspace-item-name">{workspace.name}</span>
              <span className="workspace-item-meta">
                {/* Counts rather than a role badge: "how much is in here" is
                    what tells two workspaces apart at a glance. */}
                {workspace.pageCount} {workspace.pageCount === 1 ? 'item' : 'items'}
                {workspace.memberCount > 1 ? ` · ${workspace.memberCount} people` : ''}
              </span>
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

            <a className="workspace-item" href={paths.settings('workspace')} role="menuitem">
              <FolderPlusIcon /> Workspace settings
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
