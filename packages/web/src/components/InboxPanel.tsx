/**
 * The inbox's menu — the panel, not the notifications (ADR-0069).
 *
 * Every view here is counted from the list already in hand rather than asked
 * for separately, which is what lets the numbers sit beside the names. A menu
 * that says "Mentions" without saying how many is a menu you have to click to
 * learn anything from.
 *
 * Three axes, in the order somebody actually asks them: is there anything new,
 * what kind of thing is it, and where did it happen. The workspace axis matters
 * because an inbox spans them (ADR-0052) and the panel's head cannot say which
 * one you are in — there is no single answer.
 */

import type { ReactElement } from 'react';

import { useT } from '../i18n/useT.tsx';
import {
  BellIcon,
  CheckSquareIcon,
  ClockIcon,
  MessageIcon,
  PersonIcon,
  WorkspacesIcon,
} from './icons.tsx';
import type { InboxItem } from '../hooks/useInbox.ts';

export type InboxView =
  | { of: 'unread' }
  | { of: 'all' }
  | { of: 'kind'; kind: InboxItem['kind'] }
  | { of: 'workspace'; workspaceId: string };

export function sameView(a: InboxView, b: InboxView): boolean {
  if (a.of !== b.of) return false;
  if (a.of === 'kind' && b.of === 'kind') return a.kind === b.kind;
  if (a.of === 'workspace' && b.of === 'workspace') return a.workspaceId === b.workspaceId;
  return true;
}

/** What a view selects, so the menu and the list cannot disagree about it. */
export function itemsIn(items: InboxItem[], view: InboxView): InboxItem[] {
  if (view.of === 'unread') return items.filter((one) => !one.read);
  if (view.of === 'kind') return items.filter((one) => one.kind === view.kind);
  if (view.of === 'workspace') {
    return items.filter((one) => one.workspaceId === view.workspaceId);
  }
  return items;
}

export function InboxPanel({
  items,
  view,
  onPick,
}: {
  items: InboxItem[] | null;
  view: InboxView;
  onPick: (view: InboxView) => void;
}): ReactElement {
  const { t } = useT();
  const all = items ?? [];

  const entry = (
    key: string,
    to: InboxView,
    icon: ReactElement,
    label: string,
    count: number,
  ): ReactElement => (
    <button
      className="panel-menu-item"
      type="button"
      key={key}
      aria-current={sameView(view, to) ? 'page' : undefined}
      onClick={() => onPick(to)}
    >
      {icon}
      <span className="panel-menu-label">{label}</span>
      {/* No zero. A count of nothing is noise on every row that is quiet, and
          the absence says the same thing more quietly. */}
      {count > 0 && <span className="panel-menu-count">{count}</span>}
    </button>
  );

  // The workspaces that actually sent something, in the order they last did.
  const workspaces: { id: string; name: string }[] = [];
  for (const one of all) {
    if (!workspaces.some((w) => w.id === one.workspaceId)) {
      workspaces.push({ id: one.workspaceId, name: one.workspaceName });
    }
  }

  return (
    <>
      <div className="panel-menu-group">
        <div className="sidebar-label">{t('inbox.group.state')}</div>
        {entry('unread', { of: 'unread' }, <BellIcon />, t('inbox.view.unread'),
          all.filter((one) => !one.read).length)}
        {entry('all', { of: 'all' }, <ClockIcon />, t('inbox.view.all'), all.length)}
      </div>

      <div className="panel-menu-group">
        <div className="sidebar-label">{t('inbox.group.kind')}</div>
        {entry('mention', { of: 'kind', kind: 'mention' }, <PersonIcon />, t('inbox.mention'),
          all.filter((one) => one.kind === 'mention' && !one.read).length)}
        {entry('reply', { of: 'kind', kind: 'reply' }, <MessageIcon />, t('inbox.reply'),
          all.filter((one) => one.kind === 'reply' && !one.read).length)}
        {entry('assignment', { of: 'kind', kind: 'assignment' }, <CheckSquareIcon />,
          t('inbox.assignment'),
          all.filter((one) => one.kind === 'assignment' && !one.read).length)}
      </div>

      {workspaces.length > 1 && (
        <div className="panel-menu-group">
          <div className="sidebar-label">{t('inbox.group.workspace')}</div>
          {workspaces.map((one) =>
            entry(one.id, { of: 'workspace', workspaceId: one.id }, <WorkspacesIcon />, one.name,
              all.filter((n) => n.workspaceId === one.id && !n.read).length))}
        </div>
      )}
    </>
  );
}
