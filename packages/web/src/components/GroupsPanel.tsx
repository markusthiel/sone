/**
 * SONE web — groups in a workspace.
 *
 * A group is a list of people. Granting one access to a page happens in the
 * sharing dialog; this is only who is in it, because naming sets of people is
 * how a workspace is organised and not something to decide while looking at one
 * page (ADR-0026).
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceMember } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

interface Group {
  id: string;
  name: string;
  members: number;
}

export function GroupsPanel({ workspaceId }: { workspaceId: string }): ReactElement {
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [openMembers, setOpenMembers] = useState<Array<{ userId: string; displayName: string }>>(
    [],
  );
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    void api
      .groups(workspaceId)
      .then((result) => setGroups(result.groups))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  useEffect(load, [workspaceId]);

  useEffect(() => {
    void api
      .members(workspaceId)
      .then((result) => setMembers(result.members))
      .catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    if (!open) {
      setOpenMembers([]);
      return;
    }
    void api
      .groupMembers(open)
      .then((result) => setOpenMembers(result.members))
      .catch(() => setOpenMembers([]));
  }, [open]);

  const act = (work: Promise<unknown>): void => {
    setError(null);
    void work
      .then(() => {
        load();
        if (open) {
          void api.groupMembers(open).then((r) => setOpenMembers(r.members));
        }
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  const remove = (group: Group): void => {
    // Asked once, with the number. "This group has access to four pages" is a
    // different decision from "delete this group", and finding out afterwards
    // means finding out from somebody who can no longer open one of them.
    void api.deleteGroup(group.id).catch((err: unknown) => {
      if (err instanceof ApiError && err.code === 'grants_exist') {
        if (window.confirm(`${group.name} has been given access to pages. Delete it anyway?`)) {
          act(api.deleteGroup(group.id, true));
        }
        return;
      }
      setError(err instanceof ApiError ? err.code : 'network_error');
    });
    load();
  };

  const inGroup = new Set(openMembers.map((m) => m.userId));

  return (
    <section className="settings-section">
      <p className="muted">
        A group is a list of people. Give a group access to a page once, and
        everybody in it has it — including whoever joins later, which is what
        makes this worth keeping up to date.
      </p>

      {error && <p className="error">{messageFor(error)}</p>}

      <ul className="permission-list">
        {groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              className="btn"
              aria-expanded={open === group.id}
              onClick={() => setOpen(open === group.id ? null : group.id)}
            >
              {group.name}
            </button>
            <span className="muted">
              {group.members} {group.members === 1 ? 'person' : 'people'}
            </span>
            <button type="button" className="btn" onClick={() => remove(group)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div className="group-members">
          <ul className="permission-list">
            {openMembers.map((person) => (
              <li key={person.userId}>
                <span>{person.displayName}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => act(api.removeFromGroup(open, person.userId))}
                >
                  Remove
                </button>
              </li>
            ))}
            {openMembers.length === 0 && <li className="muted">Nobody yet.</li>}
          </ul>

          <div className="field">
            <label htmlFor="group-add">Add somebody</label>
            <select
              id="group-add"
              value=""
              onChange={(event) => {
                if (event.target.value) act(api.addToGroup(open, event.target.value));
              }}
            >
              <option value="">Choose a person…</option>
              {members
                .filter((m) => !inGroup.has(m.userId))
                .map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="group-name">New group</label>
        <input
          id="group-name"
          value={name}
          placeholder="Editors"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="settings-actions">
        <button
          type="button"
          className="btn primary"
          disabled={name.trim() === ''}
          onClick={() => {
            act(api.createGroup(workspaceId, name.trim()));
            setName('');
          }}
        >
          Create
        </button>
      </div>
    </section>
  );
}
