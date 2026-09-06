/**
 * SONE web — defining roles (ADR-0087).
 *
 * Until now a role was one of four words in the code, so "add somebody
 * read-only" was not a setting anybody had forgotten to expose: it was
 * inexpressible. This is the screen that makes it a sentence — a role is a page
 * level and a set of rights, and both are chosen here.
 *
 * ## Two halves, drawn as two halves
 *
 * The page level is a **radio**, because it is a ladder: a page is a document
 * the server hands over or does not, so "may edit but not view" is not a state.
 * The rights are **checkboxes**, because they are a set with no order — "may
 * manage groups" and "may rename the workspace" have nothing to do with each
 * other.
 *
 * Drawing the ladder as checkboxes would invite exactly the combination that
 * cannot exist, and then have to refuse it.
 *
 * ## The four system roles are shown and cannot be edited
 *
 * They are listed with everything else, because the choice somebody makes is
 * between all of them and hiding half the list would make the other half look
 * like the whole thing. What they do not get is an edit control: a workspace
 * always has an owner and an owner always holds every right, and both have to
 * survive any amount of editing here.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type WorkspaceRoleRow } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { messageFor } from './Auth.tsx';

/** The ladder, least to most. Empty string is "nothing without a grant". */
const LEVELS: ReadonlyArray<{ value: string; label: MessageKey }> = [
  { value: '', label: 'role.level.none' },
  { value: 'viewer', label: 'access.viewer' },
  { value: 'commenter', label: 'access.commenter' },
  { value: 'editor', label: 'access.editor' },
  { value: 'admin', label: 'access.admin' },
];

interface Draft {
  /** Absent while creating. */
  id: string | null;
  name: string;
  pageLevel: string;
  rights: string[];
}

const emptyDraft = (): Draft => ({ id: null, name: '', pageLevel: 'editor', rights: [] });

export function RolesPanel({ workspaceId }: { workspaceId: string }): ReactElement {
  const { t } = useT();
  const [roles, setRoles] = useState<WorkspaceRoleRow[]>([]);
  const [rights, setRights] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    void api
      .roles(workspaceId)
      .then((result) => {
        setRoles(result.roles);
        setRights(result.rights);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  useEffect(load, [workspaceId]);

  const act = (work: Promise<unknown>): void => {
    setError(null);
    void work
      .then(() => {
        setDraft(null);
        load();
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  const save = (): void => {
    if (!draft || draft.name.trim() === '') return;
    const body = {
      name: draft.name.trim(),
      pageLevel: draft.pageLevel === '' ? null : draft.pageLevel,
      rights: draft.rights,
    };
    act(
      draft.id === null
        ? api.createRole(workspaceId, body)
        : api.updateRole(workspaceId, draft.id, body),
    );
  };

  const remove = (role: WorkspaceRoleRow): void => {
    /*
     * Asked with the number, and refused by the server when it is not zero.
     *
     * Moving everybody to `member` and deleting would change what several
     * people may do without saying so — and "several" could be everybody. The
     * confirmation is here so the count is on screen at the moment of the
     * decision rather than in an error afterwards.
     */
    const held = role.members + role.groups;
    if (held > 0) {
      setError('role_in_use');
      return;
    }
    if (!window.confirm(t('role.confirmDelete', { name: role.name }))) return;
    act(api.deleteRole(workspaceId, role.id));
  };

  const levelLabel = (level: string | null): string =>
    t(LEVELS.find((one) => one.value === (level ?? ''))?.label ?? 'role.level.none');

  return (
    <section className="settings-section">
      <p className="muted">{t('role.note')}</p>

      {error && <p className="error">{messageFor(error)}</p>}

      {/* A card each (ADR-0119).
        *
        * They were rows in `.permission-list`, which is a flex line with a
        * label on one side and controls on the other — right for a share and
        * wrong here, because a role says *two* things and then a count and then
        * whether it can be edited. Four things on one line wrap wherever they
        * run out of room, which put "0 Personen, 0" above "Gruppen" and split
        * "Fest eingebaut" in half.
        *
        * The two things a role says are labelled rather than run together with
        * a middle dot: `role.note` opens the screen by saying a role means a
        * page level *and* a set of rights, and the list underneath was the one
        * place that did not make the distinction visible.
        *
        * The system roles get cards too, asked for in those words. They are in
        * the list because the choice is between all of them; what they do not
        * get is an edit control, and an absent control says more plainly than a
        * disabled one why it cannot be changed. */}
      <ul className="role-cards">
        {roles.map((role) => (
          <li className="role-card" key={role.id}>
            <div className="role-card-head">
              <b className="role-card-name">
                {role.key ? t(`role.${role.key}` as MessageKey) : role.name}
              </b>
              {role.key !== null && <span className="role-card-badge">{t('role.builtIn')}</span>}
            </div>

            <dl className="role-card-facts">
              <dt>{t('role.card.onPages')}</dt>
              <dd>{levelLabel(role.pageLevel)}</dd>
              <dt>{t('role.card.inWorkspace')}</dt>
              <dd>
                {role.rights.length === 0 ? (
                  // Said rather than left blank: an empty cell reads as
                  // something that failed to load, and "manages nothing" is a
                  // fact about the role.
                  <span className="muted">{t('role.card.noRights')}</span>
                ) : (
                  <span className="role-card-rights">
                    {role.rights.map((one) => (
                      <span className="role-card-right" key={one}>
                        {t(`right.${one}` as MessageKey)}
                      </span>
                    ))}
                  </span>
                )}
              </dd>
            </dl>

            <div className="role-card-foot">
              {/* Counted in words rather than as "0 Personen, 0 Gruppen", which
                  is three numbers to read before learning that the answer is
                  nobody. */}
              <span className="muted">
                {role.members + role.groups === 0
                  ? t('role.heldByNobody')
                  : t('role.heldBy', { members: role.members, groups: role.groups })}
              </span>
              {role.key === null && (
                <span className="role-card-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setDraft({
                        id: role.id,
                        name: role.name,
                        pageLevel: role.pageLevel ?? '',
                        rights: [...role.rights],
                      })
                    }
                  >
                    {t('role.edit')}
                  </button>
                  <button type="button" className="btn" onClick={() => remove(role)}>
                    {t('role.delete')}
                  </button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {draft === null ? (
        <button type="button" className="primary" onClick={() => setDraft(emptyDraft())}>
          {t('role.new')}
        </button>
      ) : (
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('role.name')}</b>
              <span>{t('role.name.note')}</span>
            </span>
            <input
              aria-label={t('role.name')}
              value={draft.name}
              autoFocus
              placeholder={t('role.namePlaceholder')}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>

          <fieldset className="settings-row">
            <legend className="settings-row-label">
              <b>{t('role.level')}</b>
              <span>{t('role.level.note')}</span>
            </legend>
            <div className="role-choices">
              {LEVELS.map((level) => (
                <label key={level.value || 'none'}>
                  <input
                    type="radio"
                    name="role-level"
                    checked={draft.pageLevel === level.value}
                    onChange={() => setDraft({ ...draft, pageLevel: level.value })}
                  />
                  {t(level.label)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-row">
            <legend className="settings-row-label">
              <b>{t('role.rights')}</b>
              <span>{t('role.rights.note')}</span>
            </legend>
            <div className="role-choices">
              {rights.map((right) => (
                <label key={right}>
                  <input
                    type="checkbox"
                    checked={draft.rights.includes(right)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        rights: event.target.checked
                          ? [...draft.rights, right]
                          : draft.rights.filter((one) => one !== right),
                      })
                    }
                  />
                  {t(`right.${right}` as MessageKey)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="settings-row">
            <button
              type="button"
              className="primary"
              disabled={draft.name.trim() === ''}
              onClick={save}
            >
              {t('action.save')}
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
