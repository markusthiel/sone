/**
 * SONE web — choosing which page `[[` means (ADR-0173).
 *
 * The third menu of this shape, and the same division as the mentions: the
 * plugin holds a position and a query, and everything about *which pages exist*
 * lives here. `@sone/editor` has no business knowing how this application asks
 * a server what a workspace contains.
 *
 * The pages are handed in rather than fetched, from the list the sidebar
 * already holds. One answer to "what is in this workspace" rather than two.
 *
 * ## Why the folders are drawn under the title
 *
 * A workspace has a *Protokoll* in every folder. A list of identical words is
 * not a choice, so each row carries the path above it — the same thing the
 * breadcrumb says on the page itself.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import { closePageLinkMenu, insertPageLink, pageLinkMenuState } from '@sone/editor';
import type { EditorView } from 'prosemirror-view';

import { useChoiceList } from '../hooks/useChoiceList.ts';
import { useViewportChanges } from '../hooks/useViewportChanges.ts';
import { useT } from '../i18n/useT.tsx';
import { documentAddress } from '../routes/internalLinks.ts';
import { keepsEditorSelection, popupItem } from './popup.ts';

/** Space kept between the caret and the menu, and from the viewport edge. */
const GAP = 6;
const MARGIN = 8;
const MENU_WIDTH = 320;
const MAX_HEIGHT = 300;
/** Beyond this the list is a directory rather than a choice. */
const MAX_SHOWN = 8;

/**
 * Somewhere a link can point.
 *
 * A structural subset of `PageSummary` rather than that type itself: what this
 * needs is an id, a title, where it sits and whether it may be opened, and
 * naming only those keeps the menu testable without building a whole page row.
 */
export interface LinkablePage {
  id: string;
  parentPageId: string | null;
  title: string | null;
  kind?: string;
  /** Here only as a path to something below it — nothing to open (ADR-0026). */
  pathOnly?: boolean;
  archived?: boolean;
}

/** Case- and accent-insensitive, so a search is not a spelling test. */
const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * The folders above a page, as one line.
 *
 * Exported for its own test. Walks upwards through the list rather than a tree,
 * because the flat list is what the sidebar's hook already returns — and a
 * parent that is not in it simply ends the path: a page whose folder is outside
 * what this person may see is a page with a shorter trail, not a fault.
 *
 * The step count is bounded. Nothing should be able to write a cycle into the
 * tree, and a walk over data read from a server is exactly the place not to
 * assume that.
 */
export function pathOf(page: LinkablePage, pages: readonly LinkablePage[]): string {
  const names: string[] = [];
  let at = page.parentPageId;
  for (let step = 0; step < 12 && at !== null; step += 1) {
    const parent = pages.find((one) => one.id === at);
    if (!parent) break;
    if (parent.title) names.unshift(parent.title);
    at = parent.parentPageId;
  }
  return names.join(' / ');
}

/**
 * Which pages match what has been typed.
 *
 * Exported for its own test. Three things are refused before anything is
 * matched, and each is a row nobody could choose on purpose: a page with no
 * title, a page that is here only as a path, and a page in the archive.
 *
 * `here` is the page being written on. A link from a page to itself lands where
 * the reader already is — not wrong so much as empty, and it takes the place of
 * a page they could have meant.
 */
export function filterPages(
  query: string,
  pages: readonly LinkablePage[],
  here: string | null,
): LinkablePage[] {
  const linkable = pages.filter(
    (one) =>
      one.id !== here &&
      one.pathOnly !== true &&
      one.archived !== true &&
      (one.title ?? '').trim() !== '',
  );

  const needle = fold(query.trim());
  if (needle === '') return linkable.slice(0, MAX_SHOWN);

  return linkable
    .filter((one) => fold(one.title ?? '').includes(needle))
    .sort((a, b) => {
      const aStarts = fold(a.title ?? '').startsWith(needle);
      const bStarts = fold(b.title ?? '').startsWith(needle);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return (a.title ?? '').localeCompare(b.title ?? '');
    })
    .slice(0, MAX_SHOWN);
}

interface PageLinkMenuProps {
  view: EditorView;
  /** Bumped on every transaction, so this re-reads the plugin state. */
  revision: number;
  /** What may be linked to. Empty on a share link — see `App.tsx`. */
  pages: readonly LinkablePage[];
  /** The page being written on, which is not offered as a destination. */
  here: string | null;
}

export function PageLinkMenu({
  view,
  revision,
  pages,
  here,
}: PageLinkMenuProps): ReactElement | null {
  const { t } = useT();
  const menu = pageLinkMenuState(view.state);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const from = menu?.from ?? null;
  const query = menu?.query ?? '';
  const found = menu ? filterPages(query, pages, here) : [];

  const choose = (page: LinkablePage): void => {
    const title = (page.title ?? '').trim();
    if (title === '') return;
    insertPageLink(view, {
      // Token-free and relative, because this is written into the document
      // (ADR-0170, ADR-0173). `usePageLink()` is for a link being followed.
      href: documentAddress(page.id, null, title),
      label: title,
    });
  };

  /*
   * The highlight and the keys (ADR-0142), the same arrangement the mentions
   * use: `fieldProps` is not used, because the field is ProseMirror's
   * contenteditable and this component does not render it.
   */
  const choices = useChoiceList({
    count: found.length,
    onChoose: (at) => {
      const page = found[at];
      if (page) choose(page);
    },
    // Back to the top whenever the query changes: the old highlight is about a
    // list that no longer exists.
    resetOn: query,
  });

  // The editor's element as well as the window (ADR-0083).
  const viewportToken = useViewportChanges(from !== null, view.dom as HTMLElement);

  // After layout, so the measured height is the real one.
  useLayoutEffect(() => {
    if (from === null) {
      setPlacement(null);
      return undefined;
    }

    let coords: { top: number; bottom: number; left: number };
    try {
      coords = view.coordsAtPos(from);
    } catch {
      // A position can be stale for a frame after a document change. Retried
      // rather than abandoned: the menu opens on the transaction that typed the
      // second bracket, which is exactly such a frame.
      const retry = requestAnimationFrame(() => setRetryToken((n) => n + 1));
      return () => cancelAnimationFrame(retry);
    }

    const height = listRef.current?.offsetHeight ?? MAX_HEIGHT;
    const spaceBelow = window.innerHeight - coords.bottom;
    const above = spaceBelow < height + GAP + MARGIN && coords.top > height + GAP;

    setPlacement({
      top: above ? coords.top - height - GAP : coords.bottom + GAP,
      left: Math.min(
        Math.max(MARGIN, coords.left),
        Math.max(MARGIN, window.innerWidth - MENU_WIDTH - MARGIN),
      ),
    });
    return undefined;
  }, [view, from, revision, retryToken, viewportToken, found.length]);

  const handleKey = useRef(choices.handleKey);
  handleKey.current = choices.handleKey;
  useEffect(() => {
    if (!menu) return undefined;
    // Capture, on the editor's own element: that is what takes Enter before
    // ProseMirror splits the block.
    const onKeyDown = (event: KeyboardEvent): void => {
      handleKey.current(event);
    };
    const dom = view.dom;
    dom.addEventListener('keydown', onKeyDown, { capture: true });
    return () => dom.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [menu, view]);

  useEffect(() => {
    if (!menu) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (listRef.current?.contains(event.target as Node)) return;
      closePageLinkMenu(view);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menu, view]);

  if (!menu) return null;

  return (
    <div
      className="slash-menu page-link-menu"
      ref={(element) => {
        listRef.current = element;
        choices.listRef(element);
      }}
      style={placement ? { top: placement.top, left: placement.left } : { top: 120, left: 120 }}
      role="listbox"
      aria-label={t('pageLink.pick')}
      aria-activedescendant={choices.activeId}
      {...keepsEditorSelection}
    >
      {found.length === 0 ? (
        /*
         * Shown rather than closed silently: a menu that vanishes mid-typing
         * looks like a bug (ADR-0085). Two sentences, because "nothing to link
         * to" and "nothing matching that" are different answers — and on a
         * share link the first one is the honest one.
         */
        <p className="slash-empty">
          {pages.length === 0 ? t('pageLink.nothing') : t('pageLink.noMatch', { query })}
        </p>
      ) : (
        found.map((page, at) => {
          const trail = pathOf(page, pages);
          return (
            <button
              key={page.id}
              type="button"
              className="slash-item"
              {...choices.optionProps(at)}
              {...popupItem(() => choose(page))}
            >
              <span className="slash-text">
                <span className="slash-title">{page.title}</span>
                {trail !== '' && <span className="slash-hint">{trail}</span>}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
