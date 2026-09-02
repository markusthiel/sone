/**
 * SONE core — pruning attribution.
 *
 * Moved here from the client package so the server can call it (ADR-0022). It
 * was written where it was first needed and belongs where both sides can reach
 * it: the alternative was a second copy on the server, and two implementations
 * of "whose writing is still here" would disagree the first time either was
 * touched.
 */

import * as Y from 'yjs';

/** Where Y.PermanentUserData keeps its mapping. */
export const USERS_KEY = 'users';

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
      if (value.deleted) continue;
      seen.add(value.id.client);
      // And into it, the same as above.
      //
      // This did not recurse, and the walk over the list did — so writing inside
      // anything held in a map was invisible to pruning and the person who wrote
      // it lost their attribution. That is a canvas note (an item is a map, its
      // words a Y.Text inside it) and a collection's properties, which is to say
      // somebody appeared in the people panel, then vanished when the pruner
      // next ran, having written something that is still on the page.
      const content = value.content;
      if (content instanceof Y.ContentType) walk(content.type);
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
