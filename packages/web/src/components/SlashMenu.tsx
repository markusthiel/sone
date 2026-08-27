/**
 * SONE web — the slash menu's interface.
 *
 * State, filtering and keyboard handling live in `@sone/editor`. This renders
 * them. The split matters: the editor package must work without React
 * (ADR-0016), and the selected index has to live in one place or the keyboard
 * and the list disagree about what is highlighted.
 *
 * Positioning follows the caret via `coordsAtPos` rather than tracking the DOM,
 * because the caret is what the menu belongs to and ProseMirror already knows
 * where it is. Recomputed on every render, since anything cached goes stale the
 * moment the document reflows.
 */

import {
  closeSlashMenu,
  insertImageUpload,
  runSlashItem,
  setSlashIndex,
  slashMenuState,
  type ImageUploader,
  type SlashItem,
} from '@sone/editor';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

/** Space kept between the caret and the menu, and from the viewport edge. */
const GAP = 6;
const MARGIN = 8;
const MENU_WIDTH = 288;
const MAX_HEIGHT = 320;

/**
 * Where to draw the menu before its position is known.
 *
 * Visible, deliberately. It used to render with `visibility: hidden` until
 * positioning succeeded, which meant one failure hid it forever. A menu in
 * roughly the wrong place is recoverable — the person sees it and can choose
 * from it — and it corrects itself within a frame. A menu that is never there
 * is not recoverable.
 */
const FALLBACK_POSITION = { top: 120, left: 120 } as const;

interface SlashMenuProps {
  view: EditorView;
  /** Bumped by the editor on every transaction, so this re-reads plugin state. */
  revision: number;
  /**
   * Used by the Image item, which cannot be a plain command: opening a file
   * picker needs a real user gesture and a DOM element, neither of which a
   * ProseMirror command has.
   */
  uploadImage?: ImageUploader;
}

export function SlashMenu({
  view,
  revision,
  uploadImage,
}: SlashMenuProps): ReactElement | null {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menu = slashMenuState(view.state);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);
  // Bumped to re-run positioning after a failure. Without it a single stale
  // position left the menu permanently invisible.
  const [retryToken, setRetryToken] = useState(0);

  const from = menu?.from ?? null;

  // Position after layout, so the measured height is the real one. useEffect
  // would paint at the wrong place first and visibly jump.
  useLayoutEffect(() => {
    if (from === null) {
      setPlacement(null);
      return;
    }

    let coords: { top: number; bottom: number; left: number };
    try {
      coords = view.coordsAtPos(from);
    } catch {
      // A position can be stale for a frame after a document change.
      //
      // Retried on the next frame rather than abandoned. Returning here left
      // `placement` null, and the menu renders hidden while it is null — so a
      // single failure meant a menu that never appeared at all, with the slash
      // sitting in the text and nothing to choose from. That is what "the + puts
      // in a slash and nothing else happens" was.
      const retry = requestAnimationFrame(() => setRetryToken((n) => n + 1));
      return () => cancelAnimationFrame(retry);
    }

    const height = listRef.current?.offsetHeight ?? MAX_HEIGHT;
    const spaceBelow = window.innerHeight - coords.bottom;
    // Flip above the caret when there is not enough room below — on a phone
    // with the keyboard up, there rarely is.
    const above = spaceBelow < height + GAP + MARGIN && coords.top > height + GAP;

    const left = Math.min(
      Math.max(MARGIN, coords.left),
      Math.max(MARGIN, window.innerWidth - MENU_WIDTH - MARGIN),
    );

    setPlacement({
      top: above ? coords.top - height - GAP : coords.bottom + GAP,
      left,
      above,
    });
    // `revision` is in the dependency list because the caret moves without
    // `from` changing — typing inside the query, for instance.
  }, [view, from, revision, retryToken, menu?.items.length]);

  // Keep the selected item in view when the keyboard moves through a list
  // longer than the menu.
  useEffect(() => {
    if (!menu) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [menu?.index, menu]);

  // Clicking elsewhere closes it. Pointerdown rather than click, so the menu is
  // gone before the click lands somewhere unexpected.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (listRef.current?.contains(event.target as Node)) return;
      closeSlashMenu(view);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menu, view]);

  if (!menu) return null;

  if (menu.items.length === 0) {
    // Shown rather than closing silently: a menu that vanishes mid-typing looks
    // like a bug, and this tells the person their query matched nothing while
    // leaving Escape and further typing working.
    return (
      <div
        className="slash-menu"
        ref={listRef}
        style={placement ? { top: placement.top, left: placement.left } : FALLBACK_POSITION}
        role="listbox"
        aria-label="Insert block"
      >
        <p className="slash-empty">No blocks match “{menu.query}”</p>
      </div>
    );
  }

  /**
   * Choose an item.
   *
   * Image is handled here rather than by its command: the slash text has to be
   * removed before the picker opens, or it stays behind while a modal file
   * dialog is up and the person cannot see what happened.
   */
  const choose = (item: SlashItem): void => {
    if (item.id === 'image') {
      closeSlashMenu(view);
      const state = slashMenuState(view.state);
      if (state) {
        view.dispatch(view.state.tr.delete(state.from, view.state.selection.head));
      }
      fileInputRef.current?.click();
      return;
    }
    runSlashItem(view, item);
  };

  const groups = groupItems(menu.items);
  let flatIndex = -1;

  return (
    <div
      className="slash-menu"
      ref={listRef}
      style={placement ? { top: placement.top, left: placement.left } : FALLBACK_POSITION}
      role="listbox"
      aria-label="Insert block"
      aria-activedescendant={`slash-item-${menu.items[menu.index]?.id ?? ''}`}
    >
      {/* Outside the list so clicking it is not treated as choosing an item.
          Hidden rather than absent: a file input has to exist in the DOM before
          click() will open a picker. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (!uploadImage) return;
          for (const file of files) insertImageUpload(view, file, uploadImage);
          view.focus();
        }}
      />
      {groups.map(([group, items]) => (
        <div className="slash-group" key={group}>
          <div className="slash-group-label">{GROUP_LABELS[group]}</div>
          {items.map((item) => {
            flatIndex += 1;
            const index = flatIndex;
            const selected = index === menu.index;
            return (
              <button
                key={item.id}
                id={`slash-item-${item.id}`}
                type="button"
                className="slash-item"
                data-selected={selected ? 'true' : 'false'}
                role="option"
                aria-selected={selected}
                // Pointerdown, not click: the editor loses focus on mousedown
                // otherwise, and the command then runs against a lost selection.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
                onPointerEnter={() => setSlashIndex(view, index)}
              >
                <span className="slash-title">{item.title}</span>
                <span className="slash-hint">{item.hint}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const GROUP_LABELS: Record<SlashItem['group'], string> = {
  text: 'Text',
  lists: 'Lists',
  blocks: 'Blocks',
};

/**
 * Group while preserving the filtered order.
 *
 * A group only appears once its first item does, so the headings follow the
 * ranking rather than imposing a fixed order on it — otherwise a search that
 * ranks a list item first would still show Text at the top.
 */
function groupItems(items: SlashItem[]): Array<[SlashItem['group'], SlashItem[]]> {
  const groups: Array<[SlashItem['group'], SlashItem[]]> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last[0] === item.group) last[1].push(item);
    else groups.push([item.group, [item]]);
  }
  return groups;
}
