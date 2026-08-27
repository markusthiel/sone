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
  BLOCK_KEYS,
  COLLECTION_KEYS,
  DOC_KEYS,
  FIELD_KEYS,
  META_KEYS,
  PAGE_KEYS,
  VIEW_KEYS,
  compareSiblings,
  type StoredValue,
} from '@sone/core';
import * as Y from 'yjs';

import { normaliseText, propsToText, xmlFragmentToText } from './plainText.js';

export interface ReadBlock {
  id: string;
  type: string;
  parentId: string | null;
  idx: string;
  props: Record<string, unknown>;
  plainText: string;
}

export interface ReadPage {
  title: string;
  icon: unknown | null;
  coverUrl: string | null;
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

export interface ReadDocument {
  schemaVersion: number;
  page: ReadPage;
  blocks: ReadBlock[];
  properties: Map<string, StoredValue>;
  collection: ReadCollection | null;
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
  return {
    title: normaliseText(asString(map.get(PAGE_KEYS.title)) ?? ''),
    icon: map.get(PAGE_KEYS.icon) ?? null,
    coverUrl: asString(map.get(PAGE_KEYS.coverUrl)),
    parentPageId: asString(map.get(PAGE_KEYS.parentPageId)),
    collectionId: asString(map.get(PAGE_KEYS.collectionId)),
    idx: idx ?? 'a0',
    archivedAt: asString(map.get(PAGE_KEYS.archivedAt)),
  };
}

function readBlocks(doc: Y.Doc, warnings: string[]): ReadBlock[] {
  const blocks = doc.getMap(DOC_KEYS.blocks);
  const content = doc.getMap(DOC_KEYS.content);
  const out: ReadBlock[] = [];

  for (const [id, raw] of blocks.entries()) {
    if (!(raw instanceof Y.Map)) {
      warnings.push(`block ${id}: not a Y.Map, skipped`);
      continue;
    }
    const type = asString(raw.get(BLOCK_KEYS.type));
    if (type === null) {
      warnings.push(`block ${id}: missing type, skipped`);
      continue;
    }
    const idx = asString(raw.get(BLOCK_KEYS.idx));
    if (idx === null) {
      warnings.push(`block ${id}: missing idx, defaulted`);
    }

    const props = asRecord(raw.get(BLOCK_KEYS.props));

    let inline = '';
    const fragment = content.get(id);
    if (
      fragment instanceof Y.XmlFragment ||
      fragment instanceof Y.XmlElement ||
      fragment instanceof Y.XmlText
    ) {
      try {
        inline = xmlFragmentToText(fragment);
      } catch (err) {
        warnings.push(
          `block ${id}: content extraction failed (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
      }
    }

    out.push({
      id,
      type,
      parentId: asString(raw.get(BLOCK_KEYS.parentId)),
      idx: idx ?? 'a0',
      props,
      plainText: normaliseText([inline, propsToText(type, props)].join(' ')),
    });
  }

  // (idx, id), never idx alone — concurrent inserts into the same gap produce
  // identical keys. See compareSiblings in @sone/core.
  return out.sort(compareSiblings);
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

function readCollection(doc: Y.Doc, warnings: string[]): ReadCollection | null {
  // A page without a collection has no such map; Yjs would create an empty
  // one on access, so check the root keys first.
  if (!doc.share.has(DOC_KEYS.collection)) return null;

  const map = doc.getMap(DOC_KEYS.collection);
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

export function readDocument(doc: Y.Doc): ReadDocument {
  const warnings: string[] = [];
  const meta = doc.getMap(DOC_KEYS.meta);

  return {
    schemaVersion: asNumber(meta.get(META_KEYS.schemaVersion), 1),
    page: readPageMeta(doc, warnings),
    blocks: readBlocks(doc, warnings),
    properties: readProperties(doc, warnings),
    collection: readCollection(doc, warnings),
    warnings,
  };
}
