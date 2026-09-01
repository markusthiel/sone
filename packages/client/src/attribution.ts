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
}

/**
 * Start recording this session's edits against a person.
 *
 * Returns null when nothing is recorded, which is the case for an anonymous
 * visitor and whenever attribution is off. The caller does not have to
 * distinguish the two: in both, the document simply carries no mapping for this
 * session.
 *
 * A share-link guest is deliberately not recorded. They have no user id to
 * record *against* — attributing to "a guest" would produce one contributor
 * that is really several people, which is worse than saying nothing.
 */
export function recordAttribution(
  doc: Y.Doc,
  options: AttributionOptions,
): Y.PermanentUserData | null {
  if (!options.enabled || !options.userId) return null;

  const data = new Y.PermanentUserData(doc);

  // Checked before mapping, because Yjs is not idempotent here: setUserMapping
  // appends the client id whether or not it is already listed. Reconnects and
  // re-opens both reach this, so without the check a long session would leave
  // the same id in the mapping many times over — a leak nobody would notice
  // until a document was large, and one that would make pruning count wrong.
  const existing = attributionUsers(doc).get(options.userId) ?? [];
  if (!existing.includes(doc.clientID)) {
    data.setUserMapping(doc, doc.clientID, options.userId);
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
