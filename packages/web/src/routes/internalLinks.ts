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

import { isSameOrigin } from '@sone/editor';

import { paths } from './paths.ts';

/**
 * The address as it is written **into a document** (ADR-0173).
 *
 * Relative, and that is the whole difference from the one below. A link inside
 * a page is followed from wherever that page is being read — behind another
 * host, through a share link, from an export somebody opened elsewhere — so it
 * should name no host at all. `normaliseHref` in the editor already states the
 * rule from its own side: *"a shared page keeps working behind a different
 * host"*.
 *
 * The slug is included when a title is to hand and is decorative as always —
 * `parseRoute` never reads it, so a page renamed after the link was written
 * still resolves.
 */
export function documentAddress(
  pageId: string,
  blockId: string | null,
  title?: string,
): string {
  return paths.page(pageId, title, blockId);
}

/**
 * The same address, for **the clipboard**.
 *
 * Absolute, because this is what somebody pastes: into the link editor here,
 * but just as likely into a chat message or an email, where a bare path is not
 * an address at all. The origin is passed in rather than read from `window` so
 * the shape can be stated in a test without a browser.
 */
export function blockAddress(
  origin: string,
  pageId: string,
  blockId: string | null,
  title?: string,
): string {
  return `${origin}${documentAddress(pageId, blockId, title)}`;
}

/**
 * The same address, for **the clipboard** — whatever shape it is in (ADR-0177).
 *
 * A link stored in a document is relative on purpose: it is followed from
 * wherever the document is read. A bare path is not an address to paste into an
 * email, which is the argument `blockAddress` above is built on — so the two
 * copy buttons that hand somebody an existing link put the host back on.
 *
 * The reverse of `homeRelative` in the editor, and it has to exist because that
 * one now runs on every link that arrives: without this, making internal links
 * uniform would have made copying one worse.
 */
export function forClipboard(href: string, origin: string): string {
  if (!isSameOrigin(href, origin)) return href;
  try {
    return new URL(href, origin).toString();
  } catch {
    return href;
  }
}

/** Where a click on this href should take us, or null to leave it alone. */
export function internalTarget(
  href: string,
  origin: string,
  shareToken: string | null,
): string | null {
  // The rule about what counts as ours is `isSameOrigin`'s, stated once
  // (ADR-0171). The parse below is for the parts, not for the question.
  if (!isSameOrigin(href, origin)) return null;
  const url = new URL(href, origin);

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

/**
 * Is this click the application's to answer? (ADR-0171)
 *
 * No, when it landed in text somebody is writing. Editable text already has a
 * rule for a click on a link and it is the right one: the caret goes into the
 * word, and the card over it offers *open* — because a link nobody can correct
 * is worse than one nobody can follow (ADR-0157).
 *
 * The application was answering first, so the same gesture did two different
 * things depending on which host the address named, and **the words of an
 * internal link could not be edited at all** — clicking into them left the page.
 *
 * `contenteditable="true"` rather than a class or a ProseMirror API: it is the
 * browser's own word for *this is text being written*, it is what makes the
 * browser refuse to follow the anchor in the first place, and it stays true for
 * whatever draws editable text here next. A read-only view carries
 * `contenteditable="false"`, where there is no caret to place and following the
 * link is the only thing a click can mean.
 */
export function answersClick(anchor: Element): boolean {
  return anchor.closest('[contenteditable="true"]') === null;
}
