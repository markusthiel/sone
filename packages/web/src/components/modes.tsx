/**
 * The modes: where you are in SONE, as opposed to which page you have open.
 *
 * One rule holds the whole shell together (ADR-0069). The rail picks a mode.
 * The panel beside it *navigates* within that mode — a page tree, a menu of
 * views, a list of sections — and never holds the content itself. The area to
 * the right *shows* whatever the panel selected.
 *
 * That is why the notifications are not in the panel: their menu is, and the
 * notifications themselves are content. Once a mode answers those two
 * questions — what navigates, what shows — it fits without further argument,
 * which is the point of having the rule at all.
 *
 * The tree is the mark's own mode rather than an entry here: it is where you
 * are when you are not anywhere else, so it hangs off the logo at the top.
 *
 * Your settings, the administration and signing out stay in the account menu at
 * the foot of the rail. A cog here would have to mean three things at once —
 * yours, the workspace's, the instance's — and at that moment the rail answers
 * "what do I want to do" rather than "where am I", which is where a rail like
 * this starts collecting icons.
 */

import type { ReactElement } from 'react';

import { paths } from '../routes/paths.ts';
import { useT } from '../i18n/useT.tsx';
import { BellIcon, TrashIcon, WorkspacesIcon } from './icons.tsx';

/** A mode is a place you stay, never an action you take. */
export type Mode = 'tree' | 'workspaces' | 'inbox' | 'trash';

export type ModeEntry = {
  mode: Mode;
  href: string;
  label: string;
  icon: ReactElement;
};

/**
 * The rail's entries, in order.
 *
 * Workspaces first, because it is the largest container: it decides what the
 * tree below it even contains. Then what is waiting for you, then what you
 * threw away.
 */
export function useModes(): ModeEntry[] {
  const { t } = useT();
  return [
    {
      mode: 'workspaces',
      href: paths.workspaces(),
      label: t('account.workspaces'),
      icon: <WorkspacesIcon />,
    },
    { mode: 'inbox', href: paths.inbox(), label: t('account.inbox'), icon: <BellIcon /> },
    { mode: 'trash', href: paths.trash(), label: t('account.trash'), icon: <TrashIcon /> },
  ];
}

/**
 * The mode a route is in.
 *
 * Everything that is not one of the named modes is the tree, including a page,
 * a search and a not-found — they are all "you are in your pages", and the
 * panel beside them is the tree.
 */
export function modeOf(kind: string): Mode {
  if (kind === 'inbox') return 'inbox';
  if (kind === 'trash') return 'trash';
  if (kind === 'workspaceList') return 'workspaces';
  return 'tree';
}
