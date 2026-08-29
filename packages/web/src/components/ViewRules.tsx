/**
 * SONE web — setting a view's filters and sorting.
 *
 * The query side of this was built, tested and reachable only by hand. A
 * half-feature looks finished from the outside, which is worse than an absent
 * one: somebody reads "filter and sort" and then cannot.
 *
 * ## Which operators are offered
 *
 * Only the ones that mean something for the column's type. "Greater than" on a
 * text column is not a stricter filter, it is a comparison of strings that
 * returns the wrong rows quietly — the server skips such a filter, and offering
 * it here would produce a control that appears to do nothing.
 */

import { useState, type ReactElement } from 'react';

import type { CollectionField, CollectionView } from '../api/client.ts';
import { PlusIcon, TrashIcon } from './icons.tsx';

interface Filter {
  fieldId: string;
  operator: string;
  value?: unknown;
}

interface Sort {
  fieldId: string;
  direction: 'asc' | 'desc';
}

interface ViewRulesProps {
  view: CollectionView;
  fields: CollectionField[];
  onSave: (definition: Record<string, unknown>) => void;
  onClose: () => void;
}

/** What can be asked of each type. Mirrors what the server will honour. */
function operatorsFor(fieldType: string): Array<{ id: string; label: string }> {
  const always = [
    { id: 'isEmpty', label: 'is empty' },
    { id: 'isNotEmpty', label: 'is not empty' },
  ];

  switch (fieldType) {
    case 'number':
      return [
        { id: 'is', label: 'is' },
        { id: 'isNot', label: 'is not' },
        { id: 'gt', label: 'greater than' },
        { id: 'gte', label: 'at least' },
        { id: 'lt', label: 'less than' },
        { id: 'lte', label: 'at most' },
        ...always,
      ];
    case 'date':
      return [
        { id: 'before', label: 'before' },
        { id: 'after', label: 'after' },
        ...always,
      ];
    case 'checkbox':
      return [{ id: 'is', label: 'is' }, ...always];
    case 'select':
      return [
        { id: 'is', label: 'is' },
        { id: 'isNot', label: 'is not' },
        ...always,
      ];
    case 'multiSelect':
      // No "is": the stored value is the whole set, so equality would compare
      // all of somebody's choices at once. "Contains" is what people mean.
      return [
        { id: 'contains', label: 'contains' },
        { id: 'notContains', label: 'does not contain' },
        ...always,
      ];
    default:
      return [
        { id: 'is', label: 'is' },
        { id: 'isNot', label: 'is not' },
        { id: 'contains', label: 'contains' },
        { id: 'notContains', label: 'does not contain' },
        ...always,
      ];
  }
}

/** Columns that can be filtered or sorted at all. */
const usable = (field: CollectionField): boolean =>
  ['text', 'number', 'date', 'checkbox', 'select', 'multiSelect', 'url', 'email', 'phone'].includes(
    field.fieldType,
  );

const readFilters = (view: CollectionView): Filter[] => {
  const raw = view.definition['filters'];
  return Array.isArray(raw) ? (raw as Filter[]) : [];
};

const readSort = (view: CollectionView): Sort | null => {
  const raw = view.definition['sort'];
  return Array.isArray(raw) && raw.length > 0 ? (raw[0] as Sort) : null;
};

export function ViewRules({
  view,
  fields,
  onSave,
  onClose,
}: ViewRulesProps): ReactElement {
  const columns = fields.filter(usable);
  const [filters, setFilters] = useState<Filter[]>(() => readFilters(view));
  const [sort, setSort] = useState<Sort | null>(() => readSort(view));

  const typeOf = (fieldId: string): string =>
    fields.find((field) => field.id === fieldId)?.fieldType ?? 'text';

  /** Whether an operator wants a value at all. */
  const wantsValue = (operator: string): boolean =>
    operator !== 'isEmpty' && operator !== 'isNotEmpty';

  const save = (): void => {
    onSave({
      // Only filters that can be honoured. One with no field would be dropped
      // by the server anyway, and keeping it here would show a rule that does
      // nothing.
      ...(filters.length > 0
        ? {
            filters: filters
              .filter((filter) => filter.fieldId !== '')
              .map((filter) =>
                wantsValue(filter.operator)
                  ? filter
                  : { fieldId: filter.fieldId, operator: filter.operator },
              ),
          }
        : {}),
      ...(sort ? { sort: [sort] } : {}),
      // Anything else the view carried — a board's groupByFieldId — is kept.
      // The definition is replaced wholesale, so dropping it here would silently
      // un-group a board when somebody sorted it.
      ...Object.fromEntries(
        Object.entries(view.definition).filter(
          ([key]) => key !== 'filters' && key !== 'sort',
        ),
      ),
    });
  };

  if (columns.length === 0) {
    return (
      <div className="view-rules" role="dialog" aria-label="View rules">
        <p className="muted">
          Add a column first — there is nothing to filter or sort by yet.
        </p>
        <div className="view-rules-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-rules" role="dialog" aria-label="View rules">
      <h3>Sort</h3>
      <div className="view-rule">
        <select
          value={sort?.fieldId ?? ''}
          aria-label="Sort by"
          onChange={(event) =>
            setSort(
              event.target.value
                ? { fieldId: event.target.value, direction: sort?.direction ?? 'asc' }
                : null,
            )
          }
        >
          <option value="">Not sorted</option>
          {columns.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>

        {sort && (
          <select
            value={sort.direction}
            aria-label="Sort direction"
            onChange={(event) =>
              setSort({ ...sort, direction: event.target.value === 'desc' ? 'desc' : 'asc' })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        )}
      </div>

      <h3>Filters</h3>
      {filters.length === 0 && <p className="muted">Every entry is shown.</p>}

      {filters.map((filter, index) => {
        const operators = operatorsFor(typeOf(filter.fieldId));
        return (
          <div className="view-rule" key={`${filter.fieldId}-${index}`}>
            <select
              value={filter.fieldId}
              aria-label="Column"
              onChange={(event) => {
                const fieldId = event.target.value;
                // The operator may not apply to the new column, so it is reset
                // to one that does rather than left as a rule the server will
                // quietly skip.
                const next = operatorsFor(typeOf(fieldId))[0]?.id ?? 'is';
                setFilters((current) =>
                  current.map((entry, at) =>
                    at === index ? { fieldId, operator: next } : entry,
                  ),
                );
              }}
            >
              {columns.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>

            <select
              value={filter.operator}
              aria-label="Condition"
              onChange={(event) =>
                setFilters((current) =>
                  current.map((entry, at) =>
                    at === index ? { ...entry, operator: event.target.value } : entry,
                  ),
                )
              }
            >
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.label}
                </option>
              ))}
            </select>

            {wantsValue(filter.operator) && (
              <input
                value={String(filter.value ?? '')}
                aria-label="Value"
                type={typeOf(filter.fieldId) === 'number' ? 'number' : 'text'}
                onChange={(event) =>
                  setFilters((current) =>
                    current.map((entry, at) =>
                      at === index ? { ...entry, value: event.target.value } : entry,
                    ),
                  )
                }
              />
            )}

            <button
              type="button"
              className="view-rule-remove"
              aria-label="Remove this filter"
              onClick={() =>
                setFilters((current) => current.filter((_, at) => at !== index))
              }
            >
              <TrashIcon />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className="btn subtle"
        onClick={() =>
          setFilters((current) => [
            ...current,
            {
              fieldId: columns[0]!.id,
              operator: operatorsFor(columns[0]!.fieldType)[0]?.id ?? 'is',
            },
          ])
        }
      >
        <PlusIcon /> Add a filter
      </button>

      <div className="view-rules-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save}>
          Apply
        </button>
      </div>
    </div>
  );
}
