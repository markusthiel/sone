/**
 * The parts of SONE that are not a page.
 *
 * The inbox, the workspaces, the trash. One list, defined once, drawn in two
 * places that are never both on screen: the rail above 800px, and the foot of
 * the sidebar's drawer below it. That is what keeps this from being the
 * fault ADR-0067 was amended over — three ways into the same subject is not an
 * improvement, and a second entry that appears at a different width is still a
 * second entry if both are drawn at once.
 *
 * Search is absent for the same reason, from the other direction: it already
 * has one way in, the labelled row above the tree, and that row is in the
 * sidebar at both widths. An icon on the rail would have been a second one —
 * and a worse one, since the row is the more findable of the two.
 *
 * Your settings, the administration and signing out are absent as well. They
 * belong to you and to the server rather than to the workspace you are looking
 * at, and they stay in the account menu — which is also what stops that menu
 * from becoming one item behind an avatar.
 *
 * Destinations only. The moment something here creates or changes anything, it
 * stops being a map.
 */

import type { ReactElement } from 'react';

import { paths } from '../routes/paths.ts';
import { useT } from '../i18n/useT.tsx';
import { BellIcon, TrashIcon, WorkspacesIcon } from './icons.tsx';

/** The parts the rail and the drawer name. `null` while looking at a page. */
export type Place = 'inbox' | 'workspaces' | 'trash';

export type PlaceEntry = {
  place: Place;
  href: string;
  label: string;
  icon: ReactElement;
};

export function usePlaces(): PlaceEntry[] {
  const { t } = useT();
  return [
    { place: 'inbox', href: paths.inbox(), label: t('account.inbox'), icon: <BellIcon /> },
    {
      place: 'workspaces',
      href: paths.workspaces(),
      label: t('account.workspaces'),
      icon: <WorkspacesIcon />,
    },
    { place: 'trash', href: paths.trash(), label: t('account.trash'), icon: <TrashIcon /> },
  ];
}

/**
 * Which place a route is in, for a route the shell renders.
 *
 * The workspace list returns its own screen before the shell is reached, so
 * `workspaces` is never the answer here — its entry still navigates, it simply
 * has nothing to mark while you are not in the shell. Returning null for it is
 * the honest result rather than a lie the highlight would tell.
 */
export function placeOf(kind: string): Place | null {
  if (kind === 'inbox') return 'inbox';
  if (kind === 'trash') return 'trash';
  return null;
}
