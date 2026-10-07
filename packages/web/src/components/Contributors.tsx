/**
 * SONE web — who has written in this document.
 *
 * Read from the document itself, not fetched. The mapping from client ids to
 * people is in the page's own CRDT, which is already open and already syncing —
 * so this needs no request, and it updates as somebody else joins and types.
 *
 * ## Not the same list as presence
 *
 * Presence answers "who is here now"; this answers "whose writing is this"
 * (ADR-0022). Somebody who wrote half the page last week and is not connected
 * today belongs in this one and not in the avatars at the top. Conflating them
 * would make the page look abandoned the moment everybody closed their laptop.
 *
 * ## Nor the same list as the mapping
 *
 * `writersIn`, not `attributionUsers` (ADR-0116). The mapping is written when a
 * document opens, so it holds everybody who has had the page open — which is
 * what this panel used to show, under the heading "people", beside a note
 * telling somebody to choose a person and see their writing marked.
 *
 * ## What it cannot show
 *
 * Attribution is not retroactive. Anything written before recording began has
 * no mapping and never will, so a document can be full of writing and list
 * nobody. That is said plainly rather than left as an empty panel somebody
 * would read as a bug.
 */

import type { PageHandle } from '@sone/client';
import { useT } from '../i18n/useT.tsx';
import { guestName, hasUnattributedWriting, isGuestKey, writersIn } from '@sone/client';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';

import { api, type WorkspaceMember } from '../api/client.ts';
import { chooseAuthor, chosenAuthor, subscribeChosenAuthor } from './authorHighlightBridge.ts';

interface ContributorsProps {
  /**
   * Null while a page is still opening.
   *
   * The panel can be open before a document is: somebody switches page with the
   * panel showing, and for a moment there is nothing to read. Handled here
   * rather than by the caller, so every panel does not repeat the same guard.
   */
  handle: PageHandle | null;
  workspaceId: string;
}

export function Contributors({ handle, workspaceId }: ContributorsProps): ReactElement {
  const { t } = useT();
  /*
   * Read, not held (ADR-0203).
   *
   * The highlight is drawn by the editor and outlives this component — the
   * panel has nine tabs and React unmounts the eight that are not showing. A
   * copy kept here would come back as "nobody" over a page that is still
   * marked, and the first click would then re-select the same person instead of
   * switching the marking off.
   */
  const selected = useSyncExternalStore(subscribeChosenAuthor, chosenAuthor, chosenAuthor);
  const [userIds, setUserIds] = useState<string[]>(() =>
    handle ? [...writersIn(handle.doc).keys()] : [],
  );
  /** The client ids each person wrote under, which is what the editor marks. */
  const [clientsByUser, setClientsByUser] = useState<Map<string, number[]>>(
    () => (handle ? writersIn(handle.doc) : new Map()),
  );
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  /**
   * Whether somebody the document cannot name has written here.
   *
   * A share-link guest is deliberately not recorded (ADR-0022) — they have no
   * user id, and one contributor that is really several people is worse than
   * saying nothing. But saying *nothing* was the mistake: a page a guest had
   * visibly written on looked like a page nobody had written on, which reads as
   * a broken panel rather than as a deliberate silence.
   */
  const [guests, setGuests] = useState(false);

  // From the document, and again whenever it changes: somebody joining and
  // typing should appear without a reload.
  useEffect(() => {
    /*
     * The chosen person does not travel to the next page — and clearing that is
     * not this component's job (ADR-0203).
     *
     * A new page means a new editor, which draws nothing until it is asked, so
     * a selection carried into it would claim a highlight that is not on
     * screen. The surface registers the new editor's command as it builds it,
     * and the bridge clears the selection there: one event, at the moment the
     * decorations actually go.
     *
     * Clearing it *here* was tried and is wrong. This effect is keyed on the
     * handle, and the handle object is rebuilt on every notification — so the
     * highlight would switch itself off at unpredictable moments while
     * somebody was reading one page.
     */

    if (!handle) {
      setUserIds([]);
      return undefined;
    }
    const doc = handle.doc;
    const read = (): void => {
      const users = writersIn(doc);
      setUserIds([...users.keys()]);
      setClientsByUser(users);
      setGuests(hasUnattributedWriting(doc));
    };
    read();
    doc.on('update', read);
    return () => doc.off('update', read);
  }, [handle]);

  // Names are looked up rather than stored in the document (ADR-0022): a name
  // frozen at the time of writing would leave somebody who renamed themselves
  // appearing as two contributors.
  useEffect(() => {
    let cancelled = false;
    void api
      .members(workspaceId)
      .then((result) => {
        if (!cancelled) setMembers(result.members);
      })
      .catch(() => {
        // Names are a nicety here. Without them the list still says how many
        // people have written, which is more than nothing.
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const people = useMemo(() => {
    const byId = new Map((members ?? []).map((member) => [member.userId, member]));
    return userIds.map((userId) => {
      // A guest, recorded under the name they gave when the share link asked
      // for one (ADR-0022). Marked as a guest rather than shown as a member: the
      // name is self-declared and unverified, and somebody reading the list has
      // to be able to tell those apart.
      if (isGuestKey(userId)) {
        return { userId, name: guestName(userId), known: true, guest: true };
      }
      return {
        userId,
        // Somebody who has left the workspace still wrote what they wrote. Their
        // name is gone, and dropping them from the list would quietly rewrite
        // who worked on the page.
        name: byId.get(userId)?.displayName || t('panel.people.departed'),
        known: byId.has(userId),
        guest: false,
      };
    });
  }, [userIds, members, t]);

  if (people.length === 0) {
    return (
      <div className="panel-section">
        <p className="muted">{t('panel.noPeople')}</p>
        {guests && <p className="muted">{t('panel.guestWriting')}</p>}
      </div>
    );
  }

  return (
    <div className="panel-section">
      {guests && <p className="muted contributor-note">{t('panel.guestWriting')}</p>}

      <ul className="contributor-list">
        {people.map((person) => {
          const chosen = selected === person.userId;
          return (
            <li key={person.userId}>
              <button
                type="button"
                className={chosen ? 'contributor current' : 'contributor'}
                aria-pressed={chosen}
                onClick={() => {
                  // Selecting the same person again clears it. A highlight with
                  // no way off is a mode somebody gets stuck in.
                  const next = chosen ? null : person.userId;
                  chooseAuthor(next, next ? (clientsByUser.get(next) ?? []) : []);
                }}
              >
                <span
                  className="contributor-initial"
                  aria-hidden="true"
                  data-known={person.known ? 'true' : undefined}
                >
                  {person.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span
                  className={person.known ? 'contributor-name' : 'contributor-name muted'}
                >
                  {person.name}
                  {/* Said beside the name rather than instead of it: the name is
                      what they chose to be called, and "guest" is what the page
                      can vouch for. */}
                  {person.guest && <span className="contributor-guest">{t('panel.guest')}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="muted panel-note">
        {selected ? t('panel.people.marked') : t('panel.people.choose')}
      </p>
    </div>
  );
}
