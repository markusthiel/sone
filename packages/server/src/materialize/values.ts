/**
 * SONE — mapping stored cell values onto typed shadow columns.
 *
 * `page_properties` keeps the canonical value in `value jsonb` and mirrors it
 * into `text_value` / `number_value` / `date_start` / `date_end` /
 * `bool_value`. The mirror exists because filtering and sorting directly on
 * jsonb is slow and, worse, its ordering is wrong for numbers and dates:
 * jsonb compares '10' before '9'.
 *
 * Only the column matching the field type is populated; the rest stay null.
 */

import { isDerived, type FieldType, type StoredValue } from '@sone/core';

export interface ShadowColumns {
  textValue: string | null;
  numberValue: number | null;
  dateStart: Date | null;
  dateEnd: Date | null;
  boolValue: boolean | null;
}

export const EMPTY_SHADOW: ShadowColumns = {
  textValue: null,
  numberValue: null,
  dateStart: null,
  dateEnd: null,
  boolValue: null,
};

const parseDate = (raw: unknown): Date | null => {
  if (typeof raw !== 'string' || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Sort key for select and multi-select values.
 *
 * Stored values reference option ids, but users expect to sort by the option's
 * position in the field's option list, not by an opaque id. The caller passes
 * the option order so this stays a pure function.
 */
const optionSortKey = (optionId: string, order: readonly string[]): string => {
  const at = order.indexOf(optionId);
  // Unknown options sort last, deterministically, rather than throwing: a
  // stale option id must not take a page out of every view.
  return at < 0 ? `zzz:${optionId}` : String(at).padStart(6, '0');
};

export interface FieldContext {
  fieldType: FieldType;
  /** Option ids in display order, for select-like fields. */
  optionOrder?: readonly string[];
}

/**
 * Derive shadow columns for one cell.
 *
 * Returns EMPTY_SHADOW for anything unrecognised rather than throwing. A
 * single malformed value must degrade that cell's sortability, not fail the
 * materialisation of an entire page.
 */
export function toShadowColumns(
  value: StoredValue | null | undefined,
  ctx: FieldContext,
): ShadowColumns {
  if (!value) return EMPTY_SHADOW;
  if (isDerived(ctx.fieldType)) {
    // Derived fields are computed at query time and never stored (ADR-0002).
    return EMPTY_SHADOW;
  }

  switch (value.kind) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return {
        ...EMPTY_SHADOW,
        textValue: typeof value.value === 'string' ? value.value.slice(0, 8192) : null,
      };

    case 'number':
      return {
        ...EMPTY_SHADOW,
        numberValue: Number.isFinite(value.value) ? value.value : null,
      };

    case 'checkbox':
      return { ...EMPTY_SHADOW, boolValue: value.value === true };

    case 'select':
      return {
        ...EMPTY_SHADOW,
        textValue: optionSortKey(value.optionId, ctx.optionOrder ?? []),
      };

    case 'multiSelect':
      // Sort by the first selected option; filtering on membership uses the
      // jsonb value, not this column.
      return {
        ...EMPTY_SHADOW,
        textValue:
          value.optionIds.length > 0
            ? optionSortKey(value.optionIds[0]!, ctx.optionOrder ?? [])
            : null,
      };

    case 'date':
      return {
        ...EMPTY_SHADOW,
        dateStart: parseDate(value.start),
        dateEnd: parseDate(value.end),
      };

    case 'person':
      return {
        ...EMPTY_SHADOW,
        textValue: value.userIds.length > 0 ? value.userIds.join(',') : null,
      };

    case 'files':
      return {
        ...EMPTY_SHADOW,
        numberValue: value.fileIds.length,
      };

    case 'relation':
      // Relations live in page_relations; the count is kept here so a view can
      // sort by "how many linked items" without a join.
      return { ...EMPTY_SHADOW, numberValue: value.pageIds.length };

    default:
      return EMPTY_SHADOW;
  }
}

/** Text contributed by a cell to the page's search index. */
export function valueToSearchText(
  value: StoredValue | null | undefined,
  optionNames: ReadonlyMap<string, string> = new Map(),
): string {
  if (!value) return '';
  switch (value.kind) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof value.value === 'string' ? value.value : '';
    case 'number':
      return String(value.value);
    case 'select':
      return optionNames.get(value.optionId) ?? '';
    case 'multiSelect':
      return value.optionIds.map((id) => optionNames.get(id) ?? '').join(' ');
    case 'date':
      return [value.start, value.end].filter(Boolean).join(' ');
    default:
      // Checkboxes, person and file references are filtered on, not searched.
      return '';
  }
}
