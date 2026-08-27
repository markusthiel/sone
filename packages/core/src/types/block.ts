/**
 * SONE — the block model.
 *
 * Everything visible in SONE is a block. A page is a block that happens to
 * own its own Y.Doc. A database row is a page. There is no separate "row"
 * type, which is what makes every database entry a full document (the
 * property Craft and Notion have and most clones lack).
 */

import type {
  BlockId,
  CollectionId,
  FractionalIndex,
  PageId,
  SchemaVersion,
  Timestamp,
  UserId,
  WorkspaceId,
} from './ids.js';

/**
 * Block types shipped by SONE itself. Third-party types are plain strings
 * registered through BlockTypeDef, so this union is deliberately open.
 */
export type CoreBlockType =
  | 'page'
  | 'paragraph'
  | 'heading'
  | 'bulletList'
  | 'numberedList'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'image'
  | 'file'
  | 'embed'
  | 'table'
  | 'columns'
  | 'column'
  | 'collectionView';

export type BlockType = CoreBlockType | (string & {});

/**
 * Inline content is ProseMirror's business, not ours. We persist it as the
 * Y.XmlFragment attached to the block and never mirror it into props — two
 * representations of the same text is how you get divergence.
 */
export interface Block {
  id: BlockId;
  type: BlockType;
  /** null only for the root block of a document. */
  parentId: BlockId | null;
  index: FractionalIndex;
  /**
   * Block-type-specific settings: heading level, code language, callout
   * colour. Never derived values — see ADR-0002.
   */
  props: Record<string, unknown>;
}

export type PageIcon =
  | { kind: 'emoji'; value: string }
  | { kind: 'file'; value: string };

/**
 * A page is addressable, shareable and syncable on its own. `parentPageId`
 * forms the navigation tree; `collectionId` is set when this page is an
 * entry in a database.
 */
export interface Page {
  id: PageId;
  workspaceId: WorkspaceId;
  parentPageId: PageId | null;
  /** Non-null when this page is a row of a collection. */
  collectionId: CollectionId | null;
  index: FractionalIndex;
  title: string;
  icon: PageIcon | null;
  coverUrl: string | null;
  schemaVersion: SchemaVersion;
  archivedAt: Timestamp | null;
  createdAt: Timestamp;
  createdBy: UserId | null;
  lastEditedAt: Timestamp;
  lastEditedBy: UserId | null;
}

/**
 * Plugin contract for block types.
 *
 * Registered from day one so that core block types go through the same door
 * third-party ones will. If this is retrofitted later, there are sixty
 * hardwired types to untangle first (ADR-0004).
 */
export interface BlockTypeDef<P = Record<string, unknown>> {
  type: BlockType;
  /** Reverse-DNS for third-party types, e.g. "tools.thiel.mermaid". */
  namespace: string;
  schemaVersion: SchemaVersion;
  defaultProps: () => P;
  /** May this block type contain children? */
  container: boolean;
  /** Does it hold inline text handled by the editor? */
  inlineContent: boolean;
  /**
   * Called on document open when a stored block was written by an older
   * version of this block type. Must be pure and idempotent.
   */
  migrate?: (props: unknown, from: SchemaVersion) => P;
  /** Plain-text projection used for full-text search indexing. */
  toPlainText?: (block: Block) => string;
}
