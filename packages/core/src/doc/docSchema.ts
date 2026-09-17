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
 *   page        Y.Map          title, icon, cover, parentPageId,
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
  /**
   * A canvas's items, by id (ADR-0043).
   *
   * A map rather than an array, and that is the whole difference between this
   * and every other shape in the document: the things on a canvas have no order,
   * they have positions. Moving one is setting two numbers on one key, so two
   * people moving two things never touch the same data.
   */
  canvas: 'canvas',
  /**
   * Comment threads, by id (ADR-0046).
   *
   * In the document rather than in a table of its own: an anchor has to live
   * beside the text it refers to or the two get out of step, and a comments
   * table with its own sync path would be a second real-time system beside the
   * one that works.
   */
  comments: 'comments',
  /**
   * Marks on a PDF that nobody has said anything about (ADR-0152).
   *
   * Beside the comments rather than among them. A thread with no messages is
   * not a thread (ADR-0046) — it *is* a highlight over nothing, which is
   * exactly what this is for, so the two want opposite things from one shape.
   * Every reader of the comments would otherwise have to ask "and does this one
   * have anything in it".
   *
   * Absent in every document written before this key existed, and an absent map
   * reads as an empty one — which is why this needed no schema bump.
   */
  pdfMarks: 'pdfMarks',
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

/**
 * What a callout is *about*, as a closed set (ADR-0188).
 *
 * A callout used to be one box in one grey. Anybody who wanted a warning to
 * look like a warning coloured the text, which is the wrong lever: colour on
 * the words says nothing about the box, and a page with five callouts in five
 * text colours is five decisions the reader has to decode.
 *
 * A tone is one word — what kind of aside this is — and the stylesheet decides
 * what that looks like: a tinted background, a symbol on the right, in the
 * tone's colour. Names rather than colours or icons, for the same reason block
 * colours are names: a name survives a theme change, and an icon renamed is a
 * migration.
 *
 * `note` is the neutral one and the default; a callout without a tone is a
 * note, so every existing callout keeps looking the way it did.
 */
export const CALLOUT_TONES = [
  'note',
  'info',
  'tip',
  'warning',
  'error',
  'alarm',
  'exclaim',
  'question',
  'success',
  'memo',
  'example',
  'quote',
] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/**
 * The word a Markdown export writes for each tone, and the importer reads back.
 *
 * English, because an export is a file that leaves the instance and Markdown
 * has no callout of its own: the first line of the blockquote names the kind,
 * in bold, and any reader understands `> **Warning**` without knowing SONE.
 * Matched case-insensitively on the way back in.
 */
export const CALLOUT_TONE_LABELS: Record<CalloutTone, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  warning: 'Warning',
  error: 'Error',
  alarm: 'Alarm',
  exclaim: 'Important',
  question: 'Question',
  success: 'Success',
  memo: 'Memo',
  example: 'Example',
  quote: 'Quote',
};

/** The tone a Markdown label stands for, or null for a word that is not one. */
export function calloutToneFromLabel(label: string): CalloutTone | null {
  const wanted = label.trim().toLowerCase();
  for (const tone of CALLOUT_TONES) {
    if (CALLOUT_TONE_LABELS[tone].toLowerCase() === wanted) return tone;
  }
  return null;
}

/**
 * How a divider's line is drawn (ADR-0189). `solid` is the default and is
 * stored as the attribute's absence, like `note` for a callout.
 */
export const DIVIDER_RULES = [
  'solid',
  'dashed',
  'dotted',
  'double',
  'thick',
  'fade',
  'short',
  'wave',
  'bars',
] as const;
export type DividerRule = (typeof DIVIDER_RULES)[number];

/**
 * A symbol that can sit on a divider's line (ADR-0189). None by default.
 *
 * Four families in one list: geometric marks, things from nature, a few
 * playful ones, and the twelve callout tones — so a page can end a section
 * with the same triangle its warnings wear. Names, like every other stored
 * choice; the drawings live with the editor.
 */
export const DIVIDER_ORNAMENTS = [
  'dot',
  'diamond',
  'ellipsis',
  'asterism',
  'circle',
  'square',
  'leaf',
  'star',
  'sun',
  'moon',
  'wave',
  'flower',
  'heart',
  'coffee',
  'anchor',
  'quill',
  'scissors',
  'arrow',
  ...CALLOUT_TONES,
] as const;
export type DividerOrnament = (typeof DIVIDER_ORNAMENTS)[number];

/** Where the symbol sits. `center` is the default and stored as absence. */
export const DIVIDER_ORNAMENT_PLACES = ['start', 'center', 'end'] as const;
export type DividerOrnamentPlace = (typeof DIVIDER_ORNAMENT_PLACES)[number];

/**
 * Which of a block's properties are ProseMirror node attributes, per type
 * (ADR-0191) — as opposed to keys inside the `props` JSON.
 *
 * The distinction matters to anything that *writes* a block without the
 * editor: the importer, chiefly. y-prosemirror builds a node from the shared
 * element's attributes and never looks inside `props`, so a heading whose
 * `level` was written into the JSON is a heading at the default size, and an
 * image whose `url` was written there is an empty frame — which is what every
 * imported heading and picture was. The reader (`readAllProps`) merges both
 * places; the writer has to know which is which.
 *
 * The shared ones (`BLOCK_ATTRS` minus id, props and indent) apply to every
 * type. An editor test holds this table to the schema, so a new attribute
 * cannot be added to one without the other.
 */
export const BLOCK_NODE_ATTRS: Record<string, readonly string[]> = {
  paragraph: [],
  heading: ['level'],
  bulletList: [],
  numberedList: [],
  todo: ['checked'],
  toggle: ['collapsed'],
  quote: ['source'],
  callout: ['tone'],
  code: ['language'],
  divider: ['rule', 'ornament', 'ornamentAt'],
  image: ['url', 'alt'],
  file: ['fileId', 'filename', 'mimeType', 'category', 'sizeBytes', 'display'],
  video: ['source', 'fileId', 'url', 'title', 'display'],
  protectedSection: ['containerId'],
  soteTasks: ['serverId', 'projectId', 'taskId', 'mode'],
  collectionView: ['collectionId', 'viewId', 'display'],
  columns: [],
  table: [],
};

/** The attributes every block type has and a writer must place as attributes. */
export const SHARED_NODE_ATTRS = ['align', 'width', 'color'] as const;

export const ENTRY_KINDS = ['page', 'folder', 'row', 'container', 'canvas'] as const;
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
  /**
   * How wide this page's writing is: 'column' or 'full'. Absent means the
   * reader's default, which is the column (ADR-0028).
   *
   * In the document rather than only in the database, like the icon: it is a
   * property of the page and it travels with it — a page moved to another
   * workspace or restored from a backup keeps the shape its author gave it.
   */
  width: 'width',
  /**
   * Whether this page is offered as a shape to start from (ADR-0045).
   *
   * In the document as well as the database, like the icon and the width: it is
   * a property of the page and it travels when the page does.
   */
  template: 'template',
  /**
   * Locked against accidental editing (ADR-0049).
   *
   * In the document rather than only in the database, and for a sharper reason
   * than the icon has: it must reach another person's *open* editor, which is
   * exactly when the accident happens. A flag in the projection would arrive on
   * their next reload.
   *
   * Not a permission. Anybody who may edit the page may lift it — a CRDT cannot
   * refuse an update without the client and server disagreeing about the
   * document, so this stops the interface from offering editing and claims
   * nothing more. What restricts other people is a permission (ADR-0026).
   */
  locked: 'locked',
  /**
   * A picture, a colour or a gradient above the heading (ADR-0117).
   *
   * `coverUrl` until then, a string, read by the projection and written by
   * nothing since the first migration. Renamed rather than kept because the
   * value is no longer a URL — a colour is not one — and no document carries
   * the old key: nothing ever wrote it, so there is nothing to migrate.
   */
  cover: 'cover',
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
  /**
   * Whether this page is offered as a shape to start from (ADR-0045).
   *
   * In the document as well as the database, like the icon and the width: it is
   * a property of the page and it travels when the page does.
   */
  template: 'template',
  /**
   * Locked against accidental editing (ADR-0049).
   *
   * In the document rather than only in the database, and for a sharper reason
   * than the icon has: it must reach another person's *open* editor, which is
   * exactly when the accident happens. A flag in the projection would arrive on
   * their next reload.
   *
   * Not a permission. Anybody who may edit the page may lift it — a CRDT cannot
   * refuse an update without the client and server disagreeing about the
   * document, so this stops the interface from offering editing and claims
   * nothing more. What restricts other people is a permission (ADR-0026).
   */
  locked: 'locked',
  color: 'color',
  /**
   * One of CALLOUT_TONES, on a callout (ADR-0188). Absent means `note`.
   *
   * First-class for the reason `color` is: it has to reach the DOM so the
   * stylesheet can tint the box and pick the symbol.
   */
  tone: 'tone',
  /**
   * Where a quote is from, as one line of text under it (ADR-0188).
   *
   * An attribute rather than a second text region because a quote is a flat
   * inline block (ADR-0018) — a block cannot hold both inline text and a
   * child block — and because the source is not part of the quotation: it is
   * not searched as the speaker's words and not continued by Enter.
   */
  source: 'source',
  /**
   * A divider's line, symbol and where the symbol sits (ADR-0189): one of
   * DIVIDER_RULES, one of DIVIDER_ORNAMENTS, one of DIVIDER_ORNAMENT_PLACES.
   * Absent means solid, none, center.
   */
  rule: 'rule',
  ornament: 'ornament',
  ornamentAt: 'ornamentAt',
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
  'soteTasks',
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
