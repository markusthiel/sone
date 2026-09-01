/**
 * SONE web — how wide this page is drawn.
 *
 * Read from the document rather than from the page's detail endpoint, for two
 * reasons. The page view has the document open already and would otherwise fetch
 * a record it needs one field of; and the value then arrives the way every other
 * edit does — somebody widening the page on their laptop widens it on the tablet
 * beside it, with no refetch and no polling.
 */

import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

import { DOC_KEYS, PAGE_KEYS } from '@sone/core';

export type PageWidth = 'column' | 'full';

export function usePageWidth(doc: Y.Doc | null): PageWidth {
  const [width, setWidth] = useState<PageWidth>('column');

  useEffect(() => {
    if (!doc) {
      setWidth('column');
      return;
    }
    const page = doc.getMap(DOC_KEYS.page);
    const read = (): void => {
      const value = page.get(PAGE_KEYS.width);
      // Anything the stylesheet does not know is the default, not an error: a
      // document is written by clients, and an unknown width must not leave a
      // page with no measure at all.
      setWidth(value === 'full' ? 'full' : 'column');
    };
    read();
    page.observe(read);
    return () => page.unobserve(read);
  }, [doc]);

  return width;
}
