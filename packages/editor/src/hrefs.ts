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

/**
 * Does this address point back into the instance the reader is on?
 *
 * Here rather than in the application, for the reason the file's header gives
 * about `isFollowable`: two places have to agree. The editor asks so it can
 * leave a link home to be navigated rather than opened in a window of its own
 * (ADR-0171), and the application asks so it can draw one differently and put
 * the reader's share credential back on it (ADR-0170). **A rule written in two
 * packages is a rule that gets updated in one.**
 *
 * Parsed rather than compared as text, because the shapes that fool a string
 * test are exactly the dangerous ones: `//evil.example/p/x` is protocol-relative
 * and resolves to another host while looking like a path, and `javascript:` has
 * no origin at all. Both come back as *not ours*.
 */
export function isSameOrigin(href: string, origin: string): boolean {
  try {
    return new URL(href, origin).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The origin this code is running on, or the empty string outside a browser.
 *
 * **The one place in this module that reads its environment.** Everything else
 * is a function of an origin passed in, which is what makes the rules above
 * statable in a test without a browser — and what keeps a rule from
 * half-applying somewhere nobody can see it: nothing is same-origin with the
 * empty string, so off a page the normalisation simply does not happen.
 */
export const currentOrigin = (): string => globalThis.location?.origin ?? '';

/**
 * An address pointing back here, with the host taken off (ADR-0177).
 *
 * `normaliseHref` has said since ADR-0157 that *"a relative link within this
 * instance is legitimate and should stay relative, so a shared page keeps
 * working behind a different host"* — and then took an absolute one exactly as
 * it arrived. So the sentence was true of what somebody typed and not of what
 * the handle menu puts on the clipboard, which is absolute on purpose
 * (ADR-0170) and is the most likely way an internal link gets made.
 *
 * Here rather than in `links.ts` for the reason this file exists: the schema
 * needs the same answer for a *pasted* link and cannot import that file. Third
 * rule, same argument.
 *
 * Everything else is returned untouched, including an address that only looks
 * like ours — `isSameOrigin` parses rather than compares, which is what catches
 * `//evil.example/p/x` and `https://sone.example.evil/p/x`.
 */
export function homeRelative(href: string, origin: string): string {
  if (origin === '' || !isSameOrigin(href, origin)) return href;
  try {
    const url = new URL(href, origin);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}
