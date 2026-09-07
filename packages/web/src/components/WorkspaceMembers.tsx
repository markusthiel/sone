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

import { ApiError, api, type WorkspaceMember, type WorkspaceRoleRow } from '../api/client.ts';
import type { MessageKey } from '../i18n/messages.en.ts';
import { useChoiceList } from '../hooks/useChoiceList.ts';
import { messageFor } from './Auth.tsx';
import { PendingInvitations } from './PendingInvitations.tsx';

/**
 * The roles somebody can be let in as, when the list could not be fetched.
 *
 * A fallback, not the offer (ADR-0103). This used to be the whole picker — a
 * hardcoded three, ten lines above a table that lists every role this workspace
 * has, by id, because "a role somebody defined is no less a role" (ADR-0087).
 * So letting a colleague in as "Redaktion" meant adding them as a **member**
 * first, which is `editor` on every page here, and moving them afterwards.
 *
 * Kept for the case where reading the roles genuinely failed: three words that
 * certainly exist beat an empty picker on a form whose job is to add somebody.
 *
 * No owner, either way. A second owner is a decision about who can delete the
 * workspace, and it is one to take deliberately in the table below rather than
 * in the same breath as "add this person" (ADR-0073).
 */
const FALLBACK: Array<{ id: string; label: MessageKey }> = [
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
  const [roles, setRoles] = useState<WorkspaceRoleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * What is typed into the person field, and what came back for it (ADR-0119).
   *
   * `email` is still the value the request carries, because the route takes an
   * address — what changed is how somebody arrives at one. `picked` is set when
   * a suggestion is chosen, and it is what turns the button on: an address
   * typed by hand still works, and a person chosen from the list is confirmed
   * before the click rather than after it.
   */
  const [email, setEmail] = useState('');
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<
    Array<{ id: string; displayName: string; email: string; member: boolean }>
  >([]);
  const [picked, setPicked] = useState<{ displayName: string; email: string } | null>(null);
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

  useEffect(() => {
    /*
     * The roles this workspace has, for both pickers.
     *
     * **Either right reaches this list** — `roles.manage` or `people.manage`
     * (ADR-0087), which is one route rather than two precisely so that whoever
     * may give somebody a role can see the roles. This comment used to say the
     * listing needed `roles.manage`, and that belief is why the form above the
     * table offered a hardcoded three words for as long as it did.
     *
     * Failing quietly to an empty list all the same: a fetch can fail for
     * ordinary reasons, and the form then falls back to the three system words
     * rather than to an empty picker.
     */
    void api
      .roles(workspaceId)
      .then((result) => {
        setRoles(result.roles);
        // Default to `member`, which is what the word-shaped default meant.
        // Set here rather than in `useState`, because the id is not known until
        // the list arrives.
        const fallbackMember = result.roles.find((one) => one.key === 'member');
        if (fallbackMember) setRole(fallbackMember.id);
      })
      .catch(() => setRoles([]));
  }, [workspaceId]);

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

  /*
   * What the form may offer: every role this workspace has, minus owner.
   *
   * The same list the table's picker draws from, because it is the same
   * question — and a form that offers less than the control beside it is a form
   * that makes people do the thing in two steps (ADR-0103).
   */
  /*
   * Look, as they type.
   *
   * Debounced and superseded rather than cancelled, the same discipline the
   * search screen uses: an out-of-order reply from a slower earlier query would
   * otherwise overwrite the newer one, which looks like the wrong person being
   * suggested.
   */
  useEffect(() => {
    const wanted = lookup.trim();
    if (wanted.length < 2) {
      setFound([]);
      return undefined;
    }
    /*
     * Not while the field is holding somebody who has been chosen.
     *
     * Choosing writes their name into the field, which is a change to the
     * query — so the lookup ran again, the person matched their own name, and
     * the list reopened under a field that had already been answered. Invisible
     * with a mouse, because the pointer is on its way to the button by then.
     * With the keyboard it is the difference between Enter adding somebody and
     * Enter choosing them a second time (ADR-0142).
     */
    if (picked && wanted === picked.displayName) {
      setFound([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api.findPeople(workspaceId, wanted).then(
        (result) => live && setFound(result.people),
        // Silent: the field still takes an address, so a failed lookup costs a
        // convenience rather than the ability to add anybody.
        () => live && setFound([]),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lookup, workspaceId, picked]);

  const offered = roles.filter((one) => one.key !== 'owner');
  const usingIds = offered.length > 0;
  /** The system word for whatever is selected, or null for a custom role. */
  const selectedKey = usingIds
    ? (offered.find((one) => one.id === role)?.key ?? null)
    : role;

  /** Take one of the suggestions, by pointer or by key. */
  const choose = (person: (typeof found)[number]): void => {
    // Somebody already here is offered and refused rather than hidden, so the
    // keyboard has to refuse them too — otherwise Enter would silently fill the
    // field with a person the button beside it will not add.
    if (person.member) return;
    setPicked(person);
    setEmail(person.email);
    setLookup(person.displayName);
    setFound([]);
  };

  const list = useChoiceList({
    count: found.length,
    onChoose: (at) => {
      const person = found[at];
      if (person) choose(person);
    },
    resetOn: lookup,
  });

  const add = (): void => {
    const address = email.trim();
    if (address === '') return;
    setBusy(true);
    setError(null);
    setAdded(null);
    void api
      // By id when the roles are known, and by word when they are not: a custom
      // role has no word, and the three fallback words have no id here.
      .addMember(workspaceId, usingIds ? { email: address, roleId: role } : { email: address, role })
      .then(() => {
        setEmail('');
        setLookup('');
        setPicked(null);
        setFound([]);
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
            {/* A person, found by name or by address (ADR-0119).
              *
              * It was an address field, and the answer to "is that the right
              * person, and do they even exist" arrived after the button, as an
              * error. A name is what somebody has in mind; an address is what
              * they have to look up first.
              *
              * The field still accepts a typed address — the route takes one,
              * and somebody who has been given an address by mail should not
              * have to search for a name they do not know. */}
            <div className="settings-row">
              <span className="settings-row-label">
                <b>{t('access.person')}</b>
                <span>{t('access.person.hint')}</span>
              </span>
              <div className="person-picker">
                <input
                  type="text"
                  value={lookup}
                  placeholder={t('access.example')}
                  aria-label={t('access.person')}
                  {...list.fieldProps}
                  onChange={(event) => {
                    setLookup(event.target.value);
                    // Typing after choosing somebody un-chooses them: the field
                    // and the person it named have to agree, or the button
                    // would add whoever was picked three edits ago.
                    setPicked(null);
                    setEmail(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    /*
                     * The list first, and the form only if the list did not
                     * want the key (ADR-0142).
                     *
                     * This field said `role="combobox"` over a listbox of
                     * options — a contract in which Enter takes the current
                     * one. There was no current one, and Enter ran `add()`,
                     * which sends what is in the address box; while somebody
                     * is searching by name, that is **the name**. So Enter on
                     * a visible Anna Weber tried to add a member called "an".
                     *
                     * With nothing highlighted the key is still the form's,
                     * because the field takes a typed address too (ADR-0119).
                     */
                    if (list.handleKey(event)) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      add();
                    }
                  }}
                />
                {found.length > 0 && (
                  <ul className="person-suggestions" {...list.listProps} ref={list.listRef}>
                    {found.map((person, at) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          className="person-suggestion"
                          {...list.optionProps(at)}
                          /* Somebody already here is shown and refused rather
                             than hidden. Hidden, they read as "no such person",
                             which is the confusion this change is fixing. */
                          disabled={person.member}
                          // As well as `disabled`: with `role="option"` the
                          // element is no longer read as a button, and this is
                          // the attribute an option is refused by.
                          aria-disabled={person.member || undefined}
                          onClick={() => choose(person)}
                        >
                          <span className="person-suggestion-name">{person.displayName}</span>
                          <span className="person-suggestion-mail">{person.email}</span>
                          {person.member && (
                            <span className="person-suggestion-here">
                              {t('access.alreadyHere')}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Who is about to be added, in words, above the button.
                  *
                  * The confirmation the report asked for: not "the address is
                  * well-formed" but "this is the person, by name". */}
                {picked && (
                  <p className="person-picked muted">
                    {t('access.willAdd', { name: picked.displayName, email: picked.email })}
                  </p>
                )}
              </div>
            </div>
            <label className="settings-row">
              <span className="settings-row-label">
                <b>{t('access.as')}</b>
                {/* The hint belongs to the four words, which are the only roles
                    whose meaning is fixed enough to describe in advance. A role
                    this workspace made says what it does on the roles screen,
                    and inventing a sentence for it here would be a second
                    description to keep in step. */}
                <span>{selectedKey ? t(`role.${selectedKey}.hint` as MessageKey) : ''}</span>
              </span>
              <select
                value={role}
                aria-label={t('access.as')}
                onChange={(event) => setRole(event.target.value)}
              >
                {usingIds
                  ? offered.map((one) => (
                      <option key={one.id} value={one.id}>
                        {/* A system role is translated; a custom one is called
                            what somebody called it (ADR-0087). The same rule as
                            the picker in the table below. */}
                        {one.key ? t(`role.${one.key}` as MessageKey) : one.name}
                      </option>
                    ))
                  : FALLBACK.map((one) => (
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
                    value={member.roleId ?? ''}
                    aria-label={t('member.roleFor', { name: member.displayName })}
                    onChange={(event) =>
                      act(api.setMemberRoleId(workspaceId, member.userId, event.target.value))
                    }
                  >
                    {/* Every role this workspace has, not the four words
                        (ADR-0087) — a role somebody defined is no less a role
                        than a built-in one, and a picker that omitted it would
                        make the settings area a place to define things nobody
                        can be given.

                        By id rather than by name: two roles cannot share a
                        name, but the four built-in ones are shown translated
                        (ADR-0041) and their translated names are not what the
                        server is being told. */}
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.key ? t(`role.${role.key}` as MessageKey) : role.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  // A custom role has no key to translate, so its own name is
                  // the only name it has.
                  member.roleId !== null && member.role === 'custom'
                    ? member.roleName
                    : t(`role.${member.role}` as MessageKey)
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
