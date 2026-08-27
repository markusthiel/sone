/**
 * SONE — tags.
 *
 * Names on a page's document, normalised for matching and kept as first typed
 * for display (ADR-0020).
 *
 * The normalisation is the whole contract. `Meeting`, `meeting ` and `  MEETING`
 * have to be one tag, or a workspace accumulates near-duplicates that look
 * identical in a list and behave differently in a filter — which is the failure
 * mode of every tag system that skips this.
 */

import * as Y from 'yjs';

import { DOC_KEYS, PAGE_KEYS } from './docSchema.js';

/** Longest a tag may be. Long enough for a phrase, short enough to render. */
export const MAX_TAG_LENGTH = 64;
/** Most tags one page may carry, so a document cannot be filled with them. */
export const MAX_TAGS_PER_PAGE = 32;

/**
 * The key a tag matches on.
 *
 * Lowercased, trimmed, inner whitespace collapsed. Case folding uses the
 * locale-independent form: a Turkish dotless ı must not make `Ilse` and `ilse`
 * different tags for one person and the same for another.
 */
export function tagKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Is this usable as a tag at all? */
export function isValidTag(raw: string): boolean {
  const key = tagKey(raw);
  return key.length > 0 && key.length <= MAX_TAG_LENGTH;
}

/**
 * Clean a list of tags: trimmed, de-duplicated by key, capped, order preserved.
 *
 * The first spelling of a key wins, which is what makes "typed as Meeting,
 * shows as Meeting" work when someone else later types "meeting".
 */
export function normaliseTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const display = value.trim().replace(/\s+/g, ' ');
    if (!isValidTag(display)) continue;
    const key = tagKey(display);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(display);
    if (out.length >= MAX_TAGS_PER_PAGE) break;
  }

  return out;
}

/** The tags on a document, cleaned. */
export function readTags(doc: Y.Doc): string[] {
  const page = doc.getMap(DOC_KEYS.page);
  const value = page.get(PAGE_KEYS.tags);

  // A Y.Array is the shape written here. A plain array can arrive from an
  // importer or an older document, and is read rather than rejected.
  if (value instanceof Y.Array) return normaliseTags(value.toArray() as string[]);
  if (Array.isArray(value)) return normaliseTags(value as string[]);
  return [];
}

/**
 * Replace the tags on a document.
 *
 * The array is rewritten rather than diffed. Two people editing the same page's
 * tags at the same moment is rare enough that last-writer-wins on the whole
 * list is the right trade against the complexity of a merge that would have to
 * decide whether a removal or an addition wins.
 */
export function writeTags(doc: Y.Doc, tags: readonly string[]): string[] {
  const cleaned = normaliseTags(tags);
  const page = doc.getMap(DOC_KEYS.page);

  doc.transact(() => {
    const array = new Y.Array<string>();
    array.push(cleaned);
    page.set(PAGE_KEYS.tags, array);
  });

  return cleaned;
}
