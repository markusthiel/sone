/**
 * SONE web — keeping documents locally.
 *
 * Edits already survive a lost connection: they live in the CRDT in memory and
 * go out when it returns. What they did not survive was a reload, which is the
 * case that actually happens — a tab restored after a crash, a phone that
 * suspended the page, somebody closing a laptop on a train.
 *
 * ## Why there is no merge logic here
 *
 * Both the stored copy and the server's updates are applied to the same Y.Doc,
 * and a CRDT's defining property is that applying them in any order reaches the
 * same document. There is nothing to compare, no "which side wins", and no
 * conflict for anybody to resolve. The part of offline editing that is usually
 * hard is the part this design already paid for.
 *
 * ## Who gets a local copy
 *
 * Signed-in members, and nobody else. A guest arriving through a share link is
 * often on a borrowed or shared machine, and leaving somebody else's document
 * in that browser's storage is a disclosure they did not agree to — the link
 * gave them access to read a page, not a reason to keep it.
 *
 * ## What stops it growing
 *
 * Every document ever opened would otherwise stay on disk for ever. A record of
 * when each was last opened is kept alongside, and stores older than
 * MAX_AGE_DAYS are deleted at startup. That is a cache bound, not a data
 * policy: the server holds the document, so deleting a local copy costs a
 * reload and never any writing.
 */

import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

/** Prefix, so SONE's stores are recognisable among whatever else an origin has. */
const PREFIX = 'sone-doc:';

/** Where the last-opened times live. Small, and losing it only costs a sweep. */
const INDEX_KEY = 'sone.localDocs';

/** A local copy older than this is dropped. */
const MAX_AGE_DAYS = 30;

type OpenedIndex = Record<string, number>;

function readIndex(): OpenedIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Values that are not numbers would make the sweep compare against NaN and
    // silently keep everything for ever.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, value]) => typeof value === 'number',
      ),
    ) as OpenedIndex;
  } catch {
    return {};
  }
}

function writeIndex(index: OpenedIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage full, or disabled. The copies still work; they are swept less
    // precisely, which is a smaller problem than refusing to store anything.
  }
}

/** Is local storage usable at all? */
export function localStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && typeof localStorage !== 'undefined';
  } catch {
    // Accessing localStorage throws outright in some privacy modes.
    return false;
  }
}

/**
 * Keep this document locally.
 *
 * Returns null when storage is unavailable, so the caller does not have to
 * distinguish "declined" from "impossible" — in both cases the document simply
 * syncs the way it always did.
 */
export function persistLocally(
  docId: string,
  doc: Y.Doc,
): { destroy: () => void } | null {
  if (!localStorageAvailable()) return null;

  const name = `${PREFIX}${docId}`;
  let provider: IndexeddbPersistence;
  try {
    provider = new IndexeddbPersistence(name, doc);
  } catch {
    // A quota refusal, or a browser that reports IndexedDB and then declines to
    // open one. Not fatal: this is a cache.
    return null;
  }

  const index = readIndex();
  index[docId] = Date.now();
  writeIndex(index);

  return {
    destroy: () => {
      // Not `clearData`: that would delete the copy, which is the opposite of
      // the point. Only the connection between this provider and the document
      // is closed.
      void provider.destroy();
    },
  };
}

/**
 * Delete local copies nobody has opened in a while.
 *
 * Run once at startup rather than on a timer: it touches storage, and a
 * background sweep competing with a page that is being typed into buys nothing.
 */
export async function sweepLocalDocs(now = Date.now()): Promise<number> {
  if (!localStorageAvailable()) return 0;

  const index = readIndex();
  const cutoff = now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const stale = Object.entries(index).filter(([, opened]) => opened < cutoff);
  if (stale.length === 0) return 0;

  for (const [docId] of stale) {
    try {
      indexedDB.deleteDatabase(`${PREFIX}${docId}`);
    } catch {
      // Left for the next sweep. A copy that will not delete is a nuisance, not
      // a failure.
    }
    delete index[docId];
  }

  writeIndex(index);
  return stale.length;
}

/**
 * Forget everything stored locally.
 *
 * For signing out, where the alternative is leaving somebody's documents in a
 * browser they may not own. Deliberately thorough: the index goes too, so a
 * later sweep is not looking for stores that are already gone.
 */
export async function clearLocalDocs(): Promise<void> {
  if (!localStorageAvailable()) return;

  for (const docId of Object.keys(readIndex())) {
    try {
      indexedDB.deleteDatabase(`${PREFIX}${docId}`);
    } catch {
      // Best effort; the index is cleared either way, so nothing is left
      // claiming a store exists.
    }
  }

  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    // Nothing further to do.
  }
}
