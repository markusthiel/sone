/**
 * SONE — filtering and sorting a collection, in the database.
 *
 * Not in the client. The projection exists so a view can ask "these rows, these
 * columns, in this order" without loading every row's CRDT (ADR-0004); doing
 * the work after fetching everything would make the projection pointless and
 * would stop working at exactly the size where a collection starts to matter.
 *
 * The typed shadow columns on `page_properties` are what make this cheap and
 * correct. Sorting on jsonb is slow and its collation is wrong for numbers and
 * dates — `"10"` sorts before `"9"`, and that has already cost this project a
 * production outage in a different place (see the version fence).
 *
 * ## Why the SQL is built rather than parameterised whole
 *
 * A filter names a field, an operator and a value. The field id and the
 * operator decide *which column and which comparison*, and those cannot be
 * parameters — no database lets you bind a column name. So they are mapped
 * through closed lists here, and every value is still a bound parameter. An
 * operator that is not in the list is refused rather than interpolated.
 */

import type { FieldType } from '@sone/core';

/** What a filter can say. Closed, and mapped to SQL by name only. */
export type FilterOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'before'
  | 'after';

export interface Filter {
  fieldId: string;
  operator: FilterOperator;
  /** Absent for isEmpty / isNotEmpty. */
  value?: unknown;
}

export interface Sort {
  fieldId: string;
  direction: 'asc' | 'desc';
}

/** Which shadow column a field type is stored in. */
function columnFor(fieldType: string): 'text_value' | 'number_value' | 'date_start' | 'bool_value' | null {
  switch (fieldType) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'select':
    case 'multiSelect':
      return 'text_value';
    case 'number':
      return 'number_value';
    case 'date':
      return 'date_start';
    case 'checkbox':
      return 'bool_value';
    default:
      return null;
  }
}

export interface BuiltQuery {
  /** Appended to the WHERE clause, already parenthesised. Empty when none. */
  where: string;
  /** Appended to ORDER BY, before the stable tiebreak. Empty when none. */
  orderBy: string;
  params: unknown[];
}

/**
 * Build the WHERE and ORDER BY fragments for a view.
 *
 * `params` continues from `startIndex`, so a caller can prepend its own.
 *
 * Unknown fields and unusable operators are skipped rather than failing the
 * request. A view is stored in a document that other people edit: a column can
 * be deleted while somebody else's board still names it, and refusing to render
 * the collection at all would turn one stale filter into an unreachable page.
 */
export function buildViewQuery(
  filters: readonly Filter[],
  sorts: readonly Sort[],
  fieldTypes: ReadonlyMap<string, FieldType | string>,
  startIndex: number,
): BuiltQuery {
  const params: unknown[] = [];
  const clauses: string[] = [];
  let index = startIndex;

  const bind = (value: unknown): string => {
    params.push(value);
    return `$${index++}`;
  };

  /** A correlated lookup, so a row with no value is simply not matched. */
  const property = (fieldId: string, column: string): string =>
    `(SELECT pp.${column} FROM page_properties pp
        WHERE pp.page_id = p.id AND pp.field_id = ${bind(fieldId)})`;

  for (const filter of filters) {
    const fieldType = fieldTypes.get(filter.fieldId);
    if (!fieldType) continue;
    const column = columnFor(fieldType);
    if (!column) continue;

    // isEmpty and isNotEmpty are about the row having a value at all, which is
    // a different question from the value comparing equal to something — and
    // the only one that can be asked of every type.
    if (filter.operator === 'isEmpty' || filter.operator === 'isNotEmpty') {
      const exists = `EXISTS (SELECT 1 FROM page_properties pp
                       WHERE pp.page_id = p.id AND pp.field_id = ${bind(filter.fieldId)})`;
      clauses.push(filter.operator === 'isEmpty' ? `NOT ${exists}` : exists);
      continue;
    }

    if (filter.value === undefined || filter.value === null) continue;

    const target = property(filter.fieldId, column);

    switch (filter.operator) {
      case 'is':
        // multiSelect stores its option ids as one text value, so "is" on it
        // would compare the whole set. Left to `contains`, which is what a
        // person means by "has this tag".
        if (fieldType === 'multiSelect') continue;
        clauses.push(`${target} = ${bind(filter.value)}`);
        break;
      case 'isNot':
        if (fieldType === 'multiSelect') continue;
        // A row with no value counts as "is not X". The alternative — treating
        // an absent value as neither is nor is not — hides rows from both
        // halves of a filter and its opposite, which reads as rows going
        // missing.
        clauses.push(`(${target} IS DISTINCT FROM ${bind(filter.value)})`);
        break;
      case 'contains':
      case 'notContains': {
        if (column !== 'text_value') continue;
        // Escaped, or a value containing % or _ would silently become a
        // pattern — somebody filtering for "50%" would match far too much.
        const pattern = `%${String(filter.value).replace(/[\\%_]/g, '\\$&')}%`;
        const test = `${target} ILIKE ${bind(pattern)} ESCAPE '\\'`;
        clauses.push(filter.operator === 'contains' ? test : `(${test}) IS NOT TRUE`);
        break;
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (column !== 'number_value') continue;
        const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.operator];
        clauses.push(`${target} ${op} ${bind(Number(filter.value))}`);
        break;
      }
      case 'before':
      case 'after': {
        if (column !== 'date_start') continue;
        const op = filter.operator === 'before' ? '<' : '>';
        clauses.push(`${target} ${op} ${bind(filter.value)}`);
        break;
      }
      default:
        // An operator not in the list. Skipped, never interpolated.
        continue;
    }
  }

  const orders: string[] = [];
  for (const sort of sorts) {
    const fieldType = fieldTypes.get(sort.fieldId);
    if (!fieldType) continue;
    const column = columnFor(fieldType);
    if (!column) continue;

    const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
    // NULLS LAST in both directions: a row with no value is not "smallest", it
    // is unanswered, and answered rows are what somebody sorted to see.
    orders.push(`${property(sort.fieldId, column)} ${direction} NULLS LAST`);
  }

  return {
    where: clauses.length > 0 ? clauses.map((clause) => `(${clause})`).join(' AND ') : '',
    orderBy: orders.join(', '),
    params,
  };
}

/** Read filters out of a view definition, ignoring anything malformed. */
export function readFilters(definition: Record<string, unknown>): Filter[] {
  const raw = definition['filters'];
  if (!Array.isArray(raw)) return [];

  const out: Filter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { fieldId, operator, value } = entry as Record<string, unknown>;
    if (typeof fieldId !== 'string' || typeof operator !== 'string') continue;
    out.push({
      fieldId,
      operator: operator as FilterOperator,
      ...(value === undefined ? {} : { value }),
    });
  }
  return out;
}

/** Read sorts out of a view definition. */
export function readSorts(definition: Record<string, unknown>): Sort[] {
  const raw = definition['sort'];
  if (!Array.isArray(raw)) return [];

  const out: Sort[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { fieldId, direction } = entry as Record<string, unknown>;
    if (typeof fieldId !== 'string') continue;
    out.push({ fieldId, direction: direction === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}
