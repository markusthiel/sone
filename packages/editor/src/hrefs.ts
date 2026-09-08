/**
 * SONE — which addresses a link may hold (ADR-0157).
 *
 * Its own module with no imports, because two places have to agree and one of
 * them is the schema. `normaliseHref` lives in `links.ts`, which imports the
 * schema — so the schema cannot ask it without a cycle, and a second copy of
 * the rule in the schema is the copy that would stop being updated.
 *
 * ## Why this is a door and not a filter
 *
 * `javascript:`, `data:` and `vbscript:` in a link are script execution. A notes
 * application is full of pasted text, and pasted HTML brings its own `href`
 * along — so the answer is to refuse the scheme rather than to sanitise the
 * address, because sanitising a URL correctly is not a thing to attempt by hand.
 *
 * **The refusal has to be at every door, and it was at one.** `normaliseHref`
 * guarded links somebody *typed*; the schema's `parseDOM` took a pasted `href`
 * exactly as it arrived, so
 *
 *     <a href="javascript:alert(1)">klick mich</a>
 *
 * pasted into a page and stayed in the document, rendered as a real anchor. The
 * words are kept and the link is dropped: a paste that loses its formatting is
 * an annoyance, and a paste that carries a script is not.
 */

/** Schemes that execute rather than address. */
const EXECUTES = new Set(['javascript', 'data', 'vbscript']);

/**
 * May a link hold this address?
 *
 * Relative and scheme-less addresses pass — they cannot execute, and a page
 * shared behind another host needs its own links to stay relative. Only an
 * explicit executing scheme is refused.
 *
 * The comparison is on the scheme alone, lower-cased: `JavaScript:` and
 * `java\tscript:` are the two shapes a filter written against the whole string
 * gets wrong, and neither survives being parsed as a scheme.
 */
export function isFollowable(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === '') return false;

  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!match) return true;
  return !EXECUTES.has(match[1]!.toLowerCase());
}
