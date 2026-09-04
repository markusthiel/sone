/**
 * SONE web — who is in a workspace, and who is let in (ADR-0073).
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
 *
 * Letting somebody in happens here rather than in a section of its own, and by
 * address rather than from a picker (ADR-0073). It used to be an invitation,
 * which conflated two jobs: making an *account* for somebody who is not on this
 * server — the instance's business — and saying which of the people already
 * here may work in this workspace, which is the owner's. The second is this
 * table. The first is Verwaltung → Einladungen.
 */

import { useT } from '../i18n/useT.tsx';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceMember } from '../api/client.ts';
import type { MessageKey } from '../i18n/messages.en.ts';
import { messageFor } from './Auth.tsx';
import { PendingInvitations } from './PendingInvitations.tsx';

const ROLES = ['owner', 'admin', 'member', 'guest'] as const;

/**
 * The roles somebody can be let in as.
 *
 * No owner. A second owner is a decision about who can delete the workspace,
 * and it is one to take deliberately in the table below rather than in the same
 * breath as "add this person".
 */
const ADDABLE: Array<{ id: string; label: MessageKey }> = [
  { id: 'member', label: 'role.member' },
  { id: 'admin', label: 'role.admin' },
  { id: 'guest', label: 'role.guest' },
];

export function WorkspaceMembers({
  workspaceId,
  canAdminister,
}: {
  workspaceId: string;
  /** Whether to offer the controls. The server decides; this only draws. */
  canAdminister: boolean;
}): ReactElement {
  const { t } = useT();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

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

  const add = (): void => {
    const address = email.trim();
    if (address === '') return;
    setBusy(true);
    setError(null);
    setAdded(null);
    void api
      .addMember(workspaceId, { email: address, role })
      .then(() => {
        setEmail('');
        setAdded(address);
        load();
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  if (members === null) {
    return (
      <>
        {error && <p className="error">{messageFor(error)}</p>}
        {!error && <p className="muted">{t('trash.loading')}</p>}
      </>
    );
  }

  return (
    <>
      {error && <p className="error">{messageFor(error)}</p>}

      {canAdminister && (
        <section className="settings-section">
          <h3 className="settings-heading">{t('access.add')}</h3>
          <p className="muted">{t('access.note')}</p>
          <div className="settings-card">
            <label className="settings-row">
              <span className="settings-row-label">
                <b>{t('access.address')}</b>
                <span>{t('access.address.hint')}</span>
              </span>
              <input
                type="email"
                value={email}
                placeholder={t('access.example')}
                aria-label={t('access.address')}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add();
                  }
                }}
              />
            </label>
            <label className="settings-row">
              <span className="settings-row-label">
                <b>{t('access.as')}</b>
                <span>{t(`role.${role}.hint` as MessageKey)}</span>
              </span>
              <select
                value={role}
                aria-label={t('access.as')}
                onChange={(event) => setRole(event.target.value)}
              >
                {ADDABLE.map((one) => (
                  <option key={one.id} value={one.id}>
                    {t(one.label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={busy || email.trim() === ''}
            onClick={add}
          >
            {t('access.give')}
          </button>
          {added && <p className="muted">{t('access.given', { email: added })}</p>}
        </section>
      )}

      <table className="workspace-table">
        <thead>
          <tr>
            <th>{t('member.name')}</th>
            <th>{t('member.role')}</th>
            <th>{t('member.since')}</th>
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
                    aria-label={t('member.roleFor', { name: member.displayName })}
                    onChange={(event) =>
                      act(api.setMemberRole(workspaceId, member.userId, event.target.value))
                    }
                  >
                    {/* Translated, which they were not: four English role ids
                        in a German table, on the one control that decides what
                        somebody may do (ADR-0041). */}
                    {ROLES.map((one) => (
                      <option key={one} value={one}>
                        {t(`role.${one}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                ) : (
                  t(`role.${member.role}` as MessageKey)
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
                    {t('member.remove')}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Invitations made before access replaced them (ADR-0073).
        *
        * No new ones can be made here, and this list draws nothing when there
        * are none — but one that was sent last week is still a way into this
        * workspace, and something that cannot be seen cannot be withdrawn. */}
      {canAdminister && <PendingInvitations workspaceId={workspaceId} />}
    </>
  );
}
