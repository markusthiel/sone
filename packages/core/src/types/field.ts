/**
 * SONE — field definitions.
 *
 * A field is a column of a collection. Stored values live in
 * page_properties; derived fields (formula, rollup, lookup, and every
 * created/edited audit field) store nothing at all and are computed during
 * materialisation. Persisting a derived value would mean two clients can
 * disagree about a value that is deterministically implied by its inputs.
 */

import type { CollectionId, FieldId, SchemaVersion } from './ids.js';

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'status'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'person'
  | 'files'
  | 'relation'
  // derived — never stored
  | 'formula'
  | 'rollup'
  | 'lookup'
  | 'createdAt'
  | 'createdBy'
  | 'lastEditedAt'
  | 'lastEditedBy';

export const DERIVED_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'formula',
  'rollup',
  'lookup',
  'createdAt',
  'createdBy',
  'lastEditedAt',
  'lastEditedBy',
]);

export const isDerived = (t: FieldType) => DERIVED_FIELD_TYPES.has(t);

export interface SelectOption {
  id: string;
  name: string;
  color: string;
}

export type NumberFormat =
  | 'plain'
  | 'integer'
  | 'decimal'
  | 'percent'
  | 'currency';

export type RollupFunction =
  | 'count'
  | 'countValues'
  | 'countUnique'
  | 'countEmpty'
  | 'countNotEmpty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'earliest'
  | 'latest'
  | 'showOriginal';

export type FieldConfig =
  | { type: 'text' }
  | { type: 'number'; format: NumberFormat; precision: number; currency?: string }
  | { type: 'select'; options: SelectOption[] }
  | { type: 'multiSelect'; options: SelectOption[] }
  | { type: 'status'; options: SelectOption[]; groups: Record<string, string[]> }
  | { type: 'date'; includeTime: boolean; timeZone: string | null }
  | { type: 'checkbox' }
  | { type: 'url' }
  | { type: 'email' }
  | { type: 'phone' }
  | { type: 'person'; multiple: boolean }
  | { type: 'files' }
  /**
   * Only the owning side is persisted. The inverse direction is derived
   * during materialisation — maintaining both directions inside CRDTs does
   * not converge cleanly (ADR-0002).
   */
  | {
      type: 'relation';
      targetCollectionId: CollectionId;
      multiple: boolean;
      /** Field on the target collection that renders the inverse, if shown. */
      inverseFieldId: FieldId | null;
    }
  | {
      type: 'rollup';
      relationFieldId: FieldId;
      targetFieldId: FieldId;
      fn: RollupFunction;
    }
  | { type: 'lookup'; relationFieldId: FieldId; targetFieldId: FieldId }
  | { type: 'formula'; expression: string }
  | { type: 'createdAt' }
  | { type: 'createdBy' }
  | { type: 'lastEditedAt' }
  | { type: 'lastEditedBy' };

export interface FieldDef {
  id: FieldId;
  name: string;
  description: string | null;
  config: FieldConfig;
  schemaVersion: SchemaVersion;
}

/** Stored cell values. Derived fields never appear here. */
export type StoredValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'select'; optionId: string }
  | { kind: 'multiSelect'; optionIds: string[] }
  | { kind: 'date'; start: string; end: string | null }
  | { kind: 'checkbox'; value: boolean }
  | { kind: 'url'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: 'person'; userIds: string[] }
  | { kind: 'files'; fileIds: string[] }
  | { kind: 'relation'; pageIds: string[] };
