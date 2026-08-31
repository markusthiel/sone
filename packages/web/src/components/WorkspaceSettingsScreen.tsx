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

import { useState, type ReactElement } from 'react';

import { api, type SessionInfo, type WorkspaceIcon } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { GroupsPanel } from './GroupsPanel.tsx';
import { useT } from '../i18n/useT.tsx';
import { SettingsShell, resolveSection } from './SettingsShell.tsx';
import { ThemeSettings } from './ThemeSettings.tsx';
import { WorkspaceAppearance } from './WorkspaceAppearance.tsx';
import { WorkspaceInvite } from './WorkspaceInvite.tsx';
import { WorkspaceMembers } from './WorkspaceMembers.tsx';

const SECTIONS = [
  { id: 'general', label: 'workspace.nameAndMark', hint: 'workspace.nameAndMark.hint' },
  // Unreachable until now. It was rendered by the old screen and had been
  // removed from that screen's list, so the per-workspace heading sizes and text
  // scale could not be opened at all (ADR-0032).
  { id: 'typography', label: 'workspace.typography', hint: 'workspace.typography.hint' },
  { id: 'people', label: 'workspace.people', hint: 'workspace.people.hint' },
  // Unreachable for the same reason.
  { id: 'groups', label: 'workspace.groups', hint: 'workspace.groups.hint' },
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
  const [listOpen, setListOpen] = useState(false);
  const current = resolveSection(SECTIONS, section);
  const workspace = session.workspaces.find((entry) => entry.id === workspaceId);
  const canAdminister =
    session.user.isInstanceAdmin || session.user.canManageWorkspaces;

  // The same two roles the server enforces, stated here so the controls are
  // disabled rather than failing on save.
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin';

  return (
    <SettingsShell
      // The area names the subject; the name below it says which workspace.
      area="This workspace"
      areaId="workspace"
      subtitle={workspace?.name || 'Untitled'}
      canAdminister={canAdminister}
      sections={SECTIONS.map((entry) => ({
        id: entry.id,
        label: t(entry.label),
        hint: t(entry.hint),
      }))}
      current={current}
      hrefFor={(id) => paths.workspaceSettings(id)}
      listOpen={listOpen}
      onListOpen={setListOpen}
      account={{
        displayName: session.user.displayName,
        userId: session.user.id,
        onLogout,
      }}
      onClose={onClose}
    >
      {current === 'general' && (
        <General
          workspaceId={workspaceId}
          name={workspace?.name ?? ''}
          icon={workspace?.icon ?? null}
          role={workspace?.role ?? 'unknown'}
          canEdit={canEdit}
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
    </SettingsShell>
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
