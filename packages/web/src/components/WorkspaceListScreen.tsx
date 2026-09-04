/**
 * SONE web — every workspace this person may see (ADR-0067).
 *
 * Outside the administration, because that is where it was: the list existed
 * only for administrators, which is why a member had no list at all and could
 * edit only the workspace they happened to be looking at.
 *
 * **One list of different lengths, and the server decides the length.** An
 * administrator or somebody with the workspace-management right sees every
 * workspace; everybody else sees the ones they are a member of. Filtering here
 * as well would be a second answer to the same question — which is exactly how
 * the two workspace screens this record merges drifted apart.
 */

import { type ReactElement, useState } from 'react';

import { api, type SessionInfo } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import { SettingsShell } from './SettingsShell.tsx';
import { WorkspaceList } from './WorkspaceList.tsx';

export function WorkspaceListScreen({
  session,
  workspaceId,
  onClose,
  onLogout,
}: {
  session: SessionInfo;
  workspaceId: string | null;
  onClose: () => void;
  onLogout: () => void;
}): ReactElement {
  const { t } = useT();
  const [listOpen, setListOpen] = useState(false);

  return (
    <SettingsShell
      /*
       * Whether the shell offers the way into the administration — not whether
       * this screen is administration. Everybody reaches this list; only an
       * administrator gets the extra entry in the shell's own menu.
       */
      canAdminister={session.user.isInstanceAdmin || session.user.canManageWorkspaces}
      area={t('workspaces.area')}
      areaId="workspace"
      subtitle={t('workspaces.area.hint')}
      /*
       * One section, and it is the list.
       *
       * The shell wants sections and this screen has one thing in it. Naming it
       * rather than passing an empty list keeps the shell's own navigation
       * honest — a shell with no sections draws an empty rail, which reads as
       * something failing to load.
       */
      sections={[
        { id: 'all', label: t('workspaces.area'), hint: t('workspaces.area.hint') },
      ]}
      current="all"
      hrefFor={() => paths.workspaces()}
      listOpen={listOpen}
      onListOpen={setListOpen}
      account={{
        displayName: session.user.displayName,
        userId: session.user.id,
        onLogout,
      }}
      onClose={onClose}
    >
      <WorkspaceList
        // The list marks the one being looked at; with none — reachable from a
        // screen outside any workspace — nothing is marked.
        currentWorkspaceId={workspaceId ?? ''}
        onOpen={(id) => {
          window.location.assign(paths.workspaceSettings('general', id));
        }}
        onRestore={(id) => {
          // Restoring is one click, unlike deleting: putting something back is
          // not the action that needs slowing down.
          void api.setWorkspaceDeletion(id, { restore: true }).then(() => {
            window.location.reload();
          });
        }}
      />
    </SettingsShell>
  );
}
