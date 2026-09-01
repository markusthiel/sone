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

import { useT } from '../i18n/useT.tsx';
import { useMemo, useState, type ReactElement } from 'react';

import type { PageNode } from '../api/client.ts';
import { FolderIcon } from './icons.tsx';
import { moveRefusal } from './moveRules.ts';

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
 *
 * The reasons come from moveRules, shared with dragging. Two copies of these
 * rules would drift, and the failure would be silent: the interface would offer
 * a destination the server refuses, or refuse one it would have accepted.
 */
function destinations(tree: PageNode[], entry: PageNode): Destination[] {
  const out: Destination[] = [];

  const refusalFor = (target: string | null): string | undefined =>
    moveRefusal(tree, entry, target) ?? undefined;

  const rootRefusal = refusalFor(null);
  out.push({
    id: null,
    label: 'Workspace root',
    path: '',
    depth: 0,
    ...(rootRefusal ? { disabled: rootRefusal } : {}),
  });

  const walk = (nodes: PageNode[], trail: string[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;

      const refusal = refusalFor(node.id);
      out.push({
        id: node.id,
        label: node.title || 'Untitled folder',
        path: trail.join(' / '),
        depth: trail.length,
        ...(refusal ? { disabled: refusal } : {}),
      });

      walk(node.children, [...trail, node.title || 'Untitled folder']);
    }
  };

  walk(tree, []);
  return out;
}

export function MoveDialog({
  entry,
  tree,
  onMove,
  onCancel,
}: MoveDialogProps): ReactElement {
  const { t } = useT();
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
      // Click, not pointerdown: on touch, pointerdown fires as the finger
      // lands, so a tap that began on the backdrop and was meant to become a
      // scroll closed the dialog instead. A click only follows a tap that
      // stayed put.
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('move.title')}>
        <h2 className="dialog-title">
          Move “{entry.title || (entry.kind === 'folder' ? 'Untitled folder' : 'Untitled')}”
        </h2>

        <input
          className="dialog-filter"
          value={filter}
          autoFocus
          placeholder={t('move.find')}
          aria-label={t('move.find')}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />

        <div className="dialog-list">
          {shown.length === 0 && <p className="panel-empty">{t('move.noMatch')}</p>}
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
            {t('action.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

export { destinations };
