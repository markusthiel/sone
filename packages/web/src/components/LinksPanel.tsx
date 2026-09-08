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

import type { ReactElement } from 'react';

import type { PageHandle } from '@sone/client';
import { isFollowable } from '@sone/editor';

import { useDocAssets } from '../hooks/useDocAssets.ts';
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

export function LinksPanel({ handle }: { handle: PageHandle | null }): ReactElement {
  const { t } = useT();
  const { links } = useDocAssets(handle?.doc ?? null);
  const { copy, copied } = useCopyToClipboard();

  if (!handle) return <p className="panel-empty">{t('panel.openForLinks')}</p>;
  if (links.length === 0) {
    return <p className="panel-empty">{t('panel.noLinks')}</p>;
  }

  return (
    <ul className="asset-list">
      {links.map((link, at) => {
        const key = `${link.blockId}-${at}`;
        const label = link.text.trim() || link.href;
        const followable = isFollowable(link.href);

        return (
          <li key={key}>
            {followable ? (
              <a
                className="asset-row"
                href={link.href}
                target="_blank"
                // Both words. `noreferrer` implies the other in every browser
                // that matters, and the schema writes the pair on every anchor
                // it renders — a rule that is written one way in one place and
                // another way in the next is a rule nobody can check.
                rel="noopener noreferrer"
              >
                <ExternalIcon />
                <span className="asset-name">
                  {label}
                  <span className="asset-sub">{hostOf(link.href)}</span>
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
              onClick={() => void copy(link.href, key)}
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
  );
}
