/**
 * SONE web — invitations that have been sent and not yet used up.
 *
 * The other half of inviting somebody (ADR-0025). Both forms produced a link and
 * then forgot it: nothing listed what was outstanding, so a link sent to the
 * wrong address stayed valid until it expired and nobody could tell it existed.
 * Creating something that cannot be seen or undone is the part of a feature that
 * gets noticed last and hurts most.
 *
 * One component for both scopes — a workspace's invitations and the instance's —
 * because the rows are the same rows and the only difference is which list to
 * ask for. The two invitations are told apart by where the list appears and by
 * what it says, not by having two implementations.
 *
 * The link is not shown again. It is only in the response to creating one, by
 * design: an invitation token is a credential, and a list that reprints every
 * outstanding one turns "who can see this screen" into "who can join". What can
 * be done here is see that it exists and withdraw it.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type PendingInvitation } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

interface Props {
  /** A workspace's invitations, or the instance's when null. */
  workspaceId: string | null;
  /**
   * Bumped by the caller after it creates one, so the list refreshes.
   *
   * A number rather than a callback the form calls: the form does not need to
   * know a list exists, and passing it one would make inviting depend on
   * something that is only ever displayed beside it.
   */
  reloadToken?: number;
}

export function PendingInvitations({ workspaceId, reloadToken }: Props): ReactElement | null {
  const [invitations, setInvitations] = useState<PendingInvitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): void => {
    const request = workspaceId === null
      ? api.instanceInvitations()
      : api.workspaceInvitations(workspaceId);

    void request
      .then((result) => {
        setInvitations(result.invitations);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.code : 'network_error'),
      );
  }, [workspaceId]);

  useEffect(load, [load, reloadToken]);

  // Nothing outstanding is the ordinary state, and a heading over an empty table
  // says there is none of something nobody asked about.
  if (invitations !== null && invitations.length === 0 && !error) return null;

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Outstanding invitations</h3>

      {error && <p className="error">{messageFor(error)}</p>}

      {invitations === null ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <table className="workspace-table">
          <thead>
            <tr>
              <th>For</th>
              {/* A role only where there is one: an invitation to the instance
                  names no workspace, so it names no role in one either. */}
              {workspaceId !== null && <th>Role</th>}
              <th>Used</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>
                  {invitation.email ?? (
                    <span className="muted">Anybody with the link</span>
                  )}
                </td>
                {workspaceId !== null && <td>{invitation.role}</td>}
                <td className="muted">
                  {invitation.uses} of {invitation.maxUses}
                </td>
                <td className="muted">
                  {new Date(invitation.expiresAt).toLocaleDateString()}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Withdraw the invitation for ${
                      invitation.email ?? 'anybody with the link'
                    }`}
                    onClick={() => {
                      setError(null);
                      // Read back rather than removed from the list here: the
                      // server refuses one somebody may not withdraw, and a row
                      // that vanishes optimistically would show a change that
                      // did not happen.
                      void api
                        .revokeInvitation(invitation.id)
                        .then(load)
                        .catch((err: unknown) =>
                          setError(err instanceof ApiError ? err.code : 'network_error'),
                        );
                    }}
                  >
                    Withdraw
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
