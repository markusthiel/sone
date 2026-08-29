/**
 * SONE web — the per-entry menu.
 *
 * One unobtrusive ⋯ per row: rename, new inside (folders only), delete.
 *
 * The button is always in the DOM and always occupies its space, but is
 * visually quiet until the row is hovered, focused, or the menu is open. That is
 * a narrower rule than it sounds: a control revealed *by* hover does not exist
 * on a phone (ADR-0016), so the opacity is only ever a de-emphasis of something
 * already present and already hittable. On touch there is no hover, so it stays
 * visible.
 *
 * Renaming happens inline rather than in a dialog. A dialog for a single text
 * field is a heavier interaction than the change deserves, and the title is
 * right there to edit.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { THEME_COLORS, isCustomColor, type EntryIcon } from '@sone/core';

import { ICON_NAMES } from './EntryIconView.tsx';

import { api, type PageNode } from '../api/client.ts';
import { EntryIconView } from './EntryIconView.tsx';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderPlusIcon,
  MoreIcon,
  MoveIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  StarIcon,
  TrashIcon,
} from './icons.tsx';

/**
 * Choosing an icon and the colours around it.
 *
 * Applied straight away rather than behind a Save. The change is small,
 * reversible and visible the moment it lands — a confirmation step would be
 * more ceremony than the decision deserves, and it is the tree redrawing that
 * tells somebody it worked.
 *
 * A failure is silent for the same reason a theme's is: this is decoration, and
 * an error banner about a folder colour would be louder than what it reports.
 */
function EntryAppearance({
  node,
  onChanged,
}: {
  node: PageNode;
  onChanged: () => void;
}): ReactElement {
  const icon = node.icon;
  const current = icon?.kind === 'icon' ? icon.value : null;
  const [query, setQuery] = useState('');

  // Matched on the words in a name, so "arrow" finds `arrow-up` and "up" finds
  // it too. Bounded, because rendering two thousand icons at once is slow
  // enough to feel like the menu is broken.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = needle === ''
      ? ICON_NAMES
      : ICON_NAMES.filter((name) => name.includes(needle));
    return all.slice(0, 300);
  }, [query]);

  const apply = (changes: { icon?: EntryIcon | null; titleColor?: string | null }): void => {
    void api
      .setEntryIcon(node.id, changes)
      .then(() => onChanged())
      .catch(() => {
        // Decoration. The tree simply does not change.
      });
  };

  const chooseIcon = (name: string | null): void => {
    if (!name) {
      apply({ icon: null });
      return;
    }
    apply({
      icon: {
        kind: 'icon',
        value: name as EntryIcon['value'],
        // The colour is kept when the icon changes: somebody who picked blue
        // wants blue, not blue until they change their mind about the shape.
        ...(icon?.color ? { color: icon.color as NonNullable<EntryIcon['color']> } : {}),
      },
    });
  };

  return (
    <div className="entry-appearance">
      <p className="entry-menu-label">Icon</p>

      {/* A filter rather than a shorter list.
        *
        * The set was fifty hand-picked names, kept short because a long grid is
        * a wall to scroll past. With a filter the length stops mattering and
        * the choosing gets better: somebody types "boat" instead of hunting for
        * it among two hundred squares. */}
      <input
        className="entry-icon-search"
        type="search"
        value={query}
        placeholder="Search icons"
        aria-label="Search icons"
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="entry-icon-grid" role="group" aria-label="Icon">
        <button
          type="button"
          className={current === null ? 'entry-icon current' : 'entry-icon'}
          aria-pressed={current === null}
          aria-label="Default icon"
          onClick={() => chooseIcon(null)}
        >
          <EntryIconView icon={null} kind={node.kind === 'folder' ? 'folder' : 'page'} />
        </button>

        {matches.map((name) => (
          <button
            key={name}
            type="button"
            className={current === name ? 'entry-icon current' : 'entry-icon'}
            aria-pressed={current === name}
            aria-label={name.replace(/-/g, ' ')}
            title={name.replace(/-/g, ' ')}
            onClick={() => chooseIcon(name)}
          >
            <EntryIconView icon={{ kind: 'icon', value: name }} kind="page" />
          </button>
        ))}
      </div>

      <p className="entry-menu-label">Icon colour</p>
      <ColourRow
        current={icon?.color ?? null}
        label="Icon colour"
        onChoose={(color) => {
          if (!current) return;
          apply({
            icon: {
              kind: 'icon',
              value: current as EntryIcon['value'],
              ...(color ? { color: color as NonNullable<EntryIcon['color']> } : {}),
            },
          });
        }}
        disabled={!current}
      />

      <p className="entry-menu-label">Name colour</p>
      <ColourRow
        current={icon?.titleColor ?? null}
        label="Name colour"
        onChoose={(color) => apply({ titleColor: color })}
      />
    </div>
  );
}

/** The palette, with "no colour" first and drawn as a state rather than a shade. */
function ColourRow({
  current,
  label,
  onChoose,
  disabled = false,
}: {
  current: string | null;
  label: string;
  onChoose: (color: string | null) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <div className="block-menu-swatches" role="group" aria-label={label}>
      <button
        type="button"
        className={current === null ? 'block-menu-swatch none current' : 'block-menu-swatch none'}
        aria-pressed={current === null}
        aria-label={`${label}: as designed`}
        disabled={disabled}
        onClick={() => onChoose(null)}
      />
      {THEME_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={
            current === color
              ? `block-menu-swatch tag-${color} current`
              : `block-menu-swatch tag-${color}`
          }
          aria-pressed={current === color}
          aria-label={`${label}: ${color}`}
          title={color}
          disabled={disabled}
          onClick={() => onChoose(color)}
        />
      ))}

      {/* A colour of one's own, beside the eight rather than instead of them.
        *
        * The names are what make a workspace restylable — change what blue
        * means and every blue thing follows — so this is the escape for the
        * case a palette cannot cover, not the ordinary way to pick a colour
        * (ADR-0023).
        *
        * A native colour input: every platform has one people already know, and
        * building a wheel would be a worse version of something the browser
        * ships. */}
      <input
        type="color"
        className={
          isCustomColor(current)
            ? 'block-menu-swatch custom current'
            : 'block-menu-swatch custom'
        }
        value={isCustomColor(current) ? current : '#888888'}
        aria-label={`${label}: a colour of your own`}
        title="A colour of your own"
        disabled={disabled}
        onChange={(event) => onChoose(event.target.value)}
      />
    </div>
  );
}

interface EntryMenuProps {
  node: PageNode;
  /** Reloads the tree after an icon or colour changed. */
  onChanged: () => void;
  onRename: (pageId: string, title: string) => void;
  onCreate: (parentPageId: string, kind: 'page' | 'folder') => void;
  onDelete: (pageId: string, descendants: number) => void;
  onStartRename: (pageId: string) => void;
  onStartMove: (pageId: string) => void;
  onStartShare: (pageId: string) => void;
  onReorder: (pageId: string, direction: 'up' | 'down') => void;
  /** False at the ends of the list, so the entries are visibly unavailable. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  isFavourite: boolean;
  onToggleFavourite: (pageId: string, favourite: boolean) => void;
}

/** Descendant count, for telling someone what a delete will take with it. */
export function countDescendants(node: PageNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

export function EntryMenu({
  node,
  onChanged,
  onCreate,
  onDelete,
  onStartRename,
  onStartMove,
  onStartShare,
  onReorder,
  canMoveUp,
  canMoveDown,
  isFavourite,
  onToggleFavourite,
}: EntryMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isFolder = node.kind === 'folder';
  const descendants = countDescendants(node);
  const title = node.title || (isFolder ? 'Untitled folder' : 'Untitled');

  return (
    <div className="entry-menu-wrap">
      <button
        ref={buttonRef}
        className="entry-more"
        type="button"
        aria-label={`Actions for ${title}`}
        aria-expanded={open}
        onClick={(event) => {
          // Stops the click reaching the row, which would navigate.
          event.preventDefault();
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
      >
        <MoreIcon />
      </button>

      {open && (
        <div className="entry-menu" ref={panelRef} role="menu">
          <button
            className="entry-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onStartRename(node.id);
            }}
          >
            <PencilIcon /> Rename
          </button>

          {/* Icon and the two colours.
            *
            * In the menu the entry already has rather than a dialog: choosing
            * an icon is a small decision, and making somebody open a window for
            * it turns a moment into a task. The menu stays open while choosing,
            * because people try several before settling. */}
          <EntryAppearance node={node} onChanged={onChanged} />

          <button
            className="entry-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onToggleFavourite(node.id, !isFavourite);
            }}
          >
            <StarIcon data-filled={isFavourite ? 'true' : 'false'} />{' '}
            {isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          </button>

          {/* Reordering without dragging.
           *
           * Dragging is a pointer-device feature — iOS never fires those
           * events — so on a tablet these two entries are the only way to
           * reorder at all. Shipping the drag without them left the most
           * common device with no way to do it, which is not a degradation but
           * a missing feature.
           *
           * They also work with a keyboard, which dragging does not. */}
          <button
            className="entry-menu-item"
            type="button"
            role="menuitem"
            disabled={!canMoveUp}
            onClick={() => {
              setOpen(false);
              onReorder(node.id, 'up');
            }}
          >
            <ArrowUpIcon /> Move up
          </button>

          <button
            className="entry-menu-item"
            type="button"
            role="menuitem"
            disabled={!canMoveDown}
            onClick={() => {
              setOpen(false);
              onReorder(node.id, 'down');
            }}
          >
            <ArrowDownIcon /> Move down
          </button>

          <button
            className="entry-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onStartShare(node.id);
            }}
          >
            <ShareIcon /> Share…
          </button>

          <button
            className="entry-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onStartMove(node.id);
            }}
          >
            <MoveIcon /> Move to…
          </button>

          {isFolder && (
            <>
              <button
                className="entry-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onCreate(node.id, 'page');
                }}
              >
                <PlusIcon /> New page
              </button>
              <button
                className="entry-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onCreate(node.id, 'folder');
                }}
              >
                <FolderPlusIcon /> New folder
              </button>
            </>
          )}

          <button
            className="entry-menu-item destructive"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete(node.id, descendants);
            }}
          >
            <TrashIcon />{' '}
            {/* The count is stated here rather than only in a confirmation,
                because it changes whether someone opens the confirmation at
                all. */}
            {descendants > 0 ? `Delete (${descendants + 1} items)` : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}
