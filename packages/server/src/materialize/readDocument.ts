/**
 * SONE — reading a page Y.Doc into plain objects.
 *
 * The only place that knows how to interpret the CRDT layout defined in
 * @sone/core's docSchema. Everything downstream works on plain data, which
 * keeps the materialiser testable without a Yjs document in hand.
 *
 * Reads are defensive throughout: a document is user input that may have been
 * written by an older version, a buggy client, or a third-party block type.
 * A malformed field degrades that field, never the whole page.
 */

import {
  readTags,
  type EntryKind,
  COLLECTION_KEYS,
  DOC_KEYS,
  FIELD_KEYS,
  META_KEYS,
  ENTRY_KINDS,
  PAGE_KEYS,
  VIEW_KEYS,
  compareSiblings,
  mentionsIn,
  readBlockTree,
  type StoredValue,
  canvasText,
  readThreads,
  writersIn,
  type CommentThread,
} from '@sone/core';
import * as Y from 'yjs';

import { normaliseText, propsToText } from './plainText.js';

export interface ReadBlock {
  id: string;
  type: string;
  parentId: string | null;
  /**
   * Depth-first ordinal within the page, zero-padded so it sorts
   * lexicographically in the `idx` column.
   *
   * Derived from tree position, not authored: within a page Yjs owns order and
   * there is no fractional index to carry (ADR-0015).
   */
  idx: string;
  props: Record<string, unknown>;
  plainText: string;
}

export interface ReadPage {
  /** 'page' or 'folder'. Absent in the document means 'page' (ADR-0019). */
  kind: EntryKind;
  /** Tag names as typed, cleaned and de-duplicated (ADR-0020). */
  tags: string[];
  title: string;
  icon: unknown | null;
  coverUrl: string | null;
  /** 'column' or 'full'; null means the reader's default. */
  width: 'column' | 'full' | null;
  /** Whether the page is offered as a template (ADR-0045). */
  template: boolean;
  /** Locked against accidental editing (ADR-0049). */
  locked: boolean;
  parentPageId: string | null;
  collectionId: string | null;
  idx: string;
  archivedAt: string | null;
}

export interface ReadField {
  id: string;
  name: string;
  description: string | null;
  fieldType: string;
  config: Record<string, unknown>;
  idx: string;
  schemaVersion: number;
}

export interface ReadView {
  id: string;
  name: string;
  viewType: string;
  idx: string;
  definition: Record<string, unknown>;
  schemaVersion: number;
}

export interface ReadCollection {
  titleFieldId: string;
  fields: ReadField[];
  views: ReadView[];
}

/** One projected thread. */
export interface ReadThread {
  id: string;
  quote: string;
  resolved: boolean;
  detached: boolean;
  messages: number;
  openedBy: string | null;
  createdAt: number;
  lastMessageAt: number;
  /** Every message, for the search index. */
  text: string;
}

export interface ReadDocument {
  schemaVersion: number;
  page: ReadPage;
  blocks: ReadBlock[];
  /**
   * A canvas's text, for the search index (ADR-0043).
   *
   * Not blocks: a canvas has no blocks and inventing some would put fake rows in
   * the block table, which the tree and the outline read. The text goes into the
   * index and nowhere else, which is exactly what a canvas can honestly claim.
   */
  canvasText: string;
  /**
   * The page's comment threads, resolved against the document (ADR-0046).
   *
   * Read here rather than in the materialiser because this is where the Yjs
   * document is open: whether a thread is *detached* is a question only the
   * document can answer, and answering it from the projection would mean
   * storing an anchor the database cannot interpret.
   */
  comments: ReadThread[];
  /**
   * The threads themselves, for the notification step (ADR-0052).
   *
   * Beside the projected rows rather than instead of them: the rows are what the
   * database stores, and this is what decides who was addressed — which needs
   * the messages, and the rows deliberately do not carry them.
   */
  commentThreads: CommentThread[];
  /**
   * Everybody named in the page's text, with the block naming them (ADR-0085).
   *
   * Read here for the same reason the threads are: this is where the document
   * is open, and a mention is a node in it rather than a row. The materialiser
   * is handed this result and not the document.
   */
  mentions: Array<{ userId: string; blockId: string }>;
  /**
   * Who has writing in this page, as the document names them (ADR-0050).
   *
   * A user id, or a `guest:` key. Read here because this is where the document
   * is open — the materialiser is handed this result and not the document, which
   * is why the keys travel rather than the map.
   *
   * Whose writing is *still here*, from `writersIn` rather than from the raw
   * mapping (ADR-0116): the mapping lists everybody who has opened the page, so
   * read raw this made `author:` a filter for who had looked.
   */
  authorKeys: string[];
  properties: Map<string, StoredValue>;
  /**
   * Every collection this page holds, keyed by id.
   *
   * A page may hold several (ADR-0021). Empty for a page that holds none, which
   * is most of them.
   */
  collections: Map<string, ReadCollection>;
  /** Non-fatal problems encountered while reading. Recorded, not thrown. */
  warnings: string[];
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const asRecord = (v: unknown): Record<string, unknown> => {
  if (v instanceof Y.Map) return v.toJSON() as Record<string, unknown>;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
};

function readPageMeta(doc: Y.Doc, warnings: string[]): ReadPage {
  const map = doc.getMap(DOC_KEYS.page);
  const idx = asString(map.get(PAGE_KEYS.idx));
  if (idx === null) {
    // A missing index would make the page unsortable among its siblings.
    warnings.push('page.idx missing; defaulting to "a0"');
  }
  // An unrecognised or absent kind reads as 'page' rather than being rejected:
  // every document written before folders existed has no kind, and a newer
  // client could introduce one this build does not know (ADR-0019).
  // Checked against ENTRY_KINDS rather than a list written out here.
  //
  // It was written out here, with two values, and adding 'row' to the model did
  // not reach it — so every row was read back as a page, appeared in the tree
  // and belonged to no collection. The constant exists precisely so the answer
  // is in one place.
  const rawKind = asString(map.get(PAGE_KEYS.kind));
  const known = (ENTRY_KINDS as readonly string[]).includes(rawKind ?? '');
  const kind: EntryKind = known ? (rawKind as EntryKind) : 'page';
  if (rawKind !== null && !known) {
    warnings.push(`page.kind "${rawKind}" is not recognised; treated as a page`);
  }

  return {
    kind,
    // Read through core, so the editor and the projection cannot disagree about
    // what counts as the same tag.
    tags: readTags(doc),
    title: normaliseText(asString(map.get(PAGE_KEYS.title)) ?? ''),
    icon: map.get(PAGE_KEYS.icon) ?? null,
    coverUrl: asString(map.get(PAGE_KEYS.coverUrl)),
    // Only the two values, and anything else is treated as absent: a document is
    // written by clients and a width the stylesheet does not know would be a
    // page nobody can read.
    template: map.get(PAGE_KEYS.template) === true,
    // Projected so the tree can draw a padlock without opening every document
    // (ADR-0049). The document is still where it lives.
    locked: map.get(PAGE_KEYS.locked) === true,
    width: (() => {
      const value = asString(map.get(PAGE_KEYS.width));
      return value === 'column' || value === 'full' ? value : null;
    })(),
    parentPageId: asString(map.get(PAGE_KEYS.parentPageId)),
    collectionId: asString(map.get(PAGE_KEYS.collectionId)),
    idx: idx ?? 'a0',
    archivedAt: asString(map.get(PAGE_KEYS.archivedAt)),
  };
}

/**
 * Project the block tree into flat rows.
 *
 * The tree walk itself lives in @sone/core so the editor and the materialiser
 * cannot disagree about how props are encoded or where a block boundary is.
 * This function only flattens the result and derives the sort key.
 */
function readBlocks(doc: Y.Doc, warnings: string[]): ReadBlock[] {
  const { blocks, warnings: treeWarnings } = readBlockTree(doc);
  warnings.push(...treeWarnings);

  return blocks.map((block) => ({
    id: block.id,
    type: block.type,
    parentId: block.parentId,
    // Padded so the text column sorts in reading order. Six digits allows
    // 999,999 blocks per page, far past the point a page is usable.
    idx: String(block.position).padStart(6, '0'),
    props: block.props,
    plainText: normaliseText([block.text, propsToText(block.type, block.props)].join(' ')),
  }));
}

function readProperties(doc: Y.Doc, warnings: string[]): Map<string, StoredValue> {
  const map = doc.getMap(DOC_KEYS.properties);
  const out = new Map<string, StoredValue>();

  for (const [fieldId, raw] of map.entries()) {
    const value = raw instanceof Y.Map ? raw.toJSON() : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      warnings.push(`property ${fieldId}: not an object, skipped`);
      continue;
    }
    const kind = (value as { kind?: unknown }).kind;
    if (typeof kind !== 'string') {
      warnings.push(`property ${fieldId}: missing kind, skipped`);
      continue;
    }
    out.set(fieldId, value as StoredValue);
  }
  return out;
}

/** Read one collection out of its own map. */
function readOneCollection(
  map: Y.Map<unknown>,
  warnings: string[],
): ReadCollection | null {
  if (map.size === 0) return null;

  const titleFieldId = asString(map.get(COLLECTION_KEYS.titleFieldId));
  if (titleFieldId === null) {
    warnings.push('collection: missing titleFieldId, collection ignored');
    return null;
  }

  const fields: ReadField[] = [];
  const fieldsMap = map.get(COLLECTION_KEYS.fields);
  if (fieldsMap instanceof Y.Map) {
    for (const [id, raw] of fieldsMap.entries()) {
      if (!(raw instanceof Y.Map)) {
        warnings.push(`field ${id}: not a Y.Map, skipped`);
        continue;
      }
      const fieldType = asString(raw.get(FIELD_KEYS.fieldType));
      if (fieldType === null) {
        warnings.push(`field ${id}: missing fieldType, skipped`);
        continue;
      }
      fields.push({
        id,
        name: asString(raw.get(FIELD_KEYS.name)) ?? '',
        description: asString(raw.get(FIELD_KEYS.description)),
        fieldType,
        config: asRecord(raw.get(FIELD_KEYS.config)),
        idx: asString(raw.get(FIELD_KEYS.idx)) ?? 'a0',
        schemaVersion: asNumber(raw.get(FIELD_KEYS.schemaVersion), 1),
      });
    }
  }

  const views: ReadView[] = [];
  const viewsMap = map.get(COLLECTION_KEYS.views);
  if (viewsMap instanceof Y.Map) {
    for (const [id, raw] of viewsMap.entries()) {
      if (!(raw instanceof Y.Map)) {
        warnings.push(`view ${id}: not a Y.Map, skipped`);
        continue;
      }
      const viewType = asString(raw.get(VIEW_KEYS.viewType));
      if (viewType === null) {
        warnings.push(`view ${id}: missing viewType, skipped`);
        continue;
      }
      views.push({
        id,
        name: asString(raw.get(VIEW_KEYS.name)) ?? '',
        viewType,
        idx: asString(raw.get(VIEW_KEYS.idx)) ?? 'a0',
        definition: asRecord(raw.get(VIEW_KEYS.definition)),
        schemaVersion: asNumber(raw.get(VIEW_KEYS.schemaVersion), 1),
      });
    }
  }

  if (!fields.some((f) => f.id === titleFieldId)) {
    warnings.push(
      `collection: titleFieldId ${titleFieldId} is not among the fields`,
    );
  }

  return {
    titleFieldId,
    fields: fields.sort(compareSiblings),
    views: views.sort(compareSiblings),
  };
}

/**
 * Every collection on this page, keyed by id.
 *
 * A page may hold several (ADR-0021), so the map is keyed by collection id and
 * each value is one collection.
 *
 * A map written under the 0.2.0 shape — one collection, its keys at the top
 * level — is read as a single collection whose id is the page's own. That is
 * what 0.2.0 stored, so an old document keeps working without a migration and
 * without a schema-version bump: the projection it produces is the same one it
 * always produced.
 */
function readCollections(
  doc: Y.Doc,
  pageId: string | null,
  warnings: string[],
): Map<string, ReadCollection> {
  const out = new Map<string, ReadCollection>();

  // A page without collections has no such map; Yjs would create an empty one
  // on access, so check the root keys first.
  if (!doc.share.has(DOC_KEYS.collection)) return out;

  const root = doc.getMap(DOC_KEYS.collection);
  if (root.size === 0) return out;

  // The old shape: recognised by its own keys rather than by guessing.
  if (root.has(COLLECTION_KEYS.titleFieldId)) {
    const single = readOneCollection(root, warnings);
    if (single && pageId) out.set(pageId, single);
    else if (single) warnings.push('collection: no page id, collection ignored');
    return out;
  }

  for (const [collectionId, raw] of root.entries()) {
    if (!(raw instanceof Y.Map)) {
      warnings.push(`collection ${collectionId}: not a Y.Map, skipped`);
      continue;
    }
    const parsed = readOneCollection(raw, warnings);
    if (parsed) out.set(collectionId, parsed);
  }
  return out;
}

/**
 * Parse a document.
 *
 * `pageId` is required, not optional. It was optional for one commit and both
 * call sites omitted it, which silently disabled the compatibility path for
 * documents written under the 0.2.0 collection shape — an optional parameter
 * that changes behaviour when omitted is a trap, and this one caught me
 * immediately.
 */
export function readDocument(doc: Y.Doc, pageId: string | null): ReadDocument {
  const warnings: string[] = [];
  const meta = doc.getMap(DOC_KEYS.meta);
  const page = readPageMeta(doc, warnings);

  return {
    schemaVersion: asNumber(meta.get(META_KEYS.schemaVersion), 1),
    page,
    blocks: readBlocks(doc, warnings),
    canvasText: canvasText(doc),
    // Who has writing here, not who has had the page open (ADR-0116). Read raw,
    // `author:markus` matched every page he had ever looked at.
    authorKeys: [...writersIn(doc).keys()],
    commentThreads: readThreads(doc),
    mentions: mentionsIn(doc),
    comments: readThreads(doc).map((thread) => ({
      id: thread.id,
      quote: thread.quote,
      resolved: thread.resolved,
      // Its text is gone. The one state somebody should be able to find
      // deliberately, so it is projected rather than recomputed on read.
      detached: thread.range === null,
      messages: thread.messages.length,
      openedBy: thread.messages[0]?.author ?? null,
      createdAt: thread.createdAt,
      lastMessageAt: thread.messages.at(-1)?.at ?? thread.createdAt,
      text: thread.messages.map((one) => one.text).join('\n'),
    })),
    properties: readProperties(doc, warnings),
    collections: readCollections(doc, pageId, warnings),
    warnings,
  };
}
