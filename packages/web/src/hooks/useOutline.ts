/**
 * SONE web — the document outline.
 *
 * Derived from the Yjs document rather than from the editor view, so it works
 * on a page nobody is editing and does not depend on a mounted EditorView. The
 * tree walk comes from `readBlockTree` in @sone/core, which is the same
 * function the server's materialiser uses — so the outline cannot disagree with
 * the projection about where a heading is.
 *
 * Recomputed on document change, debounced. A heading appears as it is typed,
 * which means recomputing on every keystroke; a whole-document walk per
 * character is wasteful on a long page and the outline does not need to be that
 * immediate.
 */

import { readBlockTree } from '@sone/core';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

export interface OutlineEntry {
  /** Block id, which is also the DOM `data-block-id`, so scrolling can find it. */
  id: string;
  text: string;
  /** Heading level, 1–6. */
  level: number;
}

/** How long to wait after a change before rebuilding. */
const DEBOUNCE_MS = 250;

function buildOutline(doc: Y.Doc): OutlineEntry[] {
  const { blocks } = readBlockTree(doc);
  const entries: OutlineEntry[] = [];

  for (const block of blocks) {
    if (block.type !== 'heading') continue;
    const raw = block.props['level'];
    const level = typeof raw === 'number' && raw >= 1 && raw <= 6 ? raw : 2;
    entries.push({ id: block.id, text: block.text, level });
  }

  return entries;
}

export function useOutline(doc: Y.Doc | null): OutlineEntry[] {
  const [outline, setOutline] = useState<OutlineEntry[]>([]);

  useEffect(() => {
    if (!doc) {
      setOutline([]);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const rebuild = (): void => {
      setOutline(buildOutline(doc));
    };

    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(rebuild, DEBOUNCE_MS);
    };

    // Immediately once, so opening a page shows its outline without a pause.
    rebuild();
    doc.on('update', schedule);

    return () => {
      if (timer) clearTimeout(timer);
      doc.off('update', schedule);
    };
  }, [doc]);

  return outline;
}

/**
 * Scroll a block into view.
 *
 * Finds the element by the `data-block-id` attribute the editor schema emits.
 * Going through the DOM rather than through ProseMirror positions means this
 * works for a read-only render too, and needs no editor reference.
 *
 * `center` rather than `start`: a heading pinned to the very top of the
 * viewport hides the paragraph that follows it, which is what the person
 * actually wanted to read.
 */
export function scrollToBlock(blockId: string): boolean {
  const element = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}
