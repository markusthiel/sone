/**
 * SONE web — links that point inside this instance (ADR-0170).
 *
 * Two functions, and the whole module exists because they answer two different
 * questions that look like one:
 *
 *   - `blockAddress` — what goes **into a document**.
 *   - `internalTarget` — what happens **on a click**.
 *
 * ## Why they cannot be the same address
 *
 * `usePageLink()` builds a URL for wherever the person is standing, and in a
 * share view that means the token is in it (ADR-0113). That is right for a link
 * being *followed*: dropping the credential mid-document is a login wall in the
 * middle of something somebody was given.
 *
 * It is wrong for a link being *stored*. A token written into a page is a
 * credential that travels with the page — copied into the next share, exported
 * with the document, read by everybody the page is later shown to. So this
 * module is deliberately not a hook and reads no context: there is nothing for
 * a token to arrive through, which is a stronger guarantee than remembering not
 * to pass one.
 *
 * The credential is put back on at the moment of the click instead, taken from
 * the address bar rather than from the content. **The token belongs to the
 * reader, not to what is being read.**
 */

import { paths } from './paths.ts';

/**
 * The address of a block, or of a page when no block is named.
 *
 * Absolute, because this is what somebody pastes: into the link editor here,
 * but just as likely into a chat message or an email, where a bare path is not
 * an address at all. The origin is passed in rather than read from `window` so
 * the shape can be stated in a test without a browser.
 *
 * The slug is included when a title is to hand and is decorative as always —
 * `parseRoute` never reads it, so a page renamed after the link was written
 * still resolves.
 */
export function blockAddress(
  origin: string,
  pageId: string,
  blockId: string | null,
  title?: string,
): string {
  return `${origin}${paths.page(pageId, title, blockId)}`;
}

/** Where a click on this href should take us, or null to leave it alone. */
export function internalTarget(
  href: string,
  origin: string,
  shareToken: string | null,
): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;

  /*
   * The fragment is kept, and that was the whole first fault.
   *
   * The interception navigated to `pathname + search`, so an internal link
   * landed on the right page and never on the block it named. Which reads, to
   * whoever wrote the link, as a link that does not work.
   */
  const here = `${url.pathname}${url.search}${url.hash}`;

  if (!shareToken) return here;
  // Already through a share; nothing to add.
  if (url.pathname.startsWith('/s/')) return here;
  /*
   * Only the page space has two shapes.
   *
   * `/settings`, `/search`, `/admin` exist once, and prefixing one with a share
   * token would invent a URL that has never existed. A visitor cannot reach
   * them anyway — that is the session's answer to give, not this function's.
   */
  if (!url.pathname.startsWith('/p/')) return here;

  return `/s/${encodeURIComponent(shareToken)}${here}`;
}

/** Whether this address is one of ours, for a component deciding how to draw it. */
export function isInternal(href: string, origin: string): boolean {
  try {
    return new URL(href, origin).origin === origin;
  } catch {
    return false;
  }
}
