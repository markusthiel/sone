/**
 * SONE web — settings that belong to the workspace you are in (ADR-0032).
 *
 * One of three areas. The boundary is whose settings these are, not who may
 * change them — so typography lives here although it is about appearance,
 * because everybody reading this workspace sees it, while "where you land" lives
 * in your own settings although it is about a workspace, because the value is
 * one person's.
 *
 * Every member may open this. Where they may not write, the controls are
 * disabled rather than the section being hidden: a form that lets somebody fill
 * it in and then refuses is worse than one that says up front it is read-only.
 * That is also why nothing here is gated on the administration right — this is
 * not the administration area.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { api, type SessionInfo, type WorkspaceIcon } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { GroupsPanel } from './GroupsPanel.tsx';
import { useT } from '../i18n/useT.tsx';
import { resolveSection } from './SectionNav.tsx';
import { ThemeSettings } from './ThemeSettings.tsx';
import { WorkspaceAppearance } from './WorkspaceAppearance.tsx';
import { WorkspaceExport } from './WorkspaceExport.tsx';
import { WorkspaceInvite } from './WorkspaceInvite.tsx';
// `WorkspaceInvite` was already imported here — the screen had the component
// and no section that rendered it, which is its own small version of the drift.
import { WorkspaceDeletion } from './WorkspaceDeletion.tsx';
import { WorkspaceMembers } from './WorkspaceMembers.tsx';

export const SECTIONS = [
  { id: 'general', label: 'workspace.nameAndMark', hint: 'workspace.nameAndMark.hint' },
  // Unreachable until now. It was rendered by the old screen and had been
  // removed from that screen's list, so the per-workspace heading sizes and text
  // scale could not be opened at all (ADR-0032).
  { id: 'typography', label: 'workspace.typography', hint: 'workspace.typography.hint' },
  { id: 'people', label: 'workspace.people', hint: 'workspace.people.hint' },
  // Unreachable for the same reason.
  { id: 'groups', label: 'workspace.groups', hint: 'workspace.groups.hint' },
  // Where the record put it: a workspace export belongs to the workspace, not
  // to a page's ⋮ menu and not to the administration area — it is not a backup
  // (ADR-0044).
  { id: 'export', label: 'workspace.export', hint: 'workspace.export.hint' },
  /*
   * The two the administration had and this screen did not (ADR-0067).
   *
   * Which is the other half of the drift ADR-0027 predicted: an owner looking
   * after their own workspace could not invite to it from here, and could not
   * delete it at all. Both sections are the same components the administration
   * was rendering — moved, not rewritten.
   */
  { id: 'invitations', label: 'workspace.invitations', hint: 'workspace.invitations.hint' },
  { id: 'delete', label: 'workspaces.delete', hint: 'workspace.delete.hint' },
] as const;

interface WorkspaceSettingsProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
  onClose: () => void;
  /** Signing out, which the account menu at the foot of the column offers. */
  onLogout: () => void;
}

export function WorkspaceSettingsScreen({
  section,
  session,
  workspaceId,
  onClose,
  onLogout,
}: WorkspaceSettingsProps): ReactElement {
  const { t } = useT();
  const current = resolveSection(SECTIONS, section);
  /*
   * From the session, or fetched when this is not one of mine.
   *
   * The session carries only the workspaces somebody is in, so an administrator
   * opening a foreign one had no name and no icon — it read "Untitled" with
   * everything greyed out. The list route is scoped by the same rights, so
   * asking it is asking the one source that already knows.
   */
  const own = session.workspaces.find((entry) => entry.id === workspaceId);
  const [fetched, setFetched] = useState<{ name: string; icon: WorkspaceIcon | null } | null>(
    null,
  );

  useEffect(() => {
    if (own || !workspaceId) return;
    void api
      .adminWorkspaces()
      .then((result) => {
        const found = result.workspaces.find((entry) => entry.id === workspaceId);
        setFetched(found ? { name: found.name, icon: found.icon ?? null } : null);
      })
      .catch(() => {
        // No name is better than a wrong one; the sections still work.
        setFetched(null);
      });
  }, [own, workspaceId]);

  const workspace = own ?? (fetched ? { ...fetched, role: 'unknown' as const } : undefined);
  const canAdminister =
    session.user.isInstanceAdmin || session.user.canManageWorkspaces;

  /*
   * What the server actually enforces, which is more than this said (ADR-0067).
   *
   * It read the workspace role alone — owner or admin of *this* workspace. The
   * route has always accepted the role **or** the instance-wide
   * workspace-management right, which is how somebody administers a workspace
   * they are not in. So an administrator opening a foreign workspace found
   * every control disabled while the server would have accepted the save: the
   * interface was stricter than the rule it was mirroring.
   *
   * Found by reading the route rather than by a failure, because a disabled
   * control produces no failure to read.
   */
  const manages = session.user.isInstanceAdmin || session.user.canManageWorkspaces;
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin' || manages;

  return (
    <div className="settings-body">
      <h1 className="page-title">{t(SECTIONS.find((e) => e.id === current)?.label ?? 'workspace.area')}</h1>
      {current === 'general' && (
        <General
          workspaceId={workspaceId}
          name={workspace?.name ?? ''}
          icon={workspace?.icon ?? null}
          role={workspace?.role ?? 'unknown'}
          canEdit={canEdit}
        />
      )}
      {current === 'invitations' && <WorkspaceInvite workspaceId={workspaceId} />}

      {current === 'delete' && (
        <WorkspaceDeletion
          workspaceId={workspaceId}
          name={workspace?.name ?? ''}
          // The rights decide whether it can be used, not whether it is there.
          canDelete={canEdit}
          onDeleted={onClose}
        />
      )}

      {current === 'typography' && (
        <ThemeSettings workspaceId={workspaceId} canEdit={canEdit} />
      )}
      {current === 'people' && (
        <section className="settings-section">
          {/* The same table the administration list shows, and the reason this
            * section exists: the server has always let a workspace's owners and
            * administrators manage their own members, and only the interface
            * required the instance-wide right for it (ADR-0032). */}
          <WorkspaceMembers workspaceId={workspaceId} canAdminister={canEdit} />

          {/* Inviting is offered only to those who may. The server refuses
            * either way; a form that lets somebody fill it in and then refuses
            * is worse than one that is not there — and unlike a role, an
            * invitation has nothing to read when you cannot make one. */}
          {canEdit && <WorkspaceInvite workspaceId={workspaceId} />}
        </section>
      )}
      {current === 'groups' && <GroupsPanel workspaceId={workspaceId} />}
      {current === 'export' && <WorkspaceExport workspaceId={workspaceId} />}
    </div>
  );
}

/**
 * What the workspace is called, and how it is recognised.
 *
 * The name is saved on its own request from the mark, because the icon endpoint
 * deliberately sends no name: setting an icon must not overwrite a rename
 * somebody else made in between (ADR-0030).
 */
function General({
  workspaceId,
  name,
  icon,
  role,
  canEdit,
}: {
  workspaceId: string;
  name: string;
  icon: WorkspaceIcon | null;
  role: string;
  canEdit: boolean;
}): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState(name);
  // Held here rather than reloaded: reloading threw the panel away and the list
  // it came back to draws no marks, so a saved change looked unsaved (ADR-0030).
  const [chosen, setChosen] = useState<WorkspaceIcon | null>(icon);
  const [error, setError] = useState<string | null>(null);

  const saveName = (): void => {
    const next = draft.trim();
    if (next.length === 0 || next === name) return;
    setError(null);
    void api
      .renameWorkspace(workspaceId, next)
      // Reloaded, because the name is in the switcher, the sidebar and the
      // session — one copy updated here would leave the others saying the old
      // one.
      .then(() => window.location.reload())
      .catch(() => setError('network_error'));
  };

  return (
    <section className="settings-section">
      {error && <p className="error">{t('workspace.saveFailed')}</p>}

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('workspace.name')}</b>
            <span>{t('workspace.name.hint')}</span>
          </span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            disabled={!canEdit}
            aria-label={t('workspace.nameLabel')}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('workspace.role')}</b>
            <span>{t('workspace.role.hint')}</span>
          </span>
          <span>{role}</span>
        </div>
      </div>

      {/* How it is recognised, which is what somebody scanning a switcher of
        * five workspaces actually uses (ADR-0030). */}
      <h3 className="settings-heading">{t('workspace.mark')}</h3>
      <div className="settings-card">
        <WorkspaceAppearance workspaceId={workspaceId} icon={chosen} onChanged={setChosen} />
      </div>
    </section>
  );
}
