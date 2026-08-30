/**
 * SONE web — every workspace on this instance.
 *
 * One place for all of them, including the one you are standing in (ADR-0027).
 * A first sketch had settings for the current workspace *and* a list for the
 * others, which is two interfaces for one job — and the one nobody uses is the
 * one that drifts.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
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
  onOpen: (workspaceId: string, name: string) => void;
  onRestore: (workspaceId: string) => void;
}): ReactElement {
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
  if (!rows) return <p className="muted">Loading…</p>;

  const shared = rows.filter((row) => !row.personal);
  const personal = rows.filter((row) => row.personal);

  const table = (list: Row[]): ReactElement => (
    <table className="workspace-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>People</th>
          <th>Pages</th>
          <th>Last edited</th>
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
              <button
                type="button"
                className="link-button"
                onClick={() => onOpen(row.id, row.name)}
              >
                {row.name || 'Untitled'}
              </button>
              {row.id === currentWorkspaceId && (
                <span className="muted"> · you are here</span>
              )}
              {row.deletedAt && (
                <>
                  {' '}
                  <span className="muted">· deleted</span>{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onRestore(row.id)}
                  >
                    Restore
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
      <h3 className="settings-heading">Shared workspaces</h3>
      {shared.length === 0 ? (
        <p className="muted">None yet — every workspace here belongs to one person.</p>
      ) : (
        table(shared)
      )}

      {/* Personal workspaces, folded away.
        *
        * Everybody has one (ADR-0025), so on an instance of forty people there
        * are forty — and listed together with the teams they would drown them.
        * They are still here, because "who has an account and what is in it" is
        * a question this list should be able to answer. */}
      <h3 className="settings-heading">Personal workspaces</h3>
      <p className="muted">
        One for each account. {personal.length} in total.
      </p>
      <button type="button" className="btn" onClick={() => setShowPersonal(!showPersonal)}>
        {showPersonal ? 'Hide' : 'Show'}
      </button>
      {showPersonal && table(personal)}
    </section>
  );
}
