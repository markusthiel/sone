/**
 * SONE web — administering one workspace.
 *
 * Reached from the list, and the same interface whichever workspace it is —
 * including the one somebody is standing in (ADR-0027). Two copies would be two
 * things to keep in step, and the one used less is the one that would rot.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceIcon, type WorkspaceMember } from '../api/client.ts';
import { WorkspaceAppearance } from './WorkspaceAppearance.tsx';
import { messageFor } from './Auth.tsx';
import { WorkspaceInvite } from './WorkspaceInvite.tsx';

export function WorkspaceDetail({
  workspaceId,
  name,
  icon,
  onBack,
}: {
  workspaceId: string;
  name: string;
  icon: WorkspaceIcon | null;
  onBack: () => void;
}): ReactElement {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [chosen, setChosen] = useState<WorkspaceIcon | null>(icon);

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

      {/* How it is recognised, before who is in it: the mark is the thing
        * somebody scanning a switcher of five workspaces uses (ADR-0030). */}
      <h3 className="settings-heading">Appearance</h3>
      <div className="settings-card">
        {/* Kept here rather than reloading.
          *
          * Reloading threw the panel away: the open workspace is state and not
          * a route, so the page came back at the list — which shows no marks,
          * so the change looked as if it had not been saved. It had.
          *
          * The chooser is given what it last saved, so choosing a colour after
          * an icon keeps the icon instead of sending a stale copy of it. */}
        <WorkspaceAppearance
          workspaceId={workspaceId}
          icon={chosen}
          onChanged={setChosen}
        />
      </div>

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

      {/* Deleting, last and asking for the name.
        *
        * Not a confirmation dialog: those are dismissed by the same reflex that
        * opened them, and this takes everybody's pages with it. Typing the name
        * is a moment of reading what you are about to do (ADR-0027).
        *
        * Nothing is removed when it is marked — it disappears for its members
        * and can be put back — and the panel says so, because "delete" that
        * means "delete later" is worse than either if nobody says which. */}
      <h3 className="settings-heading">Delete this workspace</h3>
      <p className="muted">
        It stops appearing to everybody in it. Nothing is removed yet, and
        somebody who manages workspaces can put it back.
      </p>
      <div className="field">
        <label htmlFor="confirm-name">Type the name to confirm</label>
        <input
          id="confirm-name"
          value={confirmName}
          placeholder={name}
          onChange={(event) => setConfirmName(event.target.value)}
        />
      </div>
      <div className="settings-actions">
        <button
          type="button"
          className="btn danger"
          disabled={confirmName.trim() !== name}
          onClick={() => {
            act(api.setWorkspaceDeletion(workspaceId, { confirmName: confirmName.trim() }));
            onBack();
          }}
        >
          Delete
        </button>
      </div>
    </section>
  );
}
