/**
 * SONE web — who is in a workspace.
 *
 * One table, used from two places: a workspace's own settings, and the
 * administration list where somebody manages a workspace they are not in
 * (ADR-0032). Two copies would be two things to keep in step, and the one used
 * less is the one that would rot — the argument ADR-0027 already made for the
 * detail view.
 *
 * The server has always let a workspace's owners and administrators do this; only
 * the interface required the instance-wide right, because the table lived inside
 * the administration screen. That was the gap.
 *
 * Read-only for a member who may not administer, rather than hidden: knowing who
 * else is in a workspace is not administration, and a section that disappears
 * makes people ask whether they are in the right place.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceMember } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

const ROLES = ['owner', 'admin', 'member', 'guest'] as const;

export function WorkspaceMembers({
  workspaceId,
  canAdminister,
}: {
  workspaceId: string;
  /** Whether to offer the controls. The server decides; this only draws. */
  canAdminister: boolean;
}): ReactElement {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): void => {
    void api
      .members(workspaceId)
      .then((result) => setMembers(result.members))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  }, [workspaceId]);

  useEffect(load, [load]);

  /**
   * Do something, then read the result back.
   *
   * Rather than adjusting the list here as well: the server refuses some of
   * these — the last owner of a workspace, somebody's own personal workspace —
   * and a list updated optimistically would show a change that did not happen.
   */
  const act = (work: Promise<unknown>): void => {
    setError(null);
    void work
      .then(load)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  if (members === null) {
    return (
      <>
        {error && <p className="error">{messageFor(error)}</p>}
        {!error && <p className="muted">Loading…</p>}
      </>
    );
  }

  return (
    <>
      {error && <p className="error">{messageFor(error)}</p>}
      <table className="workspace-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Since</th>
            {canAdminister && <th />}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.userId}>
              <td>{member.displayName}</td>
              <td>
                {canAdminister ? (
                  <select
                    value={member.role}
                    aria-label={`Role for ${member.displayName}`}
                    onChange={(event) =>
                      act(api.setMemberRole(workspaceId, member.userId, event.target.value))
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  member.role
                )}
              </td>
              <td className="muted">{new Date(member.joinedAt).toLocaleDateString()}</td>
              {canAdminister && (
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => act(api.removeMember(workspaceId, member.userId))}
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
