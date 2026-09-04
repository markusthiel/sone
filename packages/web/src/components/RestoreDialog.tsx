/**
 * SONE web — where a deleted entry should come back to (ADR-0071).
 *
 * Only needed when the answer is not obvious: an entry whose folder was deleted
 * too has nowhere to go, and the server refuses rather than putting it
 * somewhere plausible — silently moving a page is how somebody loses it a
 * second time. This is how they say where.
 *
 * Its own dialog rather than the move dialog, small as it is. That one asks
 * `moveRules` which destinations are refused, and every one of those rules is
 * about an entry that is *in* the tree — its own subtree, its own parent. An
 * archived entry is not in the tree and its descendants are archived with it,
 * so they cannot appear in this list at all: the rules would be a question with
 * no answer rather than a shared guarantee.
 *
 * The root is offered only for a folder, which mirrors the schema: a page at a
 * workspace's root is not a shape this allows (ADR-0019), and the server
 * refuses one.
 */

import { useMemo, useState, type ReactElement } from 'react';

import type { PageNode, TrashEntry } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { FolderIcon } from './icons.tsx';

interface Destination {
  id: string | null;
  label: string;
  /** Ancestor names, so two folders called "Notizen" can be told apart. */
  path: string;
  depth: number;
}

/** Every living folder, in the order the tree draws them. */
function folders(tree: PageNode[], untitled: string): Destination[] {
  const out: Destination[] = [];
  const walk = (nodes: PageNode[], trail: string[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      const name = node.title || untitled;
      out.push({ id: node.id, label: name, path: trail.join(' / '), depth: trail.length });
      walk(node.children, [...trail, name]);
    }
  };
  walk(tree, []);
  return out;
}

export function RestoreDialog({
  entry,
  tree,
  onRestore,
  onCancel,
}: {
  entry: TrashEntry;
  tree: PageNode[];
  onRestore: (parentPageId: string | null) => void;
  onCancel: () => void;
}): ReactElement {
  const { t } = useT();
  const [filter, setFilter] = useState('');
  const untitledFolder = t('folder.untitled');
  const all = useMemo(() => {
    const list = folders(tree, untitledFolder);
    return entry.kind === 'folder'
      ? [{ id: null, label: t('move.root'), path: '', depth: 0 }, ...list]
      : list;
  }, [tree, entry.kind, untitledFolder, t]);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? all.filter(
        (one) =>
          one.label.toLowerCase().includes(needle) ||
          one.path.toLowerCase().includes(needle),
      )
    : all;

  return (
    <div
      className="dialog-scrim"
      // Click, not pointerdown: on touch, pointerdown fires as the finger
      // lands, so a tap meant to become a scroll would close the dialog.
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('trash.restoreTo')}>
        <h2 className="dialog-title">
          {t('trash.restoreTitle', {
            title:
              entry.title ||
              (entry.kind === 'folder' ? t('folder.untitled') : t('page.untitled')),
          })}
        </h2>
        {/* Why this is being asked at all. Without it the dialog looks like an
            extra step somebody has to work out the reason for. */}
        <p className="muted small">{t('trash.parentGone')}</p>

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
              style={{ paddingInlineStart: `${8 + destination.depth * 14}px` }}
              onClick={() => onRestore(destination.id)}
            >
              <FolderIcon />
              <span className="dialog-item-label">{destination.label}</span>
              {destination.path && (
                <span className="dialog-item-path">{destination.path}</span>
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
