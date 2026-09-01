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

/**
 * Which kind of entry this document is (ADR-0019, ADR-0043).
 *
 * From the document rather than from the tree, for the same reason the width is:
 * the page view has it open, and the answer must not depend on a list that was
 * fetched before the page was created.
 */
export function useEntryKind(doc: Y.Doc | null): string {
  const [kind, setKind] = useState('page');

  useEffect(() => {
    if (!doc) {
      setKind('page');
      return;
    }
    const page = doc.getMap(DOC_KEYS.page);
    const read = (): void => {
      const value = page.get(PAGE_KEYS.kind);
      setKind(typeof value === 'string' ? value : 'page');
    };
    read();
    page.observe(read);
    return () => page.unobserve(read);
  }, [doc]);

  return kind;
}
