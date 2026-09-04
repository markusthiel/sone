/**
 * The trash's menu — the panel, not the deleted entries (ADR-0069).
 *
 * Every view is computed from the list already in hand. None of it needs a new
 * endpoint: `archivedAt` gives the clock, `kind` gives the type, and the count
 * beside each name is the same arithmetic the list does.
 *
 * "Going soon" is first among the axes because it is the only one with a
 * deadline. Everything else in a trash can wait; the entries in their last week
 * cannot, and a trash that does not say so is a trash that quietly loses
 * things (ADR-0027).
 */

import type { ReactElement } from 'react';

import type { TrashEntry } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { ClockIcon, FolderIcon, PageIcon, TrashIcon } from './icons.tsx';

export type TrashView = 'recent' | 'expiring' | 'page' | 'folder';

/** How many of the thirty days are left (ADR-0027). */
export function daysLeft(entry: TrashEntry): number {
  const gone = Date.parse(entry.archivedAt) + 30 * 86_400_000;
  return Math.max(0, Math.ceil((gone - Date.now()) / 86_400_000));
}

const EXPIRING_WITHIN = 7;

export function entriesIn(entries: TrashEntry[], view: TrashView): TrashEntry[] {
  if (view === 'expiring') return entries.filter((one) => daysLeft(one) <= EXPIRING_WITHIN);
  if (view === 'page') return entries.filter((one) => one.kind !== 'folder');
  if (view === 'folder') return entries.filter((one) => one.kind === 'folder');
  return entries;
}

export function TrashPanel({
  entries,
  view,
  onPick,
}: {
  entries: TrashEntry[] | null;
  view: TrashView;
  onPick: (view: TrashView) => void;
}): ReactElement {
  const { t } = useT();
  const all = entries ?? [];

  const entry = (to: TrashView, icon: ReactElement, label: string): ReactElement => (
    <button
      className="panel-menu-item"
      type="button"
      key={to}
      aria-current={view === to ? 'page' : undefined}
      onClick={() => onPick(to)}
    >
      {icon}
      <span className="panel-menu-label">{label}</span>
      {entriesIn(all, to).length > 0 && (
        <span className="panel-menu-count">{entriesIn(all, to).length}</span>
      )}
    </button>
  );

  return (
    <>
      <div className="panel-menu-group">
        <div className="sidebar-label">{t('trash.group.when')}</div>
        {entry('recent', <ClockIcon />, t('trash.view.recent'))}
        {entry('expiring', <TrashIcon />, t('trash.view.expiring'))}
      </div>
      <div className="panel-menu-group">
        <div className="sidebar-label">{t('trash.group.kind')}</div>
        {entry('page', <PageIcon />, t('trash.view.pages'))}
        {entry('folder', <FolderIcon />, t('trash.view.folders'))}
      </div>
    </>
  );
}
