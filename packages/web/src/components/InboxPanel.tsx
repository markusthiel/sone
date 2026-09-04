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
  /** What is asleep, and when it comes back (ADR-0075). */
  | { of: 'snoozed' }
  | { of: 'kind'; kind: InboxItem['kind'] }
  | { of: 'workspace'; workspaceId: string };

/** Asleep: a moment set, and still ahead. */
export function isAsleep(item: InboxItem, now = Date.now()): boolean {
  return item.snoozedUntil !== null && Date.parse(item.snoozedUntil) > now;
}

export function sameView(a: InboxView, b: InboxView): boolean {
  if (a.of !== b.of) return false;
  if (a.of === 'kind' && b.of === 'kind') return a.kind === b.kind;
  if (a.of === 'workspace' && b.of === 'workspace') return a.workspaceId === b.workspaceId;
  return true;
}

/**
 * What a view selects, so the menu and the list cannot disagree about it.
 *
 * One rule for sleep (ADR-0075): something put aside is absent from every view
 * except "Später", which lists it, and "Alles", which is called Alles. That is
 * what putting something aside means, and stating it once here is what keeps
 * the counts beside the names honest — they come from this same function.
 */
export function itemsIn(items: InboxItem[], view: InboxView): InboxItem[] {
  if (view.of === 'snoozed') return items.filter((one) => isAsleep(one));
  if (view.of === 'all') return items;
  const awake = items.filter((one) => !isAsleep(one));
  if (view.of === 'unread') return awake.filter((one) => !one.read);
  if (view.of === 'kind') return awake.filter((one) => one.kind === view.kind);
  return awake.filter((one) => one.workspaceId === view.workspaceId);
}

/**
 * One conversation, however many times it spoke (ADR-0071).
 *
 * Three replies in one thread were three rows saying almost the same thing, and
 * the fourth reply pushed the first out of sight. They are one row: the newest
 * passage, and how many there are. The whole point of an inbox is to be read
 * top to bottom, and it cannot be if one lively discussion fills it.
 *
 * Only replies group, and only within a thread. A mention is a separate act
 * addressed to you by name — two of them in the same thread are two things you
 * were called into, not one repeated. An assignment is the same.
 */
export interface InboxGroup {
  /** The thread's id where there is one; otherwise the notification's own. */
  id: string;
  /** Newest first, like the list they came from. */
  items: InboxItem[];
  /** The one the row shows, which is the newest. */
  latest: InboxItem;
  unread: number;
}

export function groupsIn(items: InboxItem[], view: InboxView): InboxGroup[] {
  const groups: InboxGroup[] = [];
  const byThread = new Map<string, InboxGroup>();

  // In the order they arrive, which the server has already sorted newest
  // first — so a group takes the position of its newest member, and a thread
  // that just spoke is at the top.
  for (const item of itemsIn(items, view)) {
    const key = item.kind === 'reply' && item.threadId !== null ? item.threadId : null;
    const existing = key === null ? undefined : byThread.get(key);
    if (existing) {
      existing.items.push(item);
      if (!item.read) existing.unread += 1;
      continue;
    }
    const group: InboxGroup = {
      id: key ?? item.id,
      items: [item],
      latest: item,
      unread: item.read ? 0 : 1,
    };
    if (key !== null) byThread.set(key, group);
    groups.push(group);
  }

  return groups;
}

/** Rows in a view that still have something waiting in them. */
function unreadRows(items: InboxItem[], view: InboxView): number {
  return groupsIn(items, view).filter((group) => group.unread > 0).length;
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
        {/* Counted in rows, not notifications (ADR-0071). A menu saying 7 over
            a list of 4 rows is a menu that looks wrong, and the row is what
            somebody is about to deal with. */}
        {entry('unread', { of: 'unread' }, <BellIcon />, t('inbox.view.unread'),
          groupsIn(all, { of: 'unread' }).length)}
        {entry('all', { of: 'all' }, <ClockIcon />, t('inbox.view.all'),
          groupsIn(all, { of: 'all' }).length)}
        {/* Only once something is asleep. An empty "Später" every day, for the
            many people who never snooze anything, is a row that says nothing.
            The count here is what is asleep rather than what is unread in it:
            the question the row answers is "how much did I put off". */}
        {all.some((one) => isAsleep(one)) &&
          entry('snoozed', { of: 'snoozed' }, <ClockIcon />, t('inbox.view.snoozed'),
            groupsIn(all, { of: 'snoozed' }).length)}
      </div>

      <div className="panel-menu-group">
        <div className="sidebar-label">{t('inbox.group.kind')}</div>
        {entry('mention', { of: 'kind', kind: 'mention' }, <PersonIcon />, t('inbox.mention'),
          unreadRows(all, { of: 'kind', kind: 'mention' }))}
        {entry('reply', { of: 'kind', kind: 'reply' }, <MessageIcon />, t('inbox.reply'),
          unreadRows(all, { of: 'kind', kind: 'reply' }))}
        {entry('assignment', { of: 'kind', kind: 'assignment' }, <CheckSquareIcon />,
          t('inbox.assignment'),
          unreadRows(all, { of: 'kind', kind: 'assignment' }))}
      </div>

      {workspaces.length > 1 && (
        <div className="panel-menu-group">
          <div className="sidebar-label">{t('inbox.group.workspace')}</div>
          {workspaces.map((one) =>
            entry(one.id, { of: 'workspace', workspaceId: one.id }, <WorkspacesIcon />, one.name,
              unreadRows(all, { of: 'workspace', workspaceId: one.id })))}
        </div>
      )}
    </>
  );
}
