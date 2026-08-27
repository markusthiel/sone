/**
 * SONE — views, filters, collections.
 *
 * Views are pure presentation: a view describes how to query the collection,
 * never what the answer is. Results are computed against the materialised
 * tables in Postgres, so a new view type needs no data migration.
 */

import type { Block, BlockType } from './block.js';
import type { FieldDef } from './field.js';
import type {
  CollectionId,
  FieldId,
  PageId,
  SchemaVersion,
  ViewId,
} from './ids.js';

export type ViewType = 'table' | 'board' | 'calendar' | 'gallery' | 'list';

export type FilterOperator =
  | 'isEmpty'
  | 'isNotEmpty'
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'isBefore'
  | 'isAfter'
  | 'isOnOrBefore'
  | 'isOnOrAfter'
  | 'isWithin'
  | 'containsAny'
  | 'containsAll'
  | 'containsNone';

export interface FilterCondition {
  kind: 'condition';
  fieldId: FieldId;
  operator: FilterOperator;
  /** Absent for isEmpty / isNotEmpty. */
  value?: unknown;
}

/** Filters nest arbitrarily; the recursion is what makes AND/OR usable. */
export interface FilterGroup {
  kind: 'group';
  conjunction: 'and' | 'or';
  children: Array<FilterCondition | FilterGroup>;
}

export type Filter = FilterCondition | FilterGroup;

export interface SortRule {
  fieldId: FieldId;
  direction: 'asc' | 'desc';
}

export interface ViewFieldSettings {
  fieldId: FieldId;
  visible: boolean;
  /** Fractional index so reordering columns does not conflict. */
  index: string;
  widthPx: number | null;
  wrap: boolean;
}

export interface ViewDef {
  id: ViewId;
  name: string;
  type: ViewType;
  filter: Filter | null;
  sorts: SortRule[];
  /** Board column field, or calendar date field. */
  groupByFieldId: FieldId | null;
  fields: ViewFieldSettings[];
  /** Board/gallery card preview: which page cover or field to show. */
  cardPreviewFieldId: FieldId | null;
  showPageIconInCards: boolean;
  schemaVersion: SchemaVersion;
}

export interface Collection {
  id: CollectionId;
  /** The page that owns this collection. */
  pageId: PageId;
  fields: FieldDef[];
  views: ViewDef[];
  /** Field used as the row title. Always a text field. */
  titleFieldId: FieldId;
  schemaVersion: SchemaVersion;
}

/**
 * The database block inside a document.
 *
 * This block mounts its own renderer against the materialised tables. It is
 * deliberately NOT modelled as ProseMirror nodes — rows as editor nodes
 * collapses past a few thousand entries and makes selection handling
 * unmanageable (ADR-0004).
 */
export interface CollectionViewBlock extends Block {
  type: Extract<BlockType, 'collectionView'>;
  props: {
    collectionId: CollectionId;
    viewId: ViewId;
    /** Inline in the page, or a full-page database. */
    display: 'inline' | 'fullPage';
    /** Per-block overrides so the same view can be embedded twice. */
    filterOverride: Filter | null;
  };
}

/** Plugin contract for third-party view types. */
export interface ViewTypeDef {
  type: string;
  namespace: string;
  schemaVersion: SchemaVersion;
  defaultView: (fields: FieldDef[]) => Omit<ViewDef, 'id' | 'name'>;
  /** Field types this view requires in order to be offered at all. */
  requiredFieldTypes?: string[];
}
