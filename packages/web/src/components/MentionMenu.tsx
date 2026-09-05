/**
 * SONE web — choosing who an `@` means (ADR-0085).
 *
 * The plugin holds a position and a query and nothing else: `@sone/editor` has
 * no business knowing how this application asks a server who is in a workspace.
 * So the list, the filtering and the keys live here, and the plugin is told
 * only "this person" when somebody picks one.
 *
 * The people are handed in rather than fetched, from the same list the assignee
 * picker uses. One request per page rather than one per `@`, and one answer to
 * "who is in this workspace" rather than two.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import { closeMentionMenu, insertMention, mentionMenuState } from '@sone/editor';
import type { EditorView } from 'prosemirror-view';

import { useT } from '../i18n/useT.tsx';
import { useViewportChanges } from '../hooks/useViewportChanges.ts';
import { keepsEditorSelection } from './popup.ts';

/** Space kept between the caret and the menu, and from the viewport edge. */
const GAP = 6;
const MARGIN = 8;
const MENU_WIDTH = 260;
const MAX_HEIGHT = 280;
/** Beyond this the list is a directory rather than a choice. */
const MAX_SHOWN = 8;

export interface MentionCandidate {
  userId: string;
  displayName: string;
}

/**
 * Who matches what has been typed.
 *
 * Exported for its own test. Matching is on the display name, case- and
 * accent-insensitively: somebody typing "muller" is looking for Müller, and
 * making them find the umlaut key first would be a worse search than none.
 */
export function filterPeople(
  query: string,
  people: readonly MentionCandidate[],
): MentionCandidate[] {
  const fold = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  const needle = fold(query.trim());
  if (needle === '') return [...people].slice(0, MAX_SHOWN);

  const matches = people.filter((one) => fold(one.displayName).includes(needle));
  /*
   * Somebody whose name *begins* with what was typed comes first.
   *
   * With a plain `includes`, typing "an" puts "Susanne" above "Anna" whenever
   * Susanne happens to sort earlier — and the person typing has already told
   * you what they are looking for.
   */
  return matches
    .sort((a, b) => {
      const aStarts = fold(a.displayName).startsWith(needle);
      const bStarts = fold(b.displayName).startsWith(needle);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    })
    .slice(0, MAX_SHOWN);
}

interface MentionMenuProps {
  view: EditorView;
  /** Bumped on every transaction, so this re-reads the plugin state. */
  revision: number;
  people: readonly MentionCandidate[];
}

export function MentionMenu({ view, revision, people }: MentionMenuProps): ReactElement | null {
  const { t } = useT();
  const menu = mentionMenuState(view.state);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const from = menu?.from ?? null;
  const query = menu?.query ?? '';
  const found = menu ? filterPeople(query, people) : [];

  // The editor's element as well as the window (ADR-0083).
  const viewportToken = useViewportChanges(from !== null, view.dom as HTMLElement);

  // Back to the top whenever the query changes: the old highlight is about a
  // list that no longer exists.
  useEffect(() => {
    setIndex(0);
  }, [query]);

  // After layout, so the measured height is the real one.
  useLayoutEffect(() => {
    if (from === null) {
      setPlacement(null);
      return;
    }

    let coords: { top: number; bottom: number; left: number };
    try {
      coords = view.coordsAtPos(from);
    } catch {
      // A position can be stale for a frame after a document change. Retried
      // rather than abandoned — the same failure left the slash menu invisible
      // for good once.
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
  }, [view, from, revision, retryToken, viewportToken, found.length]);

  /*
   * The arrows and Enter, here rather than in the plugin.
   *
   * The plugin does not know how many people are in the list or which one is
   * highlighted — that is the whole point of it holding a query and not a list.
   * Capture phase on the editor's own element, so these are seen before
   * ProseMirror turns Enter into a block split.
   */
  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (found.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setIndex((n) => (n + 1) % found.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setIndex((n) => (n - 1 + found.length) % found.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        const person = found[index];
        if (!person) return;
        event.preventDefault();
        insertMention(view, { userId: person.userId, label: person.displayName });
      }
    };
    const dom = view.dom;
    dom.addEventListener('keydown', onKeyDown, { capture: true });
    return () => dom.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [menu, found, index, view]);

  // Clicking elsewhere closes it, on pointerdown so the menu is gone before the
  // click lands somewhere unexpected.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (listRef.current?.contains(event.target as Node)) return;
      closeMentionMenu(view);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menu, view]);

  if (!menu) return null;

  return (
    <div
      className="slash-menu mention-menu"
      ref={listRef}
      style={placement ? { top: placement.top, left: placement.left } : { top: -9999, left: -9999 }}
      role="listbox"
      aria-label={t('mention.pick')}
      {...keepsEditorSelection}
    >
      {found.length === 0 ? (
        /*
         * Shown rather than closing silently. A menu that vanishes mid-typing
         * looks like a bug — and the honest answer here is often "nobody",
         * because a workspace with one person in it has nobody to mention.
         */
        <p className="slash-empty">
          {people.length === 0 ? t('mention.nobody') : t('mention.noMatch', { query })}
        </p>
      ) : (
        found.map((person, at) => (
          <button
            key={person.userId}
            type="button"
            className="slash-item"
            data-selected={at === index ? 'true' : undefined}
            onPointerEnter={() => setIndex(at)}
            onClick={() =>
              insertMention(view, { userId: person.userId, label: person.displayName })
            }
          >
            <span className="slash-title">{person.displayName}</span>
          </button>
        ))
      )}
    </div>
  );
}
