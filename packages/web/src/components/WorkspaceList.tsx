/**
 * SONE web — every workspace on this instance.
 *
 * One place for all of them, including the one you are standing in (ADR-0027).
 * A first sketch had settings for the current workspace *and* a list for the
 * others, which is two interfaces for one job — and the one nobody uses is the
 * one that drifts.
 */

import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceIcon } from '../api/client.ts';
import { titleColorStyle } from './EntryIconView.tsx';
import { WorkspaceMark } from './WorkspaceMark.tsx';
import { messageFor } from './Auth.tsx';

interface Row {
  id: string;
  name: string;
  memberCount: number;
  pageCount: number;
  owner: string | null;
  personal: boolean;
  lastEditedAt: string | null;
  deletedAt: string | null;
  icon: WorkspaceIcon | null;
}

const when = (value: string | null): string => {
  if (!value) return 'never';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
};

export function WorkspaceList({
  currentWorkspaceId,
  onOpen,
  onRestore,
}: {
  currentWorkspaceId: string;
  onOpen: (workspaceId: string, name: string, icon: WorkspaceIcon | null) => void;
  onRestore: (workspaceId: string) => void;
}): ReactElement {
  const { t } = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPersonal, setShowPersonal] = useState(false);

  useEffect(() => {
    void api
      .adminWorkspaces()
      .then((result) => setRows(result.workspaces))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  }, []);

  if (error) return <p className="error">{messageFor(error)}</p>;
  if (!rows) return <p className="muted">{t('workspaces.loading')}</p>;

  /*
   * The one being looked at first (ADR-0067 amendment).
   *
   * The menu lost its "this workspace" shortcut, because two entries for one
   * subject was the complaint. Putting the current workspace at the top of its
   * table is what keeps the shortcut short: it is the row somebody came here
   * for, and it was already marked — it just was not where they would look.
   *
   * Only within its own table, so the shared/personal split still reads as
   * itself.
   */
  const currentFirst = (a: Row, b: Row): number =>
    Number(b.id === currentWorkspaceId) - Number(a.id === currentWorkspaceId);
  const shared = rows.filter((row) => !row.personal).sort(currentFirst);
  const personal = rows.filter((row) => row.personal).sort(currentFirst);

  const table = (list: Row[]): ReactElement => (
    <table className="workspace-table">
      <thead>
        <tr>
          <th>{t('workspaces.name')}</th>
          <th>{t('workspaces.people')}</th>
          <th>{t('workspaces.pages')}</th>
          <th>{t('workspaces.lastEdited')}</th>
        </tr>
      </thead>
      <tbody>
        {list.map((row) => (
          <tr key={row.id}>
            <td>
              {/* The name opens the workspace's own administration.
                *
                * A row that only reports numbers makes somebody wonder where
                * the editing is, and a separate "manage" column would be a
                * second target for the thing the name already identifies. */}
              <span className="workspace-row-name">
                {/* The mark, here too: choosing one and then not seeing it in
                    the list where workspaces are compared is why this looked
                    unsaved. */}
                <WorkspaceMark name={row.name} icon={row.icon ?? null} />
                <button
                  type="button"
                  className="link-button"
                  style={titleColorStyle(row.icon ?? null)}
                  onClick={() => onOpen(row.id, row.name, row.icon ?? null)}
                >
                  {row.name || t('workspace.untitled')}
                </button>
              </span>
              {row.id === currentWorkspaceId && (
                <span className="muted"> · {t('workspaces.youAreHere')}</span>
              )}
              {row.deletedAt && (
                <>
                  {' '}
                  <span className="muted">· {t('workspaces.deleted')}</span>{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onRestore(row.id)}
                  >
                    {t('trash.restore')}
                  </button>
                </>
              )}
            </td>
            <td>{row.memberCount}</td>
            <td>{row.pageCount}</td>
            {/* Which workspaces are alive, without opening any of them. That is
                the question somebody scanning a list like this actually has. */}
            <td className="muted">{when(row.lastEditedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <section className="settings-section">
      <h3 className="settings-heading">{t('workspaces.shared')}</h3>
      {shared.length === 0 ? (
        <p className="muted">{t('workspaces.nonePersonal')}</p>
      ) : (
        table(shared)
      )}

      {/* Personal workspaces, folded away.
        *
        * Everybody has one (ADR-0025), so on an instance of forty people there
        * are forty — and listed together with the teams they would drown them.
        * They are still here, because "who has an account and what is in it" is
        * a question this list should be able to answer. */}
      <h3 className="settings-heading">{t('workspaces.personal')}</h3>
      <p className="muted">{t('workspaces.personal.note', { count: personal.length })}</p>
      <button type="button" className="btn" onClick={() => setShowPersonal(!showPersonal)}>
        {showPersonal ? t('workspaces.hide') : t('workspaces.show')}
      </button>
      {showPersonal && table(personal)}
    </section>
  );
}
