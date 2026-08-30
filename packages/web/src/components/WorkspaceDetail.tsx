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

  const load = (): void => {
    void api
      .members(workspaceId)
      .then((result) => setMembers(result.members))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  useEffect(load, [workspaceId]);

  /**
   * Do something, then read the result back.
   *
   * Rather than adjusting the list here as well: the server refuses some of
   * these — the last owner, somebody's own workspace — and a list updated
   * optimistically would show a change that did not happen.
   */
  const act = (work: Promise<unknown>): void => {
    setError(null);
    void work
      .then(load)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

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
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>{member.displayName}</td>
                <td>
                  <select
                    value={member.role}
                    aria-label={`Role for ${member.displayName}`}
                    onChange={(event) =>
                      act(api.setMemberRole(workspaceId, member.userId, event.target.value))
                    }
                  >
                    {['owner', 'admin', 'member', 'guest'].map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="muted">{new Date(member.joinedAt).toLocaleDateString()}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => act(api.removeMember(workspaceId, member.userId))}
                  >
                    Remove
                  </button>
                </td>
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
