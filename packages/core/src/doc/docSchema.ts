/**
 * SONE — the persisted Yjs document shape.
 *
 * The contract between the editor, the sync server and the materialiser. It
 * lives in `core` so no component can invent its own idea of where data sits.
 * Changing any key here is a schema change: bump SCHEMA_VERSION and add a
 * migration (see migrations.ts).
 *
 * One Y.Doc per page:
 *
 *   meta        Y.Map          schemaVersion, createdWith
 *   page        Y.Map          title, icon, coverUrl, parentPageId,
 *                              collectionId, idx, archivedAt
 *   content     Y.XmlFragment  the page body — the entire block tree
 *   properties  Y.Map          fieldId -> StoredValue (collection rows only)
 *   collection  Y.Map          titleFieldId, fields, views (owners only)
 *
 * ## Why one fragment per page
 *
 * The first version of this schema stored blocks as a flat Y.Map plus one
 * Y.XmlFragment per block. That was a mistake, corrected before any data
 * existed (ADR-0015).
 *
 * `y-prosemirror` binds one ProseMirror instance to one Y.XmlFragment. A
 * fragment per block therefore means an editor instance per block — and then
 * selecting three paragraphs and pressing Delete is a selection across
 * instance boundaries, which has to be built from scratch. Craft and Notion
 * handle that natively because they have one instance per page. It is not a
 * nicety; it is the difference between an editor that feels solid and one that
 * does not.
 *
 * So the block tree lives inside a single fragment as nested XML elements, and
 * ProseMirror owns it directly.
 *
 * ## Consequences for order
 *
 * Within a page, order is the position of an element in the fragment. Yjs
 * resolves concurrent insertion itself, so blocks carry no fractional index
 * and there is no tie to break.
 *
 * Fractional indices remain in use where the ordered collection is *not* a
 * single CRDT sequence: the page tree, collection rows, fields and views. The
 * `(idx, id)` tie-breaking rule still applies there.
 *
 * ## Database blocks are still not editor nodes
 *
 * A `collectionView` element is a leaf as far as ProseMirror is concerned. Its
 * node view mounts a separate renderer that queries the materialised tables.
 * Rows as editor nodes collapse past a few thousand entries (ADR-0004).
 */

export const DOC_KEYS = {
  meta: 'meta',
  page: 'page',
  /** The whole page body. One fragment; see the note above. */
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
  /** Fractional index among sibling pages, not among blocks. */
  idx: 'idx',
  collectionId: 'collectionId',
  archivedAt: 'archivedAt',
} as const;

/**
 * Attributes carried by every block element.
 *
 * Y.XmlElement attributes are strings, so anything structured is JSON-encoded
 * into `props`. Keeping the id as its own attribute rather than inside `props`
 * means a block can be located without parsing.
 */
export const BLOCK_ATTRS = {
  /** Stable block id (uuid). Survives moves and edits. */
  id: 'id',
  /** JSON-encoded block-specific settings. Never derived values. */
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
 * Block types that may contain other blocks.
 *
 * Used by the materialiser to decide whether to descend, and by the editor
 * schema to set `content`. A type absent from this set is a leaf, which is the
 * correct default for a new or third-party type.
 */
export const CONTAINER_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'bulletList',
  'numberedList',
  'todo',
  'toggle',
  'quote',
  'callout',
  'columns',
  'column',
]);

/**
 * Block types holding inline text that ProseMirror manages.
 *
 * A type in neither this set nor CONTAINER_BLOCK_TYPES is an atom: an image, a
 * divider, an embedded database view.
 */
export const INLINE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'numberedList',
  'todo',
  'toggle',
  'quote',
  'callout',
  'code',
]);

/** Sync channel name for a page document. */
export const docChannel = (pageId: string): string => `page:${pageId}`;
