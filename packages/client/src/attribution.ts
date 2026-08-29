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

/** The map Yjs keeps the mapping in. Its own default; named here for clarity. */
const USERS_KEY = 'users';

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
 * The basis for pruning (ADR-0022): a mapping entry may go when nothing of that
 * person's writing is left, and doing so makes content unattributed rather than
 * touching content. That is safe in a way the tombstones underneath are not —
 * a CRDT must keep deletions for ever because convergence depends on them,
 * while attribution is an annotation and losing it costs a label.
 *
 * Live, not "ever existed": the point of pruning is precisely that deleted text
 * should not keep somebody's name in the record.
 */
export function liveClientIds(doc: Y.Doc): Set<number> {
  const seen = new Set<number>();

  // `any` in the parameter, deliberately: Yjs types a shared type by the event
  // it emits, and `doc.share` holds several kinds at once. Narrowing to one
  // would be a lie about what the map contains, and widening to `unknown` does
  // not satisfy the library's own signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (type: Y.AbstractType<any>): void => {
    let item = type._start;
    while (item !== null) {
      if (!item.deleted) {
        seen.add(item.id.client);
        const content = item.content;
        // A nested type — a paragraph inside the fragment, a cell inside a
        // table — carries its own items, and its author is not the author of
        // the node that contains it.
        if (content instanceof Y.ContentType) walk(content.type);
      }
      item = item.right;
    }

    for (const value of type._map.values()) {
      if (!value.deleted) seen.add(value.id.client);
    }
  };

  for (const [key, type] of doc.share) {
    // The mapping itself is not content: counting it would keep every entry
    // alive by its own existence, which is the opposite of pruning.
    if (key === USERS_KEY) continue;
    walk(type);
  }

  return seen;
}
