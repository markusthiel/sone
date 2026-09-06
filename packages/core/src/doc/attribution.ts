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

import { DOC_KEYS } from './docSchema.js';

/** Where Y.PermanentUserData keeps its mapping. */
export const USERS_KEY = 'users';

/**
 * The roots a route writes, which are therefore not evidence of a person.
 *
 * `applyToDocument` loads its own `Y.Doc` with its own client id, so a rename,
 * a move, an icon, a lock or an import is live content from a client the
 * mapping has never heard of (ADR-0116). Every one of those writes lands in
 * `page` or `meta` and nowhere else — the body goes through the editor.
 *
 * Used when asking whether somebody *unnameable* has written, and not when
 * pruning: dropping a mapping entry is destructive and the conservative answer
 * there is to keep it.
 */
export const STRUCTURAL_ROOTS: readonly string[] = [DOC_KEYS.meta, DOC_KEYS.page];

export interface LiveClientOptions {
  /** Roots whose content does not count as somebody's writing. */
  skipRoots?: readonly string[];
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
export function liveClientIds(doc: Y.Doc, options: LiveClientOptions = {}): Set<number> {
  const skip = options.skipRoots ?? [];
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
    if (skip.includes(key)) continue;
    walk(type);
  }

  return seen;
}

/**
 * Who has written what is still on this page (ADR-0116).
 *
 * The mapping answers a different question. `recordAttribution` runs when a
 * document *opens*, and it has to: attribution is not retroactive, so the
 * mapping must be in place before the first keystroke rather than after it.
 * What it therefore holds is everybody who has had the page open — everybody
 * who *might* have written — and reading it as the answer lists a colleague who
 * glanced at the page beside the person who wrote it.
 *
 * The other half is already here. Intersecting the mapping with `liveClientIds`
 * is the same rule pruning has used since ADR-0022, asked at the moment
 * somebody wants the answer rather than whenever a server-side mutation
 * happened to run last — which is why two pages with the same history could
 * list different people.
 *
 * The client ids are kept, not just the names: the panel marks a person's
 * writing in the editor with them, and a name with no ids is a name nobody can
 * click.
 *
 * All roots, including the structural ones: somebody who did nothing here but
 * give the page its title did write the title.
 */
export function writersIn(doc: Y.Doc): Map<string, number[]> {
  const out = new Map<string, number[]>();
  // Checked rather than created: `getMap` would make an empty one, which turns
  // a read into a write and would sync an empty map to everybody.
  if (!doc.share.has(USERS_KEY)) return out;

  const live = liveClientIds(doc);
  for (const [userKey, value] of doc.getMap(USERS_KEY).entries()) {
    const ids = value instanceof Y.Map ? value.get('ids') : null;
    const list = ids instanceof Y.Array ? (ids.toArray() as unknown[]) : [];
    const mine = list.filter(
      (entry): entry is number => typeof entry === 'number' && live.has(entry),
    );
    // Absent rather than present-and-empty: a caller that has to remember to
    // check the length is a caller that will forget once.
    if (mine.length > 0) out.set(userKey, mine);
  }
  return out;
}

/**
 * Whether anything still here was written by somebody the document cannot name.
 *
 * A share-link guest is deliberately not recorded (ADR-0022), and until that was
 * said out loud it was a silence: a page a guest had visibly written on looked
 * like a page nobody had written on. A reader cannot tell "nobody has written
 * here" from "the person who wrote here cannot be named", and the second is a
 * fact worth stating.
 *
 * Structural roots excluded, which is the correction ADR-0116 makes. A rename
 * over HTTP is a write by a client id no mapping has ever heard of, so one
 * rename made this true — and it is true on very nearly every page. A note that
 * is always there says nothing, and this one named two causes, neither of which
 * was the usual one.
 *
 * Live content only, by the same rule as everything else here: a guest whose
 * writing has all been deleted is not a guest this page needs to mention.
 */
export function hasUnattributedWriting(doc: Y.Doc): boolean {
  const mapped = new Set<number>();
  if (doc.share.has(USERS_KEY)) {
    for (const value of doc.getMap(USERS_KEY).values()) {
      const ids = value instanceof Y.Map ? value.get('ids') : null;
      if (!(ids instanceof Y.Array)) continue;
      for (const entry of ids.toArray() as unknown[]) {
        if (typeof entry === 'number') mapped.add(entry);
      }
    }
  }

  for (const client of liveClientIds(doc, { skipRoots: STRUCTURAL_ROOTS })) {
    if (!mapped.has(client)) return true;
  }
  return false;
}

/**
 * Which person each client id belongs to, from the document's own mapping.
 *
 * `Y.PermanentUserData` keeps `userKey -> { ids: [clientId, …] }`, written by
 * every client when it opens a page. This inverts it, because everything that
 * reads authorship has a client id in hand and wants the person.
 *
 * A user id for an account, a `guest:` key for somebody who has none — the same
 * two shapes a comment's author field carries, so a caller comparing the two
 * is comparing like with like.
 *
 * Built from the map rather than from a live `Y.PermanentUserData`, which
 * observes and throws when an entry is removed from under it (see
 * `pruneAttribution`). This only reads.
 */
export function authorsByClient(doc: Y.Doc): Map<number, string> {
  const out = new Map<number, string>();
  for (const [userKey, value] of doc.getMap(USERS_KEY).entries()) {
    const ids = value instanceof Y.Map ? value.get('ids') : null;
    if (!(ids instanceof Y.Array)) continue;
    for (const entry of ids.toArray() as unknown[]) {
      // Last writer wins on a collision, which cannot happen legitimately: a
      // client id belongs to one session. Not worth an error — a document is
      // written by clients we do not control, and the alternative to a
      // arbitrary answer here is no attribution at all.
      if (typeof entry === 'number') out.set(entry, userKey);
    }
  }
  return out;
}

/**
 * How a guest is named in a document's attribution (ADR-0022).
 *
 * Prefixed, and the prefix is the point rather than a namespace trick: a guest
 * called "Markus Thiel" must not be indistinguishable from the account of that
 * name. Anything reading the mapping reads the prefix and can say which is
 * which.
 *
 * Moved here from `@sone/client` when the search projection needed it: this is a
 * convention about what a *document* contains, and the server has to read it to
 * project who wrote a page (ADR-0050). The client re-exports it, so nothing that
 * imported it from there has to change — and duplicating the prefix in a second
 * package would have been two definitions of one convention.
 */
export const GUEST_PREFIX = 'guest:';

export function guestKey(displayName: string): string {
  const name = displayName.trim().slice(0, 64);
  return `${GUEST_PREFIX}${name === '' ? 'Guest' : name}`;
}

/** Whether an attribution key belongs to a guest rather than an account. */
export function isGuestKey(key: string): boolean {
  return key.startsWith(GUEST_PREFIX);
}

/** The name a guest gave, without the prefix. */
export function guestName(key: string): string {
  return key.slice(GUEST_PREFIX.length);
}
