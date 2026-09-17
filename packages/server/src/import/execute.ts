/**
 * SONE server — carrying out an import plan (ADR-0044).
 *
 * One page at a time, one transaction each. Not one transaction for the whole
 * import: a partial import that stopped with a clear error and left twelve
 * pages is recoverable, and one giant transaction that rolls back an hour's
 * work on the last file is not.
 *
 * The plan is trusted here — its collisions are named, its depth is bounded, its
 * names are safe — because it was built from a parser that refuses rather than
 * guesses. This module's job is to write, and to report what it wrote.
 */

import crypto from 'node:crypto';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import {
  BLOCK_ATTRS,
  BLOCK_NODE_ATTRS,
  CANVAS_BACKGROUNDS,
  CANVAS_ITEM_KINDS,
  DOC_KEYS,
  addItem,
  setBackground,
  type CanvasBackground,
  type CanvasItemKind,
  type NewItem,
  PAGE_KEYS,
  SHARED_NODE_ATTRS,
  readEntryCover,
  readEntryIcon,
  readTitleColor,
  serialiseProps,
} from '@sone/core';

import { applyToDocument } from '../doc/docStore.js';
import { categoryOf, detectType, type FileStore } from '../files/store.js';
import { queryOne } from '../db/pool.js';
import { createEntry } from '../pages/createEntry.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { markdownToBlocks } from './markdown.js';
import type { ImportPlan } from './plan.js';

export interface ImportResult {
  /** Page ids, in the order they were created. */
  created: string[];
  /** Pages that were skipped because something of that name was already there. */
  collided: string[];
  /** A page the plan named and this could not write, with the reason. */
  failed: Array<{ path: string; error: string }>;
}

export interface ImportOptions {
  workspaceId: string;
  /**
   * Where an archive's files go, and the bytes to put there.
   *
   * Both or neither: without them a page's pictures arrive as blocks with an
   * `attachmentRef` and nothing behind it, which the editor shows as a picture
   * that failed to load. That is the honest rendering of a half-import, and it
   * is why the plan says whether files are coming.
   */
  store?: FileStore;
  /** The archive's `attachments/<name>` entries, by name. */
  attachments?: Map<string, Buffer>;
  /** The folder everything lands in. The root holds only folders (ADR-0019). */
  parentPageId: string;
  actorId: string | null;
  /**
   * What to do about a name that already exists.
   *
   * `skip` leaves the existing page alone; `duplicate` creates a second page
   * with the same title. There is no `overwrite`, deliberately: an import that
   * can replace a page somebody wrote is an import that can lose work nobody
   * asked it to touch, and "merge" is a decision this has no basis to make.
   */
  onCollision: 'skip' | 'duplicate';
}

/**
 * Build a page's body from parsed blocks.
 *
 * Through core's own attribute names and `serialiseProps`, so a document written
 * here is indistinguishable from one the editor wrote — the alternative is a
 * second opinion about the document format, held by the one module that only
 * ever writes and never reads it back.
 */
function writeBlocks(doc: Y.Doc, markdown: string, files: Map<string, UploadedFile>): void {
  const fragment = doc.getXmlFragment(DOC_KEYS.content);
  const blocks = markdownToBlocks(markdown);

  const elements = blocks.map((block) => {
    const element = new Y.XmlElement(block.type);
    element.setAttribute(BLOCK_ATTRS.id, crypto.randomUUID());
    /*
     * An archive's file id becomes ours.
     *
     * The reference is replaced rather than kept alongside: two ids on one
     * block would leave the question of which one wins to whatever reads it
     * next. A reference with no uploaded file keeps its `attachmentRef` and no
     * `fileId`, which is a picture the editor draws as missing — true, and
     * better than a `fileId` pointing at nothing.
     *
     * A picture is addressed, not identified: the image block has a `url` of
     * `/api/files/<id>` and no `fileId`, so that is what it gets. A file block
     * has the id, and the type and size the upload found out.
     */
    if (typeof block.props['attachmentRef'] === 'string') {
      const mapped = files.get(block.props['attachmentRef']);
      if (mapped) {
        delete block.props['attachmentRef'];
        if (block.type === 'image') {
          block.props['url'] = `/api/files/${mapped.id}`;
        } else {
          block.props['fileId'] = mapped.id;
          if (typeof block.props['mimeType'] !== 'string') block.props['mimeType'] = mapped.mime;
          if (typeof block.props['sizeBytes'] !== 'number') block.props['sizeBytes'] = mapped.sizeBytes;
          if (typeof block.props['category'] !== 'string') block.props['category'] = mapped.category;
        }
      }
    }

    /*
     * A node's attributes go where the editor reads them (ADR-0191).
     *
     * y-prosemirror builds a node from the element's attributes and never
     * looks inside `props`. Everything here used to go into the JSON — so an
     * imported heading was a heading at the default size, a ticked task was
     * open, a code block had no language, and a picture was an empty frame
     * with its address in a place nothing reads. `BLOCK_NODE_ATTRS` says, per
     * type, which keys are attributes; they are written with the type they
     * have (a level is a number, `checked` a boolean), because that is what
     * the editor writes and compares against.
     */
    const attrNames = new Set<string>([
      ...SHARED_NODE_ATTRS,
      ...(BLOCK_NODE_ATTRS[block.type] ?? []),
    ]);
    for (const key of attrNames) {
      const value = block.props[key];
      if (value === undefined || value === null || value === '') continue;
      // Yjs types the setter as string and stores whatever it is given, which
      // is how y-prosemirror itself writes a number or a boolean.
      element.setAttribute(key, value as string);
      delete block.props[key];
    }

    const props = serialiseProps(block.props);
    if (props) element.setAttribute(BLOCK_ATTRS.props, props);
    if (block.indent > 0) element.setAttribute(BLOCK_ATTRS.indent, String(block.indent));

    if (block.rich && block.rich.length > 0) {
      // With its marks: the delta shape is the one y-prosemirror writes.
      const text = new Y.XmlText();
      text.applyDelta(
        block.rich.map((op) => ({
          insert: op.insert,
          ...(op.attributes ? { attributes: op.attributes } : {}),
        })),
      );
      element.insert(0, [text]);
    } else if (block.text !== '') {
      const text = new Y.XmlText();
      text.insert(0, block.text);
      element.insert(0, [text]);
    }
    return element;
  });

  // An empty file still becomes a page with one paragraph: a page with no blocks
  // cannot be typed into, which is the state `seedEmptyPage` exists to avoid on
  // the client.
  if (elements.length === 0) {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.setAttribute(BLOCK_ATTRS.id, crypto.randomUUID());
    elements.push(paragraph);
  }

  fragment.delete(0, fragment.length);
  fragment.insert(0, elements);
}

/**
 * Build a board from the fence our export wrote (ADR-0191).
 *
 * Items are added in their stacking order, front last, so `addItem`'s
 * "put it on top" reproduces the order they had. Each gets a fresh id: an id
 * is only unique within its document, and this is a new document.
 */
function writeCanvas(doc: Y.Doc, markdown: string, files: Map<string, UploadedFile>): void {
  const fenced = markdownToBlocks(markdown).find((block) => block.type === 'canvas');
  if (!fenced) return;
  const background = fenced.props['background'];
  if ((CANVAS_BACKGROUNDS as readonly unknown[]).includes(background)) {
    setBackground(doc, background as CanvasBackground);
  }
  const items = Array.isArray(fenced.props['items']) ? (fenced.props['items'] as unknown[]) : [];
  const sorted = items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .sort((a, b) => String(a['z'] ?? '').localeCompare(String(b['z'] ?? '')));
  for (const item of sorted) {
    const kind = item['kind'];
    if (typeof kind !== 'string' || !(CANVAS_ITEM_KINDS as readonly string[]).includes(kind)) continue;
    const number = (key: string): number | undefined =>
      typeof item[key] === 'number' && Number.isFinite(item[key]) ? (item[key] as number) : undefined;
    const string = (key: string): string | undefined =>
      typeof item[key] === 'string' ? (item[key] as string) : undefined;
    const ref = string('attachmentRef');
    const mapped = ref ? files.get(ref) : undefined;
    // A picture whose file the archive did not carry is left out rather than
    // drawn as a broken frame in the middle of a board.
    if (kind === 'image' && !mapped) continue;
    const fresh: NewItem = { id: crypto.randomUUID(), kind: kind as CanvasItemKind, x: number('x') ?? 0, y: number('y') ?? 0 };
    const w = number('w');
    const h = number('h');
    const text = string('text');
    const colour = string('colour');
    const width = number('width');
    const fill = string('fill');
    const size = number('size');
    const filename = string('filename');
    if (w !== undefined) fresh.w = w;
    if (h !== undefined) fresh.h = h;
    if (text !== undefined) fresh.text = text;
    if (mapped) {
      fresh.fileId = mapped.id;
      fresh.sizeBytes = mapped.sizeBytes;
    }
    if (Array.isArray(item['points'])) {
      fresh.points = (item['points'] as unknown[]).filter((n): n is number => typeof n === 'number');
    }
    if (colour !== undefined) fresh.colour = colour;
    if (width !== undefined) fresh.width = width;
    if (fill !== undefined) fresh.fill = fill;
    if (size !== undefined) fresh.size = size;
    if (filename !== undefined) fresh.filename = filename;
    addItem(doc, fresh);
    if (item['locked'] === true) {
      const map = doc.getMap<Y.Map<unknown>>(DOC_KEYS.canvas);
      const last = [...map.keys()].at(-1);
      const entry = last ? map.get(last) : undefined;
      if (entry) entry.set('locked', true);
    }
  }
}

export async function executePlan(
  pool: Pool,
  plan: ImportPlan,
  options: ImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = { created: [], collided: [], failed: [] };
  /** Archive name → our file, so a picture used twice is stored once. */
  const uploaded = new Map<string, UploadedFile>();
  /** Which page each planned path became, so children can find their parent. */
  const madeByPath = new Map<string, string>();

  for (const page of plan.pages) {
    const path = page.path.join('/');

    if (page.collidesWith && options.onCollision === 'skip') {
      result.collided.push(path);
      // Mapped anyway, so a page *inside* a folder that already existed lands
      // in that folder rather than being orphaned or creating a second one.
      madeByPath.set(path, page.collidesWith);
      continue;
    }

    const parentPath = page.path.slice(0, -1).join('/');
    const parent = parentPath === '' ? options.parentPageId : madeByPath.get(parentPath);
    if (!parent) {
      // Its folder failed or was skipped without an id. Reported rather than
      // put somewhere plausible: an import that quietly reparents pages is one
      // whose result nobody can check against the archive.
      result.failed.push({ path, error: 'parent_missing' });
      continue;
    }

    try {
      const isCanvas = !page.isFolder && page.entry?.kind === 'canvas';
      const created = await createEntry(pool, {
        workspaceId: options.workspaceId,
        kind: page.isFolder ? 'folder' : isCanvas ? 'canvas' : 'page',
        title: page.title,
        parentPageId: parent,
        actorId: options.actorId,
      });

      // The look it had (ADR-0190): through the same readers the icon route
      // uses, so an archive cannot write a shape the interface would not.
      const look = page.entry?.icon;
      const icon = readEntryIcon(look);
      const titleColor = readTitleColor(look);
      // A cover that is a picture names its file the way an image block does
      // (ADR-0191); it is uploaded like the page's other files and the address
      // rewritten to the copy stored here.
      let coverRaw: unknown = page.entry?.cover;
      const coverUrl =
        coverRaw && typeof coverRaw === 'object' && (coverRaw as { kind?: unknown }).kind === 'image'
          ? (coverRaw as { url?: unknown }).url
          : undefined;
      const coverRef = typeof coverUrl === 'string' ? /^attachments\/(.+)$/.exec(coverUrl) : null;
      if (coverRef) {
        const files = await uploadFor(pool, `](attachments/${coverRef[1]})`, options, uploaded, created.id);
        const mapped = files.get(coverRef[1] ?? '');
        coverRaw = mapped ? { ...(coverRaw as object), url: `/api/files/${mapped.id}` } : null;
      }
      const cover = readEntryCover(coverRaw);
      const width =
        page.entry?.width === 'full' || page.entry?.width === 'column' ? page.entry.width : null;
      if (icon || titleColor || cover || width || page.entry?.template || page.entry?.locked) {
        await applyToDocument(
          pool,
          created.id,
          (doc) => {
            const map = doc.getMap(DOC_KEYS.page);
            if (icon || titleColor) {
              map.set(PAGE_KEYS.icon, { ...(icon ?? {}), ...(titleColor ? { titleColor } : {}) });
            }
            if (cover) map.set(PAGE_KEYS.cover, cover);
            if (width) map.set(PAGE_KEYS.width, width);
            if (page.entry?.template) map.set(PAGE_KEYS.template, true);
            if (page.entry?.locked) map.set(PAGE_KEYS.locked, true);
          },
          options.actorId,
        );
      }

      if (isCanvas) {
        // A board: its items out of the fence, its pictures uploaded like a
        // page's, each item added the way the editor adds one (ADR-0191).
        const files = await uploadFor(pool, page.markdown, options, uploaded, created.id);
        await applyToDocument(
          pool,
          created.id,
          (doc) => writeCanvas(doc, page.markdown, files),
          options.actorId,
        );
      } else if (!page.isFolder && page.markdown.trim() !== '') {
        // The files this page refers to, uploaded before its body is written so
        // the blocks can name them. Per page rather than all at once, because a
        // file belongs to the page it hangs on — that is how files are
        // authorised — and the first page that refers to one is the honest
        // answer to which page that is.
        const files = await uploadFor(pool, page.markdown, options, uploaded, created.id);
        await applyToDocument(
          pool,
          created.id,
          (doc) => writeBlocks(doc, page.markdown, files),
          options.actorId,
        );
      }
      await rematerialize(pool, created.id, options.workspaceId, options.actorId);

      madeByPath.set(path, created.id);
      result.created.push(created.id);
    } catch (error) {
      // One page's failure is one line in the result. The import carries on,
      // because twelve pages and a clear list of three that did not arrive is
      // more use than nothing and one error.
      result.failed.push({
        path,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return result;
}

/**
 * Upload the files one page refers to, and say what they became.
 *
 * Returns the mapping for *this* page's references only, but shares the
 * `uploaded` cache across the import: an archive where a logo appears on twenty
 * pages should store one file, not twenty copies of it.
 */
/** What an archive's file became here. */
interface UploadedFile {
  id: string;
  mime: string;
  sizeBytes: number;
  category: string;
}

async function uploadFor(
  pool: Pool,
  markdown: string,
  options: ImportOptions,
  uploaded: Map<string, UploadedFile>,
  pageId: string,
): Promise<Map<string, UploadedFile>> {
  const { store, attachments } = options;
  const mapping = new Map<string, UploadedFile>();
  if (!store || !attachments || attachments.size === 0) return mapping;

  // Two spellings: a link's `](attachments/<name>)`, and a board fence's
  // `"attachmentRef":"<name>"` (ADR-0191).
  const references = [
    ...markdown.matchAll(/\]\(attachments\/([^)]+)\)/g),
    ...markdown.matchAll(/"attachmentRef":"([^"]+)"/g),
  ];
  for (const [, reference] of references) {
    const name = reference ?? '';
    const already = uploaded.get(name);
    if (already) {
      mapping.set(name, already);
      continue;
    }

    const bytes = attachments.get(name);
    // A link to a file the archive does not contain. Left unresolved rather
    // than invented: the block keeps its reference and draws as missing.
    if (!bytes) continue;

    const detected = detectType(bytes);
    // Refused rather than stored as something we cannot describe: the download
    // route serves what the row says, and a wrong type is a file a browser
    // renders wrongly or refuses.
    if (!detected) continue;

    try {
      const stored = await store.put(bytes, detected.extension);
      const row = await queryOne<{ id: string }>(
        pool,
        `INSERT INTO files
           (workspace_id, page_id, filename, mime_type, size_bytes, sha256,
            storage, storage_key, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          options.workspaceId,
          pageId,
          // The archive's name, which for our own exports is a file id and for
          // somebody else's is a real name. Neither is wrong to show.
          name,
          detected.mime,
          stored.sizeBytes,
          stored.sha256,
          store.kind === 's3' ? 's3' : 'local',
          stored.key,
          options.actorId,
        ],
      );
      if (row) {
        const file: UploadedFile = {
          id: row.id,
          mime: detected.mime,
          sizeBytes: stored.sizeBytes,
          category: categoryOf(detected.mime),
        };
        uploaded.set(name, file);
        mapping.set(name, file);
      }
    } catch {
      // One file's failure is one missing picture, not a failed import.
    }
  }

  return mapping;
}
