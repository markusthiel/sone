/**
 * SONE web — who may reach this page.
 *
 * Inside the sharing dialog rather than beside it. A link for people outside
 * and a grant for people inside are the same question asked twice — "who gets
 * to see this" — and answering it in two places is how somebody sets one and
 * believes they have set the other.
 */

import type { MessageKey } from '../i18n/messages.en.ts';
import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceMember } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

interface Grant {
  userId: string;
  displayName: string;
  access: string;
  inheritedFrom: string | null;
}

interface GroupGrant {
  groupId: string;
  name: string;
  access: string;
  inheritedFrom: string | null;
}

/**
 * What a grant allows. Keyed by the level the server stores, so a translation
 * cannot change who may do what (ADR-0041).
 */
const LEVELS: Array<{ id: string; label: MessageKey }> = [
  { id: 'viewer', label: 'access.viewer' },
  // The role the access model has had since the first migration and no screen
  // offered: `share_role` is an enum of viewer, commenter, editor, admin, and
  // `canComment` has been sitting beside `canEdit` in claims.ts. A capability
  // nobody can reach is a capability nobody has (ADR-0046).
  { id: 'commenter', label: 'access.commenter' },
  { id: 'editor', label: 'access.editor' },
  { id: 'admin', label: 'access.admin' },
];

/** The level's own words, or the raw value if the server sent a new one. */
function levelLabel(
  access: string,
  t: (key: MessageKey) => string,
): string {
  const found = LEVELS.find((level) => level.id === access);
  return found ? t(found.label) : access;
}

export function PagePermissions({
  pageId,
  workspaceId,
}: {
  pageId: string;
  workspaceId: string;
}): ReactElement {
  const { t } = useT();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [cap, setCap] = useState<string>('');
  const [inheritedCap, setInheritedCap] = useState<{ maxLevel: string; from: string } | null>(
    null,
  );
  const [grants, setGrants] = useState<Grant[]>([]);
  const [groupGrants, setGroupGrants] = useState<GroupGrant[]>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = (): void => {
    void api
      .pagePermissions(pageId)
      .then((result) => {
        setRestricted(result.restricted);
        setCap(result.cap?.maxLevel ?? '');
        setInheritedCap(result.inheritedCap);
        setGrants(result.grants);
        setGroupGrants(result.groups);
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

    // Groups are listed only for people who administer the workspace, so this
    // failing is ordinary rather than exceptional: somebody managing one page
    // sees the group grants that exist and cannot add new ones.
    void api
      .groups(workspaceId)
      .then((result) => setGroups(result.groups))
      .catch(() => {});
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

  const grantedGroups = new Set(groupGrants.map((g) => g.groupId));
  const addableGroups = groups.filter((g) => !grantedGroups.has(g.id));

  if (!loaded) return <p className="muted">{t('perm.checking')}</p>;

  return (
    <section className="page-permissions">
      <h3 className="settings-heading">{t('perm.peopleHere')}</h3>

      {error && <p className="error">{messageFor(error)}</p>}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={restricted}
          onChange={(event) => act(api.setPageRestricted(pageId, event.target.checked))}
        />
        {t('perm.onlyAdded')}
      </label>
      <p className="muted">
        {restricted ? t('perm.restricted.note') : t('perm.open.note')}
      </p>

      {/* The ceiling (ADR-0087).
        *
        * Below the restriction and above the list, because that is the order
        * the three layers apply in: the workspace default, then what is given
        * to the people below, then the ceiling over all of it. A control that
        * lowers, placed among controls that raise, would read as one of them.
        */}
      <div className="field">
        <label htmlFor="page-cap">{t('cap.label')}</label>
        <select
          id="page-cap"
          value={cap}
          onChange={(event) => {
            setCap(event.target.value);
            act(api.setPageCap(pageId, event.target.value || null));
          }}
        >
          <option value="">{t('cap.none')}</option>
          {(['viewer', 'commenter', 'editor'] as const).map((one) => (
            <option key={one} value={one}>
              {levelLabel(one, t)}
            </option>
          ))}
        </select>
      </div>
      <p className="muted">
        {t('cap.note')}
        {/* Named where it came from, because a ceiling set on a section above
          * is otherwise invisible on the page it actually limits — which is
          * the whole cost of this layer and the reason it is spelled out. */}
        {inheritedCap && (
          <>
            {' '}
            <b>
              {t('cap.inherited', {
                level: levelLabel(inheritedCap.maxLevel, t),
                from: inheritedCap.from,
              })}
            </b>
          </>
        )}
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
                {t('perm.inheritedFrom', {
                  level: levelLabel(grant.access, t),
                  source: grant.inheritedFrom,
                })}
              </span>
            ) : (
              <>
                <select
                  value={grant.access}
                  aria-label={t('perm.accessFor', { who: grant.displayName })}
                  onChange={(event) =>
                    act(api.grantPageAccess(pageId, grant.userId, event.target.value))
                  }
                >
                  {LEVELS.map((level) => (
                    <option key={level.id} value={level.id}>
                      {t(level.label)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={() => act(api.revokePageAccess(pageId, grant.userId))}
                >
                  {t('perm.remove')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Groups, above people.
        *
        * Granting a group is the thing that scales, and listing it second would
        * make the page-by-page, person-by-person habit the obvious one — which
        * is exactly what groups exist to replace. */}
      {(groupGrants.length > 0 || groups.length > 0) && (
        <>
          <h3 className="settings-heading">{t('perm.groups')}</h3>
          <ul className="permission-list">
            {groupGrants.map((grant) => (
              <li key={grant.groupId}>
                <span>{grant.name}</span>
                {grant.inheritedFrom ? (
                  <span className="muted">
                    {t('perm.inheritedFrom', {
                      level: levelLabel(grant.access, t),
                      source: grant.inheritedFrom,
                    })}
                  </span>
                ) : (
                  <>
                    <select
                      value={grant.access}
                      aria-label={t('perm.accessFor', { who: grant.name })}
                      onChange={(event) =>
                        act(
                          api.grantPageAccessToGroup(pageId, grant.groupId, event.target.value),
                        )
                      }
                    >
                      {LEVELS.map((level) => (
                        <option key={level.id} value={level.id}>
                          {t(level.label)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => act(api.revokePageAccessFromGroup(pageId, grant.groupId))}
                    >
                      {t('perm.remove')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {addableGroups.length > 0 && (
            <div className="field">
              <label htmlFor="grant-group">{t('perm.addGroup')}</label>
              <select
                id="grant-group"
                value=""
                onChange={(event) => {
                  if (event.target.value) {
                    act(api.grantPageAccessToGroup(pageId, event.target.value, 'viewer'));
                  }
                }}
              >
                <option value="">{t('perm.chooseGroup')}</option>
                {addableGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <h3 className="settings-heading">{t('perm.people')}</h3>
        </>
      )}

      {addable.length > 0 && (
        <div className="field">
          <label htmlFor="grant-person">{t('group.addSomebody')}</label>
          <select
            id="grant-person"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                act(api.grantPageAccess(pageId, event.target.value, 'viewer'));
              }
            }}
          >
            <option value="">{t('group.choosePerson')}</option>
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
