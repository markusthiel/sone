/**
 * SONE web — administering one workspace.
 *
 * Reached from the list, and the same interface whichever workspace it is —
 * including the one somebody is standing in (ADR-0027). Two copies would be two
 * things to keep in step, and the one used less is the one that would rot.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceMember } from '../api/client.ts';
import { messageFor } from './Auth.tsx';
import { WorkspaceInvite } from './WorkspaceInvite.tsx';

export function WorkspaceDetail({
  workspaceId,
  name,
  onBack,
}: {
  workspaceId: string;
  name: string;
  onBack: () => void;
}): ReactElement {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .members(workspaceId)
      .then((result) => setMembers(result.members))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  }, [workspaceId]);

  return (
    <section className="settings-section">
      <button type="button" className="btn" onClick={onBack}>
        ← All workspaces
      </button>

      <h3 className="settings-heading">{name || 'Untitled'}</h3>

      {error && <p className="error">{messageFor(error)}</p>}

      <h3 className="settings-heading">People</h3>
      {members === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="workspace-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>{member.displayName}</td>
                <td>{member.role}</td>
                <td className="muted">{new Date(member.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* The same invitation panel a workspace's own owner uses, given a
        * different workspace. Not a second one that happens to look alike. */}
      <WorkspaceInvite workspaceId={workspaceId} />
    </section>
  );
}
