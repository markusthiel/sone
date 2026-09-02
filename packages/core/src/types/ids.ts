/**
 * SONE — branded identifier types and schema versioning.
 *
 * Branded strings cost nothing at runtime but stop the single most common
 * class of bug in a system with this many id kinds: passing a PageId where
 * a BlockId belongs. Construct them via the `as*` helpers so every
 * conversion from a raw string is visible in a diff.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type UserId = Brand<string, 'UserId'>;
export type PageId = Brand<string, 'PageId'>;
export type BlockId = Brand<string, 'BlockId'>;
export type CollectionId = Brand<string, 'CollectionId'>;
export type FieldId = Brand<string, 'FieldId'>;
export type ViewId = Brand<string, 'ViewId'>;
export type FileId = Brand<string, 'FileId'>;
export type ShareTokenId = Brand<string, 'ShareTokenId'>;

export const asWorkspaceId = (s: string) => s as WorkspaceId;
export const asUserId = (s: string) => s as UserId;
export const asPageId = (s: string) => s as PageId;
export const asBlockId = (s: string) => s as BlockId;
export const asCollectionId = (s: string) => s as CollectionId;
export const asFieldId = (s: string) => s as FieldId;
export const asViewId = (s: string) => s as ViewId;
export const asFileId = (s: string) => s as FileId;
export const asShareTokenId = (s: string) => s as ShareTokenId;

/**
 * Fractional index for sibling ordering.
 *
 * Ordering is a lexicographically sortable string, never an array position.
 * Two clients inserting between the same pair of siblings while offline
 * produce different keys that both survive the merge; an array would produce
 * a conflict. See ADR-0002.
 */
export type FractionalIndex = Brand<string, 'FractionalIndex'>;
export const asFractionalIndex = (s: string) => s as FractionalIndex;

/**
 * ISO-8601 timestamp with timezone offset. Stored as text in CRDTs so that
 * merges never depend on a local Date parse.
 */
export type Timestamp = Brand<string, 'Timestamp'>;
export const asTimestamp = (d: Date = new Date()) =>
  d.toISOString() as Timestamp;

/**
 * Document schema version.
 *
 * Every persisted Y.Doc carries this under the `meta` map. Migrations run
 * lazily on document open and are append-only: a document written by a newer
 * SONE than the one reading it must be refused, not guessed at.
 *
 * Bump SCHEMA_VERSION whenever the *shape* of persisted data changes. Adding
 * an optional field does not require a bump. Renaming, removing or changing
 * the meaning of a field does.
 */
export const SCHEMA_VERSION = 4 as const;
export type SchemaVersion = number;

export interface DocMeta {
  schemaVersion: SchemaVersion;
  /** Set once at creation, never rewritten. Used for debugging merges. */
  createdWith: string;
}
