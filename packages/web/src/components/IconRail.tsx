/**
 * The rail: where you are in the instance, not where you are in a workspace.
 *
 * The sidebar answers "which page", and it changes when you switch workspace.
 * The places on the rail answer "which part of SONE", and they do not.
 *
 * They are on the rail *instead of* in the account menu, not as well as — the
 * list lives in places.tsx and is drawn here above 800px and at the foot of the
 * sidebar's drawer below it, and the two are never on screen together. ADR-0067
 * was amended because three ways into one subject made a menu worse rather than
 * better; a rail that repeated the menu would be that mistake with a column
 * around it.
 *
 * The mark lives here because this is the outermost frame of the window. It had
 * nowhere to live before: the top of the sidebar is a column that collapses.
 *
 * Destinations only — never an action, never a document. The moment something
 * here creates or changes anything, the rail stops being a map.
 */

import type { ReactElement } from 'react';

import { paths } from '../routes/paths.ts';
import { useT } from '../i18n/useT.tsx';
import { SoneMark } from './Logo.tsx';
import { usePlaces, type Place } from './places.tsx';

export function IconRail({ here }: { here: Place | null }): ReactElement {
  const { t } = useT();
  const places = usePlaces();

  return (
    <nav className="icon-rail" aria-label={t('sidebar.places')}>
      <a className="rail-brand" href={paths.home()} title="SONE">
        <SoneMark size={26} title="SONE" />
      </a>

      <div className="rail-nav">
        {places.map(({ place, href, label, icon }) => (
          // aria-current="page" and not a class: the state is "this is the page
          // you are on", which the browser and a screen reader both already know
          // how to say. The stylesheet reads the same attribute.
          <a
            className="rail-item"
            key={place}
            href={href}
            title={label}
            aria-label={label}
            aria-current={here === place ? 'page' : undefined}
          >
            {icon}
          </a>
        ))}
      </div>
    </nav>
  );
}
