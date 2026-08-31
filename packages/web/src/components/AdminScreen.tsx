/**
 * SONE web — the instance everybody shares (ADR-0032).
 *
 * One of three areas, and the only one that is absent rather than disabled for
 * somebody without the right: a menu entry that answers "not found" teaches
 * people to distrust the menu (ADR-0027).
 *
 * Two rights, not one. Instance administration is one; administering every
 * workspace is another, which an instance administrator has implicitly and
 * somebody granted it has without being one. The section list is filtered by
 * both, in one place, so a section cannot be missing from the navigation and
 * still reachable.
 *
 * The right is confirmed by asking the server rather than trusting the session:
 * the server answers 404 to anybody who may not, so a failure means "no". While
 * the answer is unknown nothing is rendered — a section shown speculatively
 * would fail with an error that looks like a bug.
 */

import { useState, type ReactElement } from 'react';

import { api, type SessionInfo, type WorkspaceIcon } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import {
  InstancePanel,
  MaintenancePanel,
  UsersPanel,
  useIsInstanceAdmin,
} from './Admin.tsx';
import { InvitePanel } from './InvitePanel.tsx';
import { OidcPanel } from './OidcPanel.tsx';
import { SettingsShell, resolveSection, type ShellSection } from './SettingsShell.tsx';
import { WorkspaceDetail } from './WorkspaceDetail.tsx';
import { WorkspaceList } from './WorkspaceList.tsx';

interface AdminSection extends ShellSection {
  /** Instance administration. Absent without it. */
  admin?: true;
  /** The narrower right to administer every workspace (ADR-0027). */
  manager?: true;
}

const SECTIONS: readonly AdminSection[] = [
  { id: 'instance', label: 'This instance', hint: 'Name, sign-up and defaults', admin: true },
  { id: 'accounts', label: 'Accounts', hint: 'Everybody with an account here', admin: true },
  {
    id: 'invite',
    label: 'Invitations',
    // Named against the other invitation rather than "Invite people", which is
    // also the name of inviting somebody to a workspace.
    hint: 'An account and a workspace of their own — no team',
    admin: true,
  },
  { id: 'sso', label: 'Single sign-on', hint: 'Sign in through an identity provider', admin: true },
  {
    id: 'workspaces',
    label: 'All workspaces',
    // Distinct from the workspace area: that one is the workspace you are in,
    // this is every workspace here including ones you are not a member of.
    hint: 'Every workspace here, and who is in them',
    manager: true,
  },
  { id: 'maintenance', label: 'Maintenance', hint: 'Storage, jobs and health', admin: true },
];

interface AdminScreenProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
  onClose: () => void;
  /** Signing out, which the account menu at the foot of the column offers. */
  onLogout: () => void;
}

export function AdminScreen({
  section,
  session,
  workspaceId,
  onClose,
  onLogout,
}: AdminScreenProps): ReactElement | null {
  const { isAdmin } = useIsInstanceAdmin();
  const [listOpen, setListOpen] = useState(false);
  // Which workspace is open in the list, if any. State rather than a route,
  // because it is a step inside one section and not a place to link to.
  const [openWorkspace, setOpenWorkspace] = useState<{
    id: string;
    name: string;
    icon: WorkspaceIcon | null;
  } | null>(null);

  const canManageWorkspaces = isAdmin === true || session.user.canManageWorkspaces;
  const available = SECTIONS.filter((entry) => {
    if (entry.admin) return isAdmin === true;
    if (entry.manager) return canManageWorkspaces;
    return true;
  });

  // Nothing to administer, or the answer has not arrived yet. Both render
  // nothing rather than an empty frame that would flash a heading and a list
  // with no entries.
  if (available.length === 0) return null;

  const current = resolveSection(available, section);

  return (
    <SettingsShell
      area="The instance"
      areaId="admin"
      canAdminister
      sections={available}
      current={current}
      hrefFor={(id) => paths.admin(id)}
      listOpen={listOpen}
      onListOpen={setListOpen}
      account={{
        displayName: session.user.displayName,
        userId: session.user.id,
        onLogout,
      }}
      onClose={onClose}
    >
      {current === 'instance' && <InstancePanel />}
      {current === 'accounts' && <UsersPanel />}
      {current === 'invite' && <InvitePanel />}
      {current === 'sso' && <OidcPanel />}
      {current === 'maintenance' && <MaintenancePanel />}
      {current === 'workspaces' &&
        (openWorkspace ? (
          <WorkspaceDetail
            workspaceId={openWorkspace.id}
            name={openWorkspace.name}
            icon={openWorkspace.icon}
            onBack={() => setOpenWorkspace(null)}
          />
        ) : (
          <WorkspaceList
            currentWorkspaceId={workspaceId}
            onOpen={(id, chosenName, chosenIcon) =>
              setOpenWorkspace({ id, name: chosenName, icon: chosenIcon })
            }
            onRestore={(id) => {
              // Restoring is one click, unlike deleting: putting something back
              // is not the action that needs slowing down.
              void api
                .setWorkspaceDeletion(id, { restore: true })
                .then(() => window.location.reload());
            }}
          />
        ))}
    </SettingsShell>
  );
}
