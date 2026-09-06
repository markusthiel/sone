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
 * the foot of the rail. A cog here would answer "what do I want to do" rather
 * than "where am I", which is where a rail like this starts collecting icons.
 *
 * Settings means yours and the server's, and nothing else (ADR-0070). A
 * workspace's own settings are the Workspaces mode: that is the mode whose
 * subject is a workspace, and putting them anywhere else means a menu that
 * changes scope halfway down.
 */

import type { ReactElement } from 'react';

import { paths } from '../routes/paths.ts';
import { useT } from '../i18n/useT.tsx';
import { SoneMark } from './Logo.tsx';
import { BellIcon, SearchIcon, ShareIcon, TrashIcon, WorkspacesIcon } from './icons.tsx';

/** A mode is a place you stay, never an action you take. */
export type Mode =
  | 'tree'
  | 'search'
  | 'workspaces'
  | 'inbox'
  | 'shares'
  | 'trash'
  | 'settings'
  | 'admin';

export type ModeEntry = {
  mode: Mode;
  href: string;
  label: string;
  icon: ReactElement;
  /**
   * How many things are waiting here, drawn as a badge on the icon.
   *
   * On the entry rather than passed to each drawing, because there are two of
   * them — the rail and the mode bar — and a count one of them knows about is
   * a count the other quietly omits. Only the inbox has one today.
   */
  badge?: number;
};

/**
 * Every mode with a place of its own, in order.
 *
 * Your pages first, because that is where you are when you are not anywhere
 * else. Then workspaces, the largest container — it decides what the tree even
 * contains — then what is waiting for you, then what you threw away.
 *
 * Your pages are in this list, and that is the fix for a dead end (ADR-0072).
 * Above 800px the rail draws this first entry as the mark and the rest as
 * icons; below it the mode bar draws all of them along the foot of the screen
 * (ADR-0074). One list, two drawings, and neither may leave a mode out — the
 * drawing that did left a phone with no way back to its own pages.
 */
export function useModes(unread = 0): ModeEntry[] {
  const { t } = useT();
  return [
    {
      mode: 'tree',
      href: paths.home(),
      label: t('mode.pages'),
      // The mark, at the size of the icons beside it: the same glyph the rail
      // draws large, so the two read as the same place rather than as two.
      icon: <SoneMark size={17} />,
    },
    /*
     * Searching, which ADR-0069 decided was not a place and ADR-0074 wrote down
     * as settled (ADR-0118).
     *
     * That was right about search as it then was: a field and a list of
     * results, with nothing to come back to. ADR-0050 gave it saved searches —
     * things you return to by name — and put them *inside* the screen, under a
     * comment saying a sidebar section would be "a decision about the sidebar
     * rather than about searches". It was a decision about the sidebar, and
     * this is it.
     *
     * Second, right after your pages, because that is what it searches. You
     * still do not come here to *start* one: the field above the tree does
     * that and lands you here (ADR-0118), so this is where a search you are
     * already in lives, and the way back to one you kept.
     */
    {
      mode: 'search',
      href: paths.search(),
      label: t('sidebar.search'),
      icon: <SearchIcon />,
    },
    {
      mode: 'workspaces',
      href: paths.workspaces(),
      label: t('account.workspaces'),
      icon: <WorkspacesIcon />,
    },
    {
      mode: 'inbox',
      href: paths.inbox(),
      label: t('account.inbox'),
      icon: <BellIcon />,
      /*
       * The number belongs here, on the bell.
       *
       * It sat on the account avatar, where it was the only badge in the
       * application and pointed at a menu that does not hold the notifications.
       * Reported as: "Die Glocke sollte dann die Zahl haben, die momentan auf
       * dem Profil sitzt, da macht es mehr sinn." It does (ADR-0092).
       */
      badge: unread,
    },
    // Beside the trash rather than inside a workspace's settings: "what have I
    // let out" is a question about your own doing, asked across every page you
    // touched, and it belongs where the other such questions are (ADR-0070).
    { mode: 'shares', href: paths.shares(), label: t('shares.title'), icon: <ShareIcon /> },
    { mode: 'trash', href: paths.trash(), label: t('account.trash'), icon: <TrashIcon /> },
  ];
}

/**
 * The mode a route is in.
 *
 * Everything that is not one of the named modes is the tree, including a page
 * and a not-found — they are all "you are in your pages", and the panel beside
 * them is the tree. A search was among them until ADR-0118 gave it a panel of
 * its own to be beside.
 */
export function modeOf(kind: string): Mode {
  // A search is its own mode now, with filters in the panel beside it
  // (ADR-0118). It used to fall through to the tree, which is what left the
  // filter syntax as the only way to narrow one.
  if (kind === 'search') return 'search';
  if (kind === 'inbox') return 'inbox';
  if (kind === 'trash') return 'trash';
  if (kind === 'shares') return 'shares';
  /*
   * A workspace's settings are the Workspaces mode (ADR-0070).
   *
   * They were the settings mode, which made that one menu answer for three
   * different subjects — you, one workspace, the whole server — and the middle
   * one is not like the others: there are several workspaces and only ever one
   * of you and one server. A subject you have to *choose* needs a chooser, and
   * the chooser belongs in the mode whose subject it is.
   */
  if (kind === 'workspaceList' || kind === 'workspaceSettings') return 'workspaces';
  /*
   * Your settings and the server's are two modes, not one (ADR-0072).
   *
   * They were two groups in one list, and the list was already long enough that
   * "Mailserver" and "Wo du landest" sat six rows apart in the same column —
   * with more to come on both sides. Two subjects, two areas, and the account
   * menu was already offering them as two entries.
   *
   * Neither has an icon on the rail: both are reached from the account menu,
   * which is where you already are when you are thinking about yourself or your
   * server. They are modes like any other once you are in one.
   */
  if (kind === 'settings') return 'settings';
  if (kind === 'admin') return 'admin';
  return 'tree';
}
