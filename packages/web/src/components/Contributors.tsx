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
 * ## What it cannot show
 *
 * Attribution is not retroactive. Anything written before recording began has
 * no mapping and never will, so a document can be full of writing and list
 * nobody. That is said plainly rather than left as an empty panel somebody
 * would read as a bug.
 */

import type { PageHandle } from '@sone/client';
import { attributionUsers } from '@sone/client';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { api, type WorkspaceMember } from '../api/client.ts';

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

export function Contributors({
  handle,
  workspaceId,
}: ContributorsProps): ReactElement {
  const [userIds, setUserIds] = useState<string[]>(() =>
    handle ? [...attributionUsers(handle.doc).keys()] : [],
  );
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);

  // From the document, and again whenever it changes: somebody joining and
  // typing should appear without a reload.
  useEffect(() => {
    if (!handle) {
      setUserIds([]);
      return undefined;
    }
    const doc = handle.doc;
    const read = (): void => setUserIds([...attributionUsers(doc).keys()]);
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
    return userIds.map((userId) => ({
      userId,
      // Somebody who has left the workspace still wrote what they wrote. Their
      // name is gone, and dropping them from the list would quietly rewrite
      // who worked on the page.
      name: byId.get(userId)?.displayName || 'Somebody who has left',
      known: byId.has(userId),
    }));
  }, [userIds, members]);

  if (people.length === 0) {
    return (
      <div className="panel-section">
        <p className="muted">
          Nobody is recorded yet. Writing is attributed from the moment it is
          written, so anything typed before this page started keeping track is
          not listed here.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-section">
      <ul className="contributor-list">
        {people.map((person) => (
          <li key={person.userId} className="contributor">
            <span
              className="contributor-initial"
              aria-hidden="true"
              data-known={person.known ? 'true' : undefined}
            >
              {person.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className={person.known ? 'contributor-name' : 'contributor-name muted'}>
              {person.name}
            </span>
          </li>
        ))}
      </ul>

      <p className="muted panel-note">
        Everyone who has written here, whether or not they are here now — which
        is what the circles at the top show instead.
      </p>
    </div>
  );
}
