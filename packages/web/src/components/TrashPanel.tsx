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

/**
 * Folded for comparison: lower case, accents stripped.
 *
 * So "Prufung" finds "Prüfung" and "notizen" finds "Notizen". Somebody looking
 * for a thing they deleted a fortnight ago half-remembers its name, which is
 * the whole reason this field exists.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** How many of the thirty days are left (ADR-0027). */
export function daysLeft(entry: TrashEntry): number {
  const gone = Date.parse(entry.archivedAt) + 30 * 86_400_000;
  return Math.max(0, Math.ceil((gone - Date.now()) / 86_400_000));
}

const EXPIRING_WITHIN = 7;

/**
 * What a view selects, so the menu and the list cannot disagree about it.
 *
 * The query is a second axis rather than a fifth view: it narrows whichever
 * view is chosen, which is why the counts beside the names move while somebody
 * types. A search that silently left the chosen view would answer a question
 * nobody asked.
 */
export function entriesIn(
  entries: TrashEntry[],
  view: TrashView,
  query = '',
): TrashEntry[] {
  const needle = fold(query.trim());
  const found =
    needle === ''
      ? entries
      : entries.filter((one) => fold(one.title).includes(needle));
  if (view === 'expiring') return found.filter((one) => daysLeft(one) <= EXPIRING_WITHIN);
  if (view === 'page') return found.filter((one) => one.kind !== 'folder');
  if (view === 'folder') return found.filter((one) => one.kind === 'folder');
  return found;
}

export function TrashPanel({
  entries,
  view,
  query,
  onPick,
  onSearch,
}: {
  entries: TrashEntry[] | null;
  view: TrashView;
  /** What is being looked for, narrowing every view at once (ADR-0071). */
  query: string;
  onPick: (view: TrashView) => void;
  onSearch: (query: string) => void;
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
      {entriesIn(all, to, query).length > 0 && (
        <span className="panel-menu-count">{entriesIn(all, to, query).length}</span>
      )}
    </button>
  );

  return (
    <>
      {/* Above the views, because it narrows all of them. Thirty days of
          deletions is a lot to read down, and the name is the one thing
          somebody looking for a deleted page still has. */}
      <input
        className="panel-search"
        type="search"
        value={query}
        placeholder={t('trash.search')}
        aria-label={t('trash.search')}
        onChange={(event) => onSearch(event.target.value)}
      />

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
