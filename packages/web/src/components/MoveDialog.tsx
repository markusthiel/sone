/**
 * SONE web — choosing where to move an entry.
 *
 * A picker rather than drag and drop, and deliberately so. Dragging a row onto
 * another row needs a drop indicator to be comprehensible, competes with
 * scrolling on a touch screen, and gives no way to reach a folder that is
 * scrolled out of view. A list you can filter works with a thumb, works with a
 * keyboard, and can say *why* a destination is unavailable.
 *
 * Dragging can be added on top later; the operation underneath is the same.
 */

import { useMemo, useState, type ReactElement } from 'react';

import type { PageNode } from '../api/client.ts';
import { FolderIcon } from './icons.tsx';

interface MoveDialogProps {
  /** The entry being moved. */
  entry: PageNode;
  tree: PageNode[];
  onMove: (parentPageId: string | null) => void;
  onCancel: () => void;
}

interface Destination {
  id: string | null;
  label: string;
  /** Ancestor names, so two folders called "Notes" can be told apart. */
  path: string;
  depth: number;
  disabled?: string;
}

/**
 * Every folder, with the ones that cannot receive this entry marked.
 *
 * Marked rather than hidden. A folder missing from the list looks like a bug or
 * like a permissions problem; a folder listed with "cannot contain itself" says
 * what is going on.
 */
function destinations(tree: PageNode[], entry: PageNode): Destination[] {
  const out: Destination[] = [];

  // The workspace root takes folders only (ADR-0019).
  out.push({
    id: null,
    label: 'Workspace root',
    path: '',
    depth: 0,
    ...(entry.kind === 'folder' ? {} : { disabled: 'Only folders can sit at the root' }),
  });

  const walk = (nodes: PageNode[], trail: string[], insideEntry: boolean): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;

      const isEntry = node.id === entry.id;
      // Everything below the entry is its own subtree: moving into it would
      // detach the whole branch from the tree.
      const forbidden = isEntry || insideEntry;

      out.push({
        id: node.id,
        label: node.title || 'Untitled folder',
        path: trail.join(' / '),
        depth: trail.length,
        ...(isEntry
          ? { disabled: 'A folder cannot contain itself' }
          : insideEntry
            ? { disabled: 'This is inside the folder being moved' }
            : node.id === entry.parentPageId
              ? { disabled: 'Already here' }
              : {}),
      });

      walk(node.children, [...trail, node.title || 'Untitled folder'], forbidden);
    }
  };

  walk(tree, [], false);
  return out;
}

export function MoveDialog({
  entry,
  tree,
  onMove,
  onCancel,
}: MoveDialogProps): ReactElement {
  const [filter, setFilter] = useState('');
  const all = useMemo(() => destinations(tree, entry), [tree, entry]);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? all.filter(
        (destination) =>
          destination.label.toLowerCase().includes(needle) ||
          destination.path.toLowerCase().includes(needle),
      )
    : all;

  return (
    <div
      className="dialog-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Move to">
        <h2 className="dialog-title">
          Move “{entry.title || (entry.kind === 'folder' ? 'Untitled folder' : 'Untitled')}”
        </h2>

        <input
          className="dialog-filter"
          value={filter}
          autoFocus
          placeholder="Find a folder"
          aria-label="Find a folder"
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />

        <div className="dialog-list">
          {shown.length === 0 && <p className="panel-empty">No folder matches.</p>}
          {shown.map((destination) => (
            <button
              key={destination.id ?? 'root'}
              type="button"
              className="dialog-item"
              disabled={destination.disabled !== undefined}
              title={destination.disabled}
              style={{ paddingInlineStart: `${8 + destination.depth * 14}px` }}
              onClick={() => onMove(destination.id)}
            >
              <FolderIcon />
              <span className="dialog-item-label">{destination.label}</span>
              {destination.path && (
                <span className="dialog-item-path">{destination.path}</span>
              )}
              {destination.disabled && (
                <span className="dialog-item-why">{destination.disabled}</span>
              )}
            </button>
          ))}
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export { destinations };
