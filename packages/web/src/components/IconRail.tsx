/**
 * The rail: the mode switcher, and the outermost frame of the window (ADR-0069).
 *
 * Four modes and an account. The mark is the tree's own mode — where you are
 * when you are not anywhere else — so it sits at the top and the three named
 * ones follow it. Workspaces first of those, because it is the largest
 * container: it decides what the tree below it even contains.
 *
 * The account is at the foot, set apart by the gap above it, because it is not
 * a mode. It is you, and the server.
 *
 * Always drawn above 800px, whatever the sidebar is doing — a mode switcher
 * that can be collapsed is a mode switcher somebody loses. Below 800px it is
 * not drawn at all and the mode bar carries the same list along the foot of the
 * screen instead (ADR-0074); the two are never on screen at once.
 */

import type { ReactElement, ReactNode } from 'react';

import { paths } from '../routes/paths.ts';
import { useT } from '../i18n/useT.tsx';
import { SoneMark } from './Logo.tsx';
import { useModes, type Mode } from './modes.tsx';

export function IconRail({
  here,
  account,
}: {
  here: Mode;
  /** The account menu, which is not a mode and is drawn apart from them.
   *  Null below the breakpoint, where the mode bar draws it instead. */
  account: ReactNode;
}): ReactElement {
  const { t } = useT();
  /*
   * The first entry is your pages, and here it is the mark (ADR-0072).
   *
   * Taken from the same list the mode bar draws below 800px rather than named
   * again here: a mode left out of one of the two drawings is a mode somebody
   * cannot reach, which is exactly what happened on a phone (ADR-0072).
   */
  const [tree, ...rest] = useModes();

  return (
    <nav className="icon-rail" aria-label={t('sidebar.places')}>
      <a
        className="rail-brand"
        href={tree?.href ?? paths.home()}
        title={tree?.label ?? 'SONE'}
        aria-current={here === 'tree' ? 'page' : undefined}
      >
        <SoneMark size={26} title="SONE" />
      </a>

      <div className="rail-nav">
        {rest.map(({ mode, href, label, icon }) => (
          // aria-current="page" and not a class: the state is "this is where
          // you are", which the browser and a screen reader both already know
          // how to say. The stylesheet reads the same attribute.
          <a
            className="rail-item"
            key={mode}
            href={href}
            title={label}
            aria-label={label}
            aria-current={here === mode ? 'page' : undefined}
          >
            {icon}
          </a>
        ))}
      </div>

      <div className="rail-account">{account}</div>
    </nav>
  );
}
