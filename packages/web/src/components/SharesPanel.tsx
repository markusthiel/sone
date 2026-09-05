/**
 * The shares menu — the panel, not the shares (ADR-0069, ADR-0092).
 *
 * The screen shipped with all three lists stacked in the content column and
 * nothing at all in the sidebar, which is the one shape ADR-0069 says this
 * shell does not have: the left column is the menu and the middle is what the
 * menu chose. Reported as "Das Sharing Menü ist leer … Da kann man doch Links,
 * von mir, für mich als getrennte einträge als Menü darstellen. Und im Content
 * Bereich dann die ergebnisse."
 *
 * So the three lists become three views, in the order they were already in and
 * for the same reason: a **link** is the only kind of share that has already
 * left the building and can be forwarded by somebody who was never given
 * anything; then what you are accountable for; then what somebody else is.
 *
 * Counted from the list the screen already holds, like the inbox's — a menu
 * that says "Links" without saying how many is a menu you have to click to
 * learn anything from, and a second request for the number is how a number and
 * a list come to disagree.
 */

import type { ReactElement } from 'react';

import { useT } from '../i18n/useT.tsx';
import { LinkIcon, ShareIcon, PersonIcon } from './icons.tsx';

export type SharesView = 'links' | 'granted' | 'received';

export function SharesPanel({
  counts,
  view,
  onPick,
}: {
  counts: Record<SharesView, number>;
  view: SharesView;
  onPick: (view: SharesView) => void;
}): ReactElement {
  const { t } = useT();

  const entry = (to: SharesView, icon: ReactElement, label: string): ReactElement => (
    <button
      className="panel-menu-item"
      type="button"
      key={to}
      aria-current={view === to ? 'page' : undefined}
      onClick={() => onPick(to)}
    >
      {icon}
      <span className="panel-menu-label">{label}</span>
      {/* No zero, for the same reason the inbox has none: a count of nothing is
          noise on every quiet row, and the absence says it more quietly. */}
      {counts[to] > 0 && <span className="panel-menu-count">{counts[to]}</span>}
    </button>
  );

  return (
    <div className="panel-menu-group">
      {entry('links', <LinkIcon />, t('shares.links'))}
      {entry('granted', <ShareIcon />, t('shares.granted'))}
      {entry('received', <PersonIcon />, t('shares.received'))}
    </div>
  );
}
