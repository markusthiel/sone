/**
 * SONE — the persisted Yjs document shape.
 *
 * This file is the contract between the editor, the sync server and the
 * materialiser. It lives in `core` precisely so that no component can invent
 * its own idea of where data sits. Changing any key here is a schema change:
 * bump SCHEMA_VERSION and add a migration.
 *
 * One Y.Doc per page. Layout:
 *
 *   meta        Y.Map    schemaVersion, createdWith
 *   page        Y.Map    title, icon, coverUrl, parentPageId, collectionId,
 *                        idx, archivedAt
 *   blocks      Y.Map    blockId -> Y.Map { type, parentId, idx, props }
 *   content     Y.Map    blockId -> Y.XmlFragment (inline text, ProseMirror's)
 *   properties  Y.Map    fieldId -> StoredValue (set only on collection rows)
 *   collection  Y.Map    present only when this page owns a collection:
 *                        titleFieldId, fields Y.Map, views Y.Map
 *
 * Inline text lives only in `content`, never mirrored into `props`. Two
 * representations of the same text is how documents diverge.
 */

export const DOC_KEYS = {
  meta: 'meta',
  page: 'page',
  blocks: 'blocks',
  content: 'content',
  properties: 'properties',
  collection: 'collection',
} as const;

export const META_KEYS = {
  schemaVersion: 'schemaVersion',
  createdWith: 'createdWith',
} as const;

export const PAGE_KEYS = {
  title: 'title',
  icon: 'icon',
  coverUrl: 'coverUrl',
  parentPageId: 'parentPageId',
  collectionId: 'collectionId',
  idx: 'idx',
  archivedAt: 'archivedAt',
} as const;

export const BLOCK_KEYS = {
  type: 'type',
  parentId: 'parentId',
  idx: 'idx',
  props: 'props',
} as const;

export const COLLECTION_KEYS = {
  titleFieldId: 'titleFieldId',
  fields: 'fields',
  views: 'views',
} as const;

export const FIELD_KEYS = {
  name: 'name',
  description: 'description',
  fieldType: 'fieldType',
  config: 'config',
  idx: 'idx',
  schemaVersion: 'schemaVersion',
} as const;

export const VIEW_KEYS = {
  name: 'name',
  viewType: 'viewType',
  idx: 'idx',
  definition: 'definition',
  schemaVersion: 'schemaVersion',
} as const;

/**
 * The root block of a page document.
 *
 * Its id equals the page id, which makes the block tree self-rooting and
 * removes a null-parent special case from every traversal.
 */
export const rootBlockId = (pageId: string): string => pageId;

/** Sync channel name for a page document. */
export const docChannel = (pageId: string): string => `page:${pageId}`;
