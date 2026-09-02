/**
 * SONE client — recording who wrote what.
 *
 * Yjs already knows: every item in a document carries the client id that
 * created it. What it does not know is which *person* a client id belonged to,
 * because a client id is per browser session — somebody who wrote on three
 * days has three of them.
 *
 * `Y.PermanentUserData` is that mapping, and this is the whole of the recording
 * side. Highlighting is a separate concern that reads it; nothing here draws
 * anything.
 *
 * ## Why this is switched on before anything shows it
 *
 * Attribution is not retroactive (ADR-0022). A document written before it was
 * recording carries no mapping and never will, because the information was
 * never captured — inventing one later would mean guessing. Every day this is
 * off is a day of edits that can never be attributed, so recording starts as
 * soon as the decision is made rather than when the interface for it is ready.
 *
 * ## Why a user id and not a name
 *
 * Names change and are not unique. The mapping stores the user id, and the
 * interface looks up a current name when it draws one — so somebody who changes
 * their display name does not end up as two contributors, and a name is not
 * frozen into the document for ever.
 */

import * as Y from 'yjs';

import { liveClientIds } from '@sone/core';

// From core, where the pruning that also needs it lives (ADR-0022). Two
// spellings of one key is one typo away from a mapping nobody can find.
import { USERS_KEY } from '@sone/core';

/** The map Yjs keeps the mapping in. Its own default; named here for clarity. */

export interface AttributionOptions {
  /** The person editing. Anonymous share visitors have none. */
  userId: string | null;
  /** False leaves the document untouched. */
  enabled: boolean;
  /** A guest's chosen name, used when there is no account. */
  guestName?: string | null;
}

/**
 * The key a guest's writing is recorded under.
 *
 * A guest has no account, but they do have a name: every share link asks for one
 * before letting anybody in. That name is the identity they chose for this page,
 * and refusing to use it — which is what this did — threw away the only thing
 * they had told us and then reported that nobody had written.
 *
 * Prefixed, and the prefix is the point rather than a namespace trick: a guest
 * called "Markus Thiel" must not be indistinguishable from the account of that
 * name. The panel reads the prefix and says who is a guest, so an unverified
 * name is shown as an unverified name.
 *
 * Two guests who type the same name become one entry. That is the honest
 * outcome of an identity that is self-declared and unverified — the alternative
 * is a per-session id, which lists the same person twice for reconnecting.
 */
// The convention itself now lives in @sone/core, because it describes what a
// *document* contains and the server has to read it to project a page's authors
// (ADR-0050). Re-exported so nothing that imported it from here has to change.
export { GUEST_PREFIX, guestKey, guestName, isGuestKey } from '@sone/core';

// Imported as well as re-exported, because this file uses `guestKey` itself.
import { guestKey } from '@sone/core';

/**
 * Start recording this session's edits against a person.
 *
 * Returns null when nothing is recorded, which is the case whenever attribution
 * is off or when there is neither an account nor a name.
 *
 * A guest is recorded under the name they gave (see `guestKey`), because that is
 * what a share link is for: somebody without an account who is nonetheless
 * somebody. What is *not* recorded is a session with no identity at all.
 */
export function recordAttribution(
  doc: Y.Doc,
  options: AttributionOptions,
): Y.PermanentUserData | null {
  const key = options.userId ?? (options.guestName ? guestKey(options.guestName) : null);
  if (!options.enabled || !key) return null;

  const data = new Y.PermanentUserData(doc);

  // Checked before mapping, because Yjs is not idempotent here: setUserMapping
  // appends the client id whether or not it is already listed. Reconnects and
  // re-opens both reach this, so without the check a long session would leave
  // the same id in the mapping many times over — a leak nobody would notice
  // until a document was large, and one that would make pruning count wrong.
  const existing = attributionUsers(doc).get(key) ?? [];
  if (!existing.includes(doc.clientID)) {
    data.setUserMapping(doc, doc.clientID, key);
  }
  return data;
}

/**
 * Whether anything here was written by somebody the document cannot name.
 *
 * A share-link guest is deliberately not recorded (above), and until now that
 * was a silence: the panel listed whoever it could and said nothing about the
 * rest, so a page a guest had visibly written on looked like a page nobody had
 * written on. A reader cannot tell "nobody has written here" from "the person
 * who wrote here cannot be named", and the second is a fact worth stating.
 *
 * Live content only, and by the same pruning rule: a guest whose writing has all
 * been deleted is not a guest this page needs to mention.
 */
export function hasUnattributedWriting(doc: Y.Doc): boolean {
  const mapped = new Set<number>();
  for (const ids of attributionUsers(doc).values()) {
    for (const id of ids) mapped.add(id);
  }
  for (const client of liveClientIds(doc)) {
    if (!mapped.has(client)) return true;
  }
  return false;
}

/** Read the mapping without creating one. */
export function attributionUsers(doc: Y.Doc): Map<string, number[]> {
  const out = new Map<string, number[]>();
  // Checked rather than created: `getMap` would make an empty one, which turns
  // a read into a write and would sync an empty map to everybody.
  if (!doc.share.has(USERS_KEY)) return out;

  for (const [userId, value] of doc.getMap(USERS_KEY).entries()) {
    const ids = value instanceof Y.Map ? value.get('ids') : null;
    const list = ids instanceof Y.Array ? (ids.toArray() as unknown[]) : [];
    out.set(
      userId,
      list.filter((entry): entry is number => typeof entry === 'number'),
    );
  }
  return out;
}

/**
 * Which client ids are still represented by live content.
 *
 * Defined in core so the server can call it too (ADR-0022). Re-exported here
 * because this is where it has always been imported from, and moving a function
 * should not mean editing every file that uses it.
 */
export { liveClientIds } from '@sone/core';
