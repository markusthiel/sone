/**
 * The rail, laid on its side, for a phone (ADR-0074).
 *
 * The same modes in the same order from the same list as the rail draws
 * (modes.tsx), and the account at the end, apart, because it is not a mode.
 * Below 800px the rail is not drawn and this is; the two are never on screen
 * together, so this is one list in two drawings rather than two ways in.
 *
 * ADR-0069 sketched it as "Seiten · Suchen · Posteingang · Du". That set is not
 * the rail's, and the difference is what makes it wrong: a phone would offer
 * fewer places than a desktop, with no way to reach the missing ones — the
 * workspaces and the trash would exist and be unreachable.
 *
 * The sketch was also right about one thing this rejected at the time. Search
 * *is* here now (ADR-0118) — not because a search is an action you take here,
 * but because ADR-0050 gave it saved searches, and a list you return to by name
 * is a place. The row above the tree is still the way in; it is a field now,
 * and it lands you in this mode. Seven slots across a phone rather than six is
 * the cost, and it is why the labels ellipsise.
 *
 * It is fixed to the bottom, which is where a thumb is. That costs the height of
 * the bar at the foot of the reading column, and the main area pays it back as
 * padding — content that ends underneath a bar is content somebody cannot
 * finish reading.
 */

import type { ReactElement, ReactNode } from 'react';

import { useT } from '../i18n/useT.tsx';
import { useKeyboardOpen } from '../hooks/useKeyboardOpen.ts';
import { useModes, type Mode } from './modes.tsx';

export function ModeBar({
  here,
  account,
  unread = 0,
}: {
  here: Mode;
  /** The account menu. Null above the breakpoint, where the rail draws it. */
  account: ReactNode;
  /** Waiting in the inbox, drawn on the bell (ADR-0092). */
  unread?: number;
}): ReactElement {
  const { t } = useT();
  const modes = useModes(unread);
  const keyboard = useKeyboardOpen();

  return (
    <nav
      className="mode-bar"
      aria-label={t('sidebar.places')}
      /*
       * Out of the way while somebody is writing.
       *
       * A bar sitting above an open keyboard takes the last line of the editor
       * at the moment that line matters most. Hidden rather than unmounted, so
       * nothing inside it is rebuilt when the keyboard closes again — and so
       * `inert` takes it out of the tab order while it is not there to be seen.
       */
      data-hidden={keyboard ? 'true' : undefined}
      {...(keyboard ? { inert: true } : {})}
    >
      {modes.map(({ mode, href, label, icon, badge }) => (
        <a
          className="bar-item"
          key={mode}
          href={href}
          // aria-current="page" and not a class: the state is "this is where you
          // are", which the browser and a screen reader both already know how to
          // say. The stylesheet reads the same attribute.
          aria-current={here === mode ? 'page' : undefined}
          aria-label={badge ? `${label} (${badge})` : undefined}
        >
          {icon}
          {badge !== undefined && badge > 0 && (
            <span className="sidebar-unread" aria-hidden="true">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
          <span className="bar-label">{label}</span>
        </a>
      ))}

      {/* The face, in the space one item takes. It is not a mode — it is you —
          so it sits at the end and is not marked as a place you can be. */}
      <div className="bar-account">{account}</div>
    </nav>
  );
}
