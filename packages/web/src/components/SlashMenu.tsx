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
  CalloutIcon,
  CheckSquareIcon,
  CodeIcon,
  DividerIcon,
  HashIcon,
  ImageIcon,
  ListIcon,
  LockIcon,
  OrderedListIcon,
  PaperclipIcon,
  QuoteIcon,
  TableIcon,
  TextIcon,
  ToggleIcon,
  VideoIcon,
} from './icons.tsx';
import { BLOCK_MARKS } from './blockMarks.ts';
import { useT } from '../i18n/useT.tsx';
import { keepsEditorSelection, popupItem } from './popup.ts';
import {
  closeSlashMenu,
  insertImageUpload,
  runSlashItem,
  setSlashIndex,
  slashMenuPluginKey,
  slashMenuState,
  type SlashItem,
} from '@sone/editor';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import { useViewportChanges } from '../hooks/useViewportChanges.ts';

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
  /**
   * Opens a file picker.
   *
   * Provided by the surface rather than done here: this component unmounts as
   * soon as the menu closes, and a detached input never delivers its change
   * event.
   */
  onPickImage: () => void;
  /** Opens the document picker. Separate from the image one; see EditorSurface. */
  onPickFile: () => void;
  /** Creates a collection and puts a block for it where the caret is. */
  onInsertCollection: () => void;
  onInsertProtectedSection: () => void;
  /** Open the dialog that asks where the video comes from. */
  onInsertVideo: () => void;
}

export function SlashMenu({
  view,
  revision,
  onPickImage,
  onPickFile,
  onInsertCollection,
  onInsertProtectedSection,
  onInsertVideo,
}: SlashMenuProps): ReactElement | null {
  const { t } = useT();
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

  // Re-place when the page moves: a scroll produces no transaction, so nothing
  // else would tell this component that the caret is no longer where it was.
  // The editor's element too — see the note in useViewportChanges (ADR-0083).
  const viewportToken = useViewportChanges(from !== null, view.dom as HTMLElement);

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
  }, [view, from, revision, retryToken, viewportToken, menu?.items.length]);

  // Keep the selected item in view when the keyboard moves through a list
  // longer than the menu.
  useEffect(() => {
    if (!menu) return;
    // Guarded, because a throw inside a React effect unmounts the whole tree —
    // that is how a blank page happened once already, and scrolling an item into
    // view is not worth that risk.
    const selected = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    selected?.scrollIntoView?.({ block: 'nearest' });
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
        aria-label={t('slash.insert')}
        {...keepsEditorSelection}
      >
        <p className="slash-empty">{t('slash.noMatch', { query: menu.query })}</p>
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
    // `external` items cannot be a transaction — a file picker needs a user
    // gesture and a DOM element. runSlashItem reports false for them rather
    // than guessing, and the query is removed here before the modal dialog
    // opens, or it sits in the text while the dialog is up.
    if (item.action.kind === 'external') {
      const state = slashMenuState(view.state);
      const tr = view.state.tr;
      if (state) tr.delete(state.from, view.state.selection.head);
      tr.setMeta(slashMenuPluginKey, { close: true });
      view.dispatch(tr);
      // Which external action, decided by the item rather than assumed.
      //
      // There was one for a long time and the branch simply called the picker.
      // A second — inserting a collection — would have opened a file dialog.
      if (item.id === 'collection') {
        onInsertCollection();
        return;
      }
      if (item.id === 'protected') {
        onInsertProtectedSection();
        return;
      }
      if (item.id === 'file') {
        onPickFile();
        return;
      }
      if (item.id === 'video') {
        // A dialog rather than a picker: two of the three sources are addresses,
        // and a file picker cannot ask for one (ADR-0037).
        onInsertVideo();
        return;
      }

      // Asking the surface to open the picker, not opening one from here.
      //
      // The input used to live in this component, which unmounts the moment the
      // menu closes — so by the time somebody had chosen a photo, the element
      // that would have heard about it was gone from the document. The picker
      // opened, the person picked, and nothing happened.
      onPickImage();
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
      aria-label={t('slash.insert')}
      aria-activedescendant={`slash-item-${menu.items[menu.index]?.id ?? ''}`}
      {...keepsEditorSelection}
    >
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
                // Click, not pointerdown. Acting on pointerdown fired the item
                // the moment a finger landed and cancelled the scroll gesture
                // with it; the container's mousedown handler is what keeps the
                // editor's selection. See popup.ts.
                {...popupItem(() => choose(item))}
                // On move, not only on enter.
                //
                // `pointerenter` fires once, when the pointer crosses into the
                // row. Two ordinary things then leave the highlight somewhere
                // else with the mouse sitting on this one, and no event to fix
                // it: pressing the arrow keys moves the selection away, and
                // scrolling the list slides a different row under a stationary
                // pointer. Both look exactly like "the mouse is not over the
                // entry" — which is what was reported.
                //
                // Guarded on `selected`, so an idle wobble does not dispatch a
                // transaction per pixel.
                onPointerMove={() => {
                  if (!selected) setSlashIndex(view, index);
                }}
              >
                <Mark item={item} />
                <span className="slash-text">
                  <span className="slash-title">{item.title}</span>
                  <span className="slash-hint">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The mark beside an item's name.
 *
 * Keyed on the item's id here rather than carried by the item itself: which
 * icon a block gets is a drawing decision, and `@sone/editor` has no business
 * importing a component to hold one. The headings share a mark and are told
 * apart by their names, which are "Heading 1", "Heading 2", "Heading 3" — a
 * different symbol for each level would be three symbols meaning the same
 * thing at different sizes.
 *
 * An item with no entry here draws nothing and keeps its place, so adding a
 * block cannot break the list — it just arrives unmarked.
 */
// The marks live in blockMarks.ts, shared with the gutter's "Turn into" list:
// one subject, one symbol.
const MARKS = BLOCK_MARKS;

function Mark({ item }: { item: SlashItem }): ReactElement {
  const { t } = useT();
  const Icon = MARKS[item.id];
  // The box is kept whether or not there is an icon, so the names stay in one
  // column: a list where some rows are indented and others are not is harder to
  // scan than a list with no icons at all.
  return <span className="slash-mark">{Icon ? <Icon /> : null}</span>;
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
