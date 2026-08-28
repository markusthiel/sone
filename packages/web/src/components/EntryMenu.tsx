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

import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { PageNode } from '../api/client.ts';
import {
  FolderPlusIcon,
  MoreIcon,
  MoveIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  StarIcon,
  TrashIcon,
} from './icons.tsx';

interface EntryMenuProps {
  node: PageNode;
  onRename: (pageId: string, title: string) => void;
  onCreate: (parentPageId: string, kind: 'page' | 'folder') => void;
  onDelete: (pageId: string, descendants: number) => void;
  onStartRename: (pageId: string) => void;
  onStartMove: (pageId: string) => void;
  onStartShare: (pageId: string) => void;
  isFavourite: boolean;
  onToggleFavourite: (pageId: string, favourite: boolean) => void;
}

/** Descendant count, for telling someone what a delete will take with it. */
export function countDescendants(node: PageNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

export function EntryMenu({
  node,
  onCreate,
  onDelete,
  onStartRename,
  onStartMove,
  onStartShare,
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
