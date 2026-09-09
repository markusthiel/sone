/**
 * SONE web — everything this page links to (ADR-0158).
 *
 * Its own file, and the other six panels in `RightSidebar.tsx` deliberately
 * stayed where they are: moving them all is a change with its own reasons, and
 * tangling it into this one would make both harder to read. This one moved
 * because it grew a decision worth testing on its own — whether an address may
 * be offered as a link at all.
 *
 * ## Why a link here needs the same door as a link in the text
 *
 * ADR-0157 closed `javascript:` at both the doors a *new* link comes through:
 * typing and pasting. It could not close the one that is already open — a CRDT
 * keeps whatever ever reached it, so a page written before that round can still
 * carry one — which is why the editor asks again at the moment of following.
 *
 * This panel is a **second way to follow a link**, and it was not asking. An
 * address that cannot be followed is drawn here as what it is: a row with the
 * text and the address, and nothing to click.
 */

import { useEffect, useState, type ReactElement } from 'react';

import type { PageHandle } from '@sone/client';
import { isFollowable, isSameOrigin } from '@sone/editor';

import { api } from '../api/client.ts';
import { forClipboard } from '../routes/internalLinks.ts';
import { useDocAssets } from '../hooks/useDocAssets.ts';
import { usePageLink } from '../routes/pageLink.tsx';
import { scrollToBlock } from '../hooks/useOutline.ts';
import { useT } from '../i18n/useT.tsx';
// `DuplicateIcon` rather than a new one: it is the two-rectangles glyph
// everything uses for copy, and two unrelated shapes for one idea is two things
// to learn — the argument this file's icons already make about undo and redo.
import { DuplicateIcon, ExternalIcon, PageIcon } from './icons.tsx';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.ts';

/**
 * The host of a URL, or the URL itself.
 *
 * A relative link — one page of this instance pointing at another — has no host,
 * and showing an empty line for it would be worse than showing the path.
 */
export function hostOf(href: string): string {
  try {
    return new URL(href, window.location.origin).host;
  } catch {
    return href;
  }
}

/** A page that points here, as the projection reports it (ADR-0174). */
interface Backlink {
  pageId: string;
  title: string | null;
  kind: 'page' | 'canvas' | 'folder';
  blockId: string;
  workspaceId: string;
  workspaceName: string;
}

export function LinksPanel({
  handle,
  pageId,
  workspaceId,
}: {
  handle: PageHandle | null;
  /** Whose backlinks to ask for. Null before a page is open. */
  pageId: string | null;
  /**
   * The workspace being read, so a reference from another one says which
   * (ADR-0176). Empty on a share link, where there are no backlinks at all.
   */
  workspaceId: string;
}): ReactElement {
  const { t } = useT();
  const { links } = useDocAssets(handle?.doc ?? null);
  const { copy, copied } = useCopyToClipboard();
  const pageLink = usePageLink();

  /*
   * Who points here (ADR-0174).
   *
   * Asked of the server rather than read from a document, because the pages
   * that point here are documents nobody has open — and answered only for the
   * ones this person may read, which the route decides.
   *
   * A failure leaves the list empty and says nothing. On a share link the
   * request is refused for want of a session, and that is the correct answer to
   * draw: a visitor is not told what else the workspace contains (ADR-0026).
   */
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  useEffect(() => {
    if (!pageId) {
      setBacklinks([]);
      return undefined;
    }
    let live = true;
    void api
      .backlinks(pageId)
      .then((answer) => {
        if (live) setBacklinks(answer.backlinks);
      })
      .catch(() => {
        if (live) setBacklinks([]);
      });
    return () => {
      live = false;
    };
  }, [pageId, handle]);

  const pointingHere =
    backlinks.length === 0 ? null : (
      /*
       * `section` + `panel-heading`, the shape the comments panel uses for the
       * same job (ADR-0057). A heading only once there is a second list under
       * it: one list in a panel needs no name, two do.
       */
      <section className="panel-section">
        <h3 className="panel-heading">{t('panel.pointsHere')}</h3>
        <ul className="asset-list">
          {backlinks.map((one) => (
            <li key={`${one.pageId}-${one.blockId}`}>
              <a
                className="asset-row"
                href={pageLink(one.pageId, one.title ?? '', one.blockId)}
              >
                <PageIcon />
                <span className="asset-name">
                  {one.title?.trim() || t('panel.untitled')}
                  {/* The workspace only when it is not this one (ADR-0176).
                      Naming the one somebody is standing in would be noise on
                      every row; leaving it off the others would make a click
                      that changes workspace look like one that does not. */}
                  <span className="asset-sub">
                    {one.workspaceId === workspaceId
                      ? t('panel.pointsHereSub')
                      : one.workspaceName}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    );

  if (!handle) return <p className="panel-empty">{t('panel.openForLinks')}</p>;
  if (links.length === 0) {
    return (
      <>
        <p className="panel-empty">{t('panel.noLinks')}</p>
        {pointingHere}
      </>
    );
  }

  return (
    <>
    <ul className="asset-list">
      {links.map((link, at) => {
        const key = `${link.blockId}-${at}`;
        const label = link.text.trim() || link.href;
        const followable = isFollowable(link.href);
        /*
         * A link home does not open a second copy of the application
         * (ADR-0170).
         *
         * `target="_blank"` is right for a link *out* and wrong for one that
         * points back into this instance: a new tab means a second sync
         * connection, a second document, and losing the place you were reading
         * — for what a click was supposed to do in this window.
         *
         * The app's own interception handles it from there, and puts a share
         * visitor's token back on (see `internalLinks.ts`).
         */
        const internal = isSameOrigin(link.href, window.location.origin);

        return (
          <li key={key}>
            {followable ? (
              <a
                className="asset-row"
                href={link.href}
                {...(internal
                  ? {}
                  : {
                      target: '_blank',
                      // Both words. `noreferrer` implies the other in every
                      // browser that matters, and the schema writes the pair on
                      // every anchor it renders — a rule written one way in one
                      // place and another way in the next is a rule nobody can
                      // check.
                      rel: 'noopener noreferrer',
                    })}
              >
                <ExternalIcon />
                <span className="asset-name">
                  {label}
                  <span className="asset-sub">
                    {internal ? t('panel.linkInternal') : hostOf(link.href)}
                  </span>
                </span>
              </a>
            ) : (
              /*
               * An address that executes is not an address (ADR-0157).
               *
               * Shown rather than hidden, and disabled rather than linked: the
               * words are in the page and a list that quietly omits one of them
               * reads as a list that is wrong. The same shape a file whose
               * upload has not finished gets, for the same reason.
               */
              <span className="asset-row" aria-disabled="true" title={t('panel.linkRefused')}>
                <ExternalIcon />
                <span className="asset-name">
                  {label}
                  <span className="asset-sub">{t('panel.linkRefused')}</span>
                </span>
              </span>
            )}

            {/* Asked for in the same breath as opening one: *„den Link in
                neuem Fenster zu öffnen, zu kopieren usw"*. Offered for a
                refused address too — copying a string is not following it, and
                somebody looking at a link they did not expect wants to be able
                to paste it somewhere and look. */}
            <button
              type="button"
              className="asset-jump"
              title={copied === key ? t('format.linkCopied') : t('format.linkCopy')}
              aria-label={t('format.linkCopy')}
              // With the host back on, for the reason above it (ADR-0177).
              onClick={() => void copy(forClipboard(link.href, window.location.origin), key)}
            >
              <DuplicateIcon />
            </button>

            <button
              type="button"
              className="asset-jump"
              title={t('panel.showInPage')}
              aria-label={t('panel.showLinkInPage')}
              onClick={() => scrollToBlock(link.blockId)}
            >
              <PageIcon />
            </button>
          </li>
        );
      })}
    </ul>
    {pointingHere}
    </>
  );
}
