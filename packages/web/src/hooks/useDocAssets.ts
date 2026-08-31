/**
 * SONE web — what a document refers to: its files, its images and its links.
 *
 * Read from the Yjs document, like the outline and the task list, rather than
 * from the editor view or from a server index. Three reasons, and the third is
 * the one that decided it:
 *
 *  - it works on a page nobody is editing, and needs no mounted EditorView;
 *  - it cannot disagree with the page about what is in it, because it is reading
 *    the page;
 *  - and it needs nothing new stored. An index of every link in every document
 *    would be a second source of truth to keep in step, and a panel that lists
 *    what is on screen is not worth a migration.
 *
 * Blocks come from `readBlockTree`, the same walk the materialiser uses — an
 * image and a file are atoms, and every ProseMirror attribute they carry arrives
 * in `props`.
 *
 * Links do not. They are inline marks, and `readBlockTree` flattens text without
 * them, so the fragment is walked here for its deltas. That is the only reason
 * this hook touches Yjs directly.
 */

import { DOC_KEYS, readBlockTree } from '@sone/core';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

export interface DocFile {
  /** Block id, so the entry can scroll to where it sits. */
  blockId: string;
  fileId: string | null;
  filename: string;
  mimeType: string;
  /** 'image' | 'pdf' | 'text' | 'document' | 'archive', from the server. */
  category: string;
  sizeBytes: number | null;
}

export interface DocImage {
  blockId: string;
  url: string;
  alt: string;
}

export interface DocLink {
  blockId: string;
  href: string;
  /** The text the link is on, which is what somebody recognises it by. */
  text: string;
}

export interface DocAssets {
  files: DocFile[];
  images: DocImage[];
  links: DocLink[];
}

const EMPTY: DocAssets = { files: [], images: [], links: [] };

/** How long to wait after a change before rebuilding, as the outline does. */
const DEBOUNCE_MS = 250;

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Collect the links in one fragment.
 *
 * Adjacent runs carrying the same href are joined: a link whose text is partly
 * bold arrives as several deltas, and listing it three times would say there are
 * three links where there is one.
 */
function collectLinks(container: Y.XmlFragment | Y.XmlElement, blockId: string | null): DocLink[] {
  const found: DocLink[] = [];

  for (let i = 0; i < container.length; i++) {
    const child: unknown = container.get(i);

    if (child instanceof Y.XmlText) {
      if (blockId === null) continue;
      for (const part of child.toDelta() as Array<{
        insert?: unknown;
        attributes?: Record<string, unknown>;
      }>) {
        const mark = part.attributes?.['link'];
        const href =
          mark && typeof mark === 'object'
            ? text((mark as Record<string, unknown>)['href'])
            : '';
        if (href === '' || typeof part.insert !== 'string') continue;

        const last = found[found.length - 1];
        if (last && last.href === href && last.blockId === blockId) {
          last.text += part.insert;
        } else {
          found.push({ blockId, href, text: part.insert });
        }
      }
      continue;
    }

    if (child instanceof Y.XmlElement) {
      const own = child.getAttribute('id');
      found.push(...collectLinks(child, typeof own === 'string' && own ? own : blockId));
    }
  }

  return found;
}

/**
 * Read a document's files, images and links.
 *
 * Exported apart from the hook so it can be tested against a real Y.Doc: the
 * interesting parts are the walk and the joining of adjacent link runs, and
 * neither of them needs React to be involved.
 */
export function readDocAssets(doc: Y.Doc): DocAssets {
  const { blocks } = readBlockTree(doc);

  const files: DocFile[] = [];
  const images: DocImage[] = [];

  for (const block of blocks) {
    if (block.type === 'file') {
      files.push({
        blockId: block.id,
        fileId: text(block.props['fileId']) || null,
        filename: text(block.props['filename']),
        mimeType: text(block.props['mimeType']),
        category: text(block.props['category'], 'document'),
        sizeBytes: number(block.props['sizeBytes']),
      });
      continue;
    }
    if (block.type === 'image') {
      const url = text(block.props['url']);
      // An image whose upload is in flight or has failed has no URL. Listed
      // anyway, under the name it was uploaded with where there is one: a block
      // that is on the page and missing from the list reads as the list being
      // wrong.
      images.push({
        blockId: block.id,
        url,
        alt: text(block.props['alt']) || text(block.props['filename']),
      });
    }
  }

  return {
    files,
    images,
    links: collectLinks(doc.getXmlFragment(DOC_KEYS.content), null),
  };
}

export function useDocAssets(doc: Y.Doc | null): DocAssets {
  const [assets, setAssets] = useState<DocAssets>(EMPTY);

  useEffect(() => {
    if (!doc) {
      setAssets(EMPTY);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const rebuild = (): void => setAssets(readDocAssets(doc));
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(rebuild, DEBOUNCE_MS);
    };

    // Once immediately, so opening a page does not show an empty list for a
    // quarter of a second and then fill it.
    rebuild();
    doc.on('update', schedule);

    return () => {
      if (timer) clearTimeout(timer);
      doc.off('update', schedule);
    };
  }, [doc]);

  return assets;
}
