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

import { DOC_KEYS, readBlockTree, readCanvas } from '@sone/core';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

export interface DocFile {
  /** Block id, so the entry can scroll to where it sits. */
  blockId: string;
  fileId: string | null;
  filename: string;
  mimeType: string;
  /**
   * 'image' | 'pdf' | 'text' | 'document' | 'archive', from the server — or
   * 'video' for an uploaded video (ADR-0193).
   *
   * The server's categories come from a file block, which a video is not: a
   * video is its own block with its own node view (ADR-0037). It is still an
   * upload sitting in the page, counting against the page's storage, and
   * leaving it out of the file list was the same omission an image shown as a
   * card had.
   */
  category: string;
  sizeBytes: number | null;
  /**
   * How the block draws it: 'card', 'line' or 'full' (ADR-0159).
   *
   * Part of what the page holds rather than a detail of the block, because a
   * PDF shown as a card is a file on the page whose *pages* are not on it — and
   * a comment about a place inside it has nowhere to point.
   */
  display: string;
}

export interface DocImage {
  blockId: string;
  url: string;
  alt: string;
  /**
   * True for a picture the document holds as a *file* block (ADR-0193).
   *
   * Choosing "card" or "line" for an image converts the block — an image is a
   * file with a special way of being looked at, and the three layouts are the
   * file block's. The picture is still in the page, so it is still in this
   * list; the flag is here because the panel cannot offer the same things for
   * it — there is no picture on screen to jump to, only a row naming one.
   */
  asFile?: boolean;
  /**
   * True for a picture placed on a canvas.
   *
   * It has no block, so there is nowhere to scroll to — the panel offers no
   * "show me where" for these rather than pretending a scroll would find it.
   */
  onCanvas?: boolean;
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

  /*
   * A board's pictures.
   *
   * This walked the block tree, and a canvas has no blocks — so a picture placed
   * on a board was uploaded to the page, counted against the page's storage, and
   * then missing from the page's own list of what it holds. A panel that omits
   * something the page is carrying reads as a broken panel.
   *
   * They carry no block id, because there is no block: the panel offers no "show
   * me where" for them rather than pretending a scroll would find it.
   */
  for (const item of readCanvas(doc)) {
    if (item.kind !== 'image' || !item.fileId) continue;
    images.push({
      blockId: item.id,
      onCanvas: true,
      url: `/api/files/${item.fileId}`,
      // The name it was uploaded with, which is the only description a picture
      // dropped on a board has — nobody types alt text into a whiteboard.
      alt: item.filename ?? '',
    });
  }

  for (const block of blocks) {
    if (block.type === 'file') {
      const fileId = text(block.props['fileId']) || null;
      const category = text(block.props['category'], 'document');

      /*
       * A picture shown as a card or a line is still a picture (ADR-0193).
       *
       * Reported as: "it does not appear in the sidebar — as a card or a line.
       * As a proper image I see it there." Both blocks hold the same upload;
       * the panel was reading the block's *type* where the question is what the
       * page is carrying. An image that leaves the image list the moment it is
       * shown smaller reads as the list being wrong, which is the same
       * reasoning that already put a board's pictures in it.
       */
      if (category === 'image' && fileId) {
        images.push({
          blockId: block.id,
          asFile: true,
          url: `/api/files/${fileId}`,
          // The name it was uploaded with: a card names the file, so that is
          // what somebody recognises this row by.
          alt: text(block.props['filename']),
        });
      }

      files.push({
        blockId: block.id,
        fileId,
        filename: text(block.props['filename']),
        mimeType: text(block.props['mimeType']),
        category,
        sizeBytes: number(block.props['sizeBytes']),
        // Absent means a card, which is what a file block was before it could
        // be anything else.
        display: text(block.props['display'], 'card'),
      });
      continue;
    }
    /*
     * An uploaded video is a file on the page (ADR-0193).
     *
     * Reported alongside the card underlines: *„Unter Dateien in der
     * Seitenleiste müsste doch auch das Video erscheinen oder?"* — yes. It is
     * an upload, it is served from the same place, and it is the largest thing
     * most pages carry.
     *
     * Only `source: 'file'`. An embedded video is somebody else's address and a
     * stream is a manifest; neither is a file this instance holds, and listing
     * them under "files" would offer a download of something that is not here.
     * The name is the block's title, which is the filename it was uploaded
     * with — and 'video' is a category of this list's own making, since the
     * server's categories belong to a file block.
     */
    if (block.type === 'video' && text(block.props['source']) === 'file') {
      const fileId = text(block.props['fileId']) || null;
      files.push({
        blockId: block.id,
        fileId,
        filename: text(block.props['title']),
        mimeType: '',
        category: 'video',
        // A video block stores no size: nothing has ever needed it, and it is
        // not worth a migration to fill this column.
        sizeBytes: null,
        // 'player', 'card' or 'link' — never 'full', which is what the comments
        // panel looks for when it asks which documents have places inside them.
        display: text(block.props['display'], 'player'),
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
