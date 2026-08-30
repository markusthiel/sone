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

/**
 * What a tree entry is.
 *
 * A folder organises; a page holds writing. A folder may contain both kinds, a
 * page may contain nothing (ADR-0019).
 *
 * An absent value reads as 'page', so every document written before folders
 * existed is a page without needing a migration.
 */
/**
 * What an entry is.
 *
 * Folders organise, pages hold writing, and rows belong to a collection
 * (ADR-0019, ADR-0021). A row is a real document — openable, with its own body —
 * and the tree simply does not show it.
 */
/** Where a block sits horizontally. */
export const BLOCK_ALIGNMENTS = ['start', 'center', 'end'] as const;
export type BlockAlignment = (typeof BLOCK_ALIGNMENTS)[number];

/**
 * How much width a block takes.
 *
 * `normal` is the reading column. `wide` breaks out of it a little and `full`
 * uses the whole page — useful for an image or a table, meaningless for a
 * sentence, which is why the interface offers it per type.
 */
export const BLOCK_WIDTHS = ['normal', 'wide', 'full'] as const;
export type BlockWidth = (typeof BLOCK_WIDTHS)[number];

/**
 * Colours a block may carry.
 *
 * The same palette names as tags and select options, so a workspace has one
 * vocabulary for colour rather than three. Names, not values: a name survives a
 * theme change where a stored hex cannot.
 */
export const BLOCK_COLORS = [
  'grey',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const;
export type BlockColor = (typeof BLOCK_COLORS)[number];

export const ENTRY_KINDS = ['page', 'folder', 'row', 'container'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const PAGE_KEYS = {
  title: 'title',
  /** One of ENTRY_KINDS. Absent means 'page' (ADR-0019). */
  kind: 'kind',
  /**
   * Tag names carried by this page, as a Y.Array of strings (ADR-0020).
   *
   * Names rather than ids: an id needs a workspace-level registry, and a
   * registry is not part of any document, so it could not be rebuilt from the
   * CRDT log. A Y.Array rather than a JSON string so two people adding
   * different tags at once merge instead of overwriting each other.
   */
  tags: 'tags',
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
  /**
   * How a block is presented. Three names, shared by every block type.
   *
   * First-class attributes rather than keys inside `props`, for the same reason
   * `indent` is: they have to reach the rendered DOM so a stylesheet can act on
   * them, and props is an opaque JSON blob that the schema does not unpack.
   *
   * A closed set on purpose. "Configurable" could mean arbitrary CSS, and that
   * is a different product: a document whose blocks carry hand-written styles
   * cannot be restyled, cannot be exported cleanly, and looks wrong the moment
   * somebody switches theme. These are choices *within* a design rather than an
   * escape from it.
   */
  align: 'align',
  width: 'width',
  color: 'color',
  /** JSON-encoded block-specific settings. Never derived values. */
  props: 'props',
  /**
   * Indentation level, as a decimal string. Absent means 0.
   *
   * The parent-child relationship between text blocks is expressed by
   * indentation rather than by XML nesting (ADR-0018). ProseMirror forbids a
   * node containing both inline text and block children, so a list item that
   * has text *and* sub-items cannot be a real container — the constraint is
   * absolute and was discovered only when the schema refused to build.
   *
   * A first-class attribute rather than a props key, because the tree reader
   * needs it on every block and parsing JSON per block to find it would be
   * wasteful.
   */
  indent: 'indent',
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
 * Block types that hold other blocks structurally, as XML children.
 *
 * Only types with no text of their own qualify. A block that has both text and
 * children — a list item with sub-items — cannot be one of these, because
 * ProseMirror rejects a node mixing inline and block content. Those use the
 * `indent` attribute instead (ADR-0018).
 *
 * Keeping the two mechanisms separated by that rule is what stops them
 * overlapping: a type is either textless-and-structural, or textual-and-flat,
 * never both.
 */
export const STRUCTURAL_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'columns',
  'column',
]);

/**
 * Text blocks that may have indented children beneath them.
 *
 * Advisory rather than enforced: indentation is a property of a block, so any
 * block can be indented under any other. This set exists so the editor can
 * offer indentation where it is meaningful and the renderer can draw list
 * markers.
 */
export const INDENTABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'numberedList',
  'todo',
  'toggle',
  'quote',
  'callout',
  'code',
  'image',
  'divider',
  'collectionView',
]);

/** Retained for compatibility with existing imports; prefer the two above. */
export const CONTAINER_BLOCK_TYPES = STRUCTURAL_BLOCK_TYPES;

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
