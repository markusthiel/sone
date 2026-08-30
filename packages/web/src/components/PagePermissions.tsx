/**
 * SONE web — who may reach this page.
 *
 * Inside the sharing dialog rather than beside it. A link for people outside
 * and a grant for people inside are the same question asked twice — "who gets
 * to see this" — and answering it in two places is how somebody sets one and
 * believes they have set the other.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceMember } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

interface Grant {
  userId: string;
  displayName: string;
  access: string;
  inheritedFrom: string | null;
}

const LEVELS: Array<{ id: string; label: string }> = [
  { id: 'viewer', label: 'Can view' },
  { id: 'editor', label: 'Can edit' },
  { id: 'admin', label: 'Can manage' },
];

export function PagePermissions({
  pageId,
  workspaceId,
}: {
  pageId: string;
  workspaceId: string;
}): ReactElement {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = (): void => {
    void api
      .pagePermissions(pageId)
      .then((result) => {
        setRestricted(result.restricted);
        setGrants(result.grants);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        // Somebody who may read a page but not manage it gets no panel rather
        // than an error: they are not doing anything wrong by opening this.
        if (err instanceof ApiError && (err.code === 'forbidden' || err.code === 'not_found')) {
          setLoaded(true);
          return;
        }
        setError(err instanceof ApiError ? err.code : 'network_error');
      });
  };

  useEffect(load, [pageId]);

  useEffect(() => {
    // Who could be added. Fetched here rather than passed in, because this is
    // the only place that needs it and threading it through the dialog would
    // make every caller carry a list it does not use.
    void api
      .members(workspaceId)
      .then((result) => setMembers(result.members))
      .catch(() => {
        // Without the list there is nobody to add, and the grants already set
        // are still shown and still removable.
      });
  }, [workspaceId]);

  const act = (work: Promise<unknown>): void => {
    setError(null);
    void work
      .then(load)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  // People in the workspace who have no grant here yet.
  const granted = new Set(grants.map((g) => g.userId));
  const addable = members.filter((m) => !granted.has(m.userId));

  if (!loaded) return <p className="muted">Checking…</p>;

  return (
    <section className="page-permissions">
      <h3 className="settings-heading">People in this workspace</h3>

      {error && <p className="error">{messageFor(error)}</p>}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={restricted}
          onChange={(event) => act(api.setPageRestricted(pageId, event.target.checked))}
        />
        Only people added below
      </label>
      <p className="muted">
        {restricted
          ? 'The workspace cannot reach this page or anything under it. Owners and admins still can — somebody has to be able to undo this.'
          : 'Everybody in the workspace can reach this page. Adding someone below gives them more than their role does, never less.'}
      </p>

      <ul className="permission-list">
        {grants.map((grant) => (
          <li key={grant.userId}>
            <span>{grant.displayName}</span>

            {/* An inherited grant is shown where it was set, and changed there.
              * Editing it here would silently change access to everything else
              * under that ancestor. */}
            {grant.inheritedFrom ? (
              <span className="muted">
                {LEVELS.find((l) => l.id === grant.access)?.label ?? grant.access} · from{' '}
                {grant.inheritedFrom}
              </span>
            ) : (
              <>
                <select
                  value={grant.access}
                  aria-label={`Access for ${grant.displayName}`}
                  onChange={(event) =>
                    act(api.grantPageAccess(pageId, grant.userId, event.target.value))
                  }
                >
                  {LEVELS.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={() => act(api.revokePageAccess(pageId, grant.userId))}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {addable.length > 0 && (
        <div className="field">
          <label htmlFor="grant-person">Add somebody</label>
          <select
            id="grant-person"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                act(api.grantPageAccess(pageId, event.target.value, 'viewer'));
              }
            }}
          >
            <option value="">Choose a person…</option>
            {addable.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}
