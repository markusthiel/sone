/**
 * SONE web — where an entry sits, above its name (ADR-0164).
 *
 * One component, because there were two copies of it and the older one said so
 * in a comment: *"the same markup a folder's own trail uses, so the two do not
 * drift apart"*. They drifted the moment a cover could run to the top edge —
 * moving the trail meant moving it twice, and a rule that has to be applied
 * twice is a rule that gets applied once.
 *
 * ## Inside the heading region, not above it
 *
 * It used to be the page body's first child, above the cover. A cover that runs
 * to the top edge is pulled up by the height of the bar and the body's padding,
 * and that arithmetic is only true when the picture is **the first thing in the
 * body** — with a trail above it, the picture started a breadcrumb's height too
 * low, which is exactly what was reported: *„wenn die linke seitenleiste
 * ausgeblendet wird, das bild nicht mehr bis ganz zum oberen rand geht"*.
 *
 * So the trail moved under the cover and above the title, where it also reads
 * better: the folders, then the name of the thing.
 */

import type { ReactElement } from 'react';

import { type PageNode } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { usePageLink } from '../routes/pageLink.tsx';

export function Breadcrumb({ trail }: { trail: PageNode[] }): ReactElement | null {
  const { t } = useT();
  const pageLink = usePageLink();

  if (trail.length === 0) return null;

  return (
    <nav className="breadcrumb" aria-label={t('folder.location')}>
      {trail.map((ancestor) => (
        <span key={ancestor.id}>
          <a href={pageLink(ancestor.id, ancestor.title ?? undefined)}>
            {ancestor.title || t('folder.untitled')}
          </a>
          <span aria-hidden="true"> / </span>
        </span>
      ))}
    </nav>
  );
}
