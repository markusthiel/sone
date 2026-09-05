/**
 * SONE web — groups in a workspace.
 *
 * A group is a list of people. Granting one access to a page happens in the
 * sharing dialog; this is only who is in it, because naming sets of people is
 * how a workspace is organised and not something to decide while looking at one
 * page (ADR-0026).
 */

import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceMember, type WorkspaceRoleRow } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

interface Group {
  id: string;
  name: string;
  members: number;
  /** A group can carry a role, which everybody in it then holds (ADR-0087). */
  roleId: string | null;
  roleName: string | null;
}

export function GroupsPanel({ workspaceId }: { workspaceId: string }): ReactElement {
  const { t } = useT();
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [roles, setRoles] = useState<WorkspaceRoleRow[]>([]);
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
    // Failing quietly: somebody who may manage groups need not be able to
    // define roles, and a picker that is simply absent says that better than
    // an error about a right they were not looking for.
    void api
      .roles(workspaceId)
      .then((result) => setRoles(result.roles))
      .catch(() => setRoles([]));
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
        if (window.confirm(t('groups.confirmDelete', { name: group.name }))) {
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
        {t('group.note')}
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
            {roles.length > 0 && (
              <select
                aria-label={t('role.forGroup')}
                value={group.roleId ?? ''}
                onChange={(event) =>
                  act(api.setGroupRole(workspaceId, group.id, event.target.value || null))
                }
              >
                <option value="">{t('role.groupNone')}</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.key ? t(`role.${role.key}` as MessageKey) : role.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn" onClick={() => remove(group)}>
              {t('group.delete')}
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
                  {t('group.remove')}
                </button>
              </li>
            ))}
            {openMembers.length === 0 && <li className="muted">{t('group.nobody')}</li>}
          </ul>

          <div className="field">
            <label htmlFor="group-add">{t('group.addSomebody')}</label>
            <select
              id="group-add"
              value=""
              onChange={(event) => {
                if (event.target.value) act(api.addToGroup(open, event.target.value));
              }}
            >
              <option value="">{t('group.choosePerson')}</option>
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

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('group.new')}</b>
            <span>
              {t('group.name.note')}
            </span>
          </span>
          <input
            id="group-name"
            aria-label={t('group.new')}
            value={name}
            placeholder={t('group.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
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
          {t('group.create')}
        </button>
      </div>
    </section>
  );
}
