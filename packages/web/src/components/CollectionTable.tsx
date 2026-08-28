/**
 * SONE web — a collection as a table.
 *
 * The placeholder this replaces was the last visible "not built yet" in the
 * application.
 *
 * Two decisions shape it.
 *
 * **A row is a page.** The first column is its title, and clicking it opens the
 * page — because that is what it is. A collection is a folder with columns, not
 * a spreadsheet that happens to live in a notes app, and a row that could not be
 * opened would be a record rather than a note.
 *
 * **Only column types that can be filled are offered.** The model knows about
 * select, relation, formula and rollup; this offers text, number, date,
 * checkbox and the three text-like ones, because those are the ones a cell here
 * can actually edit. A select column with no way to manage its options is a
 * column nobody can fill, and offering one is worse than leaving it out.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import {
  ApiError,
  api,
  type CollectionData,
  type CollectionField,
  type StoredCellValue,
} from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { ListIcon, PlusIcon, TrashIcon } from './icons.tsx';
import { OptionEditor, type EditableOption } from './OptionEditor.tsx';

interface CollectionTableProps {
  pageId: string;
  /** Creates a row, which is an ordinary page inside the folder. */
  onCreateRow: () => void;
}

/** Column types this table can edit. See the note above. */
const ADDABLE: ReadonlyArray<{ type: string; label: string }> = [
  { type: 'text', label: 'Text' },
  // Offered now that its options can be managed. It was held back precisely
  // because a column whose options nobody can edit is one nobody can fill.
  { type: 'select', label: 'Select' },
  { type: 'multiSelect', label: 'Multi-select' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'Link' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
];

/** How long after the last keystroke a text cell is saved. */
const SAVE_DELAY_MS = 600;

export function CollectionTable({
  pageId,
  onCreateRow,
}: CollectionTableProps): ReactElement {
  const [data, setData] = useState<CollectionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.collection(pageId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Apply a value locally, then save it.
   *
   * Local first, because a cell that only updates after a round trip feels
   * broken while typing. The reload afterwards is what makes a rejected write
   * visible rather than silently kept on screen.
   */
  const write = useCallback(
    async (rowId: string, fieldId: string, value: StoredCellValue | null) => {
      setData((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.id === rowId
                  ? {
                      ...row,
                      values: { ...row.values, [fieldId]: value ?? undefined },
                    }
                  : row,
              ),
            }
          : current,
      );

      try {
        await api.setCellValue(rowId, fieldId, value);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
        // Reloaded so the screen shows what was stored rather than what was
        // typed. A refused value left in place is a lie about saved work.
        await load();
      }
    },
    [load],
  );

  const addColumn = async (fieldType: string): Promise<void> => {
    setAddingColumn(false);
    try {
      await api.addCollectionField(pageId, { name: 'Untitled', fieldType });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const removeColumn = async (fieldId: string): Promise<void> => {
    try {
      await api.removeCollectionField(pageId, fieldId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const saveOptions = async (
    fieldId: string,
    options: Array<{ id: string; name: string; color: string }>,
  ): Promise<void> => {
    try {
      await api.setFieldOptions(pageId, fieldId, options);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const renameColumn = async (fieldId: string, name: string): Promise<void> => {
    try {
      await api.renameCollectionField(pageId, fieldId, name);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  if (error && !data) return <p className="error">{messageFor(error)}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const columns = data.fields.filter((field) => field.id !== data.titleFieldId);
  const titleField = data.fields.find((field) => field.id === data.titleFieldId);

  return (
    <div className="collection">
      {error && <p className="error">{messageFor(error)}</p>}

      <div className="collection-scroll">
        <table className="collection-table">
          <thead>
            <tr>
              <th className="collection-title-column">{titleField?.name ?? 'Name'}</th>
              {columns.map((field) => (
                <th key={field.id}>
                  <ColumnHeader
                    field={field}
                    canEdit={data.canEdit}
                    onRename={(name) => void renameColumn(field.id, name)}
                    onRemove={() => void removeColumn(field.id)}
                    onSaveOptions={(options) => void saveOptions(field.id, options)}
                  />
                </th>
              ))}
              {data.canEdit && (
                <th className="collection-add-column">
                  <button
                    type="button"
                    className="collection-add"
                    aria-label="Add a column"
                    onClick={() => setAddingColumn((open) => !open)}
                  >
                    <PlusIcon />
                  </button>
                  {addingColumn && (
                    <div className="collection-type-menu" role="menu">
                      {ADDABLE.map((entry) => (
                        <button
                          key={entry.type}
                          type="button"
                          role="menuitem"
                          onClick={() => void addColumn(entry.type)}
                        >
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  )}
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td className="collection-title-column">
                  {/* A row is a page, so its title opens it. */}
                  <a href={paths.page(row.id, row.title)}>
                    {row.title || <span className="muted">Untitled</span>}
                  </a>
                </td>
                {columns.map((field) => (
                  <td key={field.id}>
                    <Cell
                      field={field}
                      value={row.values[field.id] ?? null}
                      canEdit={data.canEdit}
                      onChange={(value) => void write(row.id, field.id, value)}
                    />
                  </td>
                ))}
                {data.canEdit && <td />}
              </tr>
            ))}

            {data.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="muted">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data.canEdit && (
        <button type="button" className="collection-add-row" onClick={onCreateRow}>
          <PlusIcon /> New entry
        </button>
      )}
    </div>
  );
}

/** A column heading: rename in place, or remove. */
function ColumnHeader({
  field,
  canEdit,
  onRename,
  onRemove,
  onSaveOptions,
}: {
  field: CollectionField;
  canEdit: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onSaveOptions: (options: EditableOption[]) => void;
}): ReactElement {
  const [name, setName] = useState(field.name);
  const [editingOptions, setEditingOptions] = useState(false);
  const hasOptions = field.fieldType === 'select' || field.fieldType === 'multiSelect';

  // Reset when the column changes underneath, which happens when somebody else
  // renames it. Without this the local value would win silently.
  useEffect(() => setName(field.name), [field.name]);

  if (!canEdit) {
    return (
      <span className="collection-column-name">
        {field.name}
        <span className="collection-column-type">{field.fieldType}</span>
      </span>
    );
  }

  return (
    <span className="collection-column">
      <input
        className="collection-column-input"
        value={name}
        aria-label={`Rename the ${field.name} column`}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== field.name) onRename(trimmed);
          else setName(field.name);
        }}
      />
      {hasOptions && (
        <button
          type="button"
          className="collection-column-options"
          aria-label={`Edit the options of ${field.name}`}
          onClick={() => setEditingOptions((open) => !open)}
        >
          <ListIcon />
        </button>
      )}
      <button
        type="button"
        className="collection-column-remove"
        aria-label={`Remove the ${field.name} column`}
        onClick={onRemove}
      >
        <TrashIcon />
      </button>

      {editingOptions && (
        <OptionEditor
          options={optionsOf(field)}
          onClose={() => setEditingOptions(false)}
          onSave={(options) => {
            setEditingOptions(false);
            onSaveOptions(options);
          }}
        />
      )}
    </span>
  );
}

/**
 * A field's options, defensively.
 *
 * `config` is whatever the document held, so it is checked rather than cast.
 * A malformed entry here would become an option with no id, and a cell pointing
 * at it could never be read back.
 */
export function optionsOf(field: CollectionField): EditableOption[] {
  const raw = field.config['options'];
  if (!Array.isArray(raw)) return [];

  const out: EditableOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, color } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') continue;
    out.push({
      id,
      name: typeof name === 'string' ? name : '',
      color: typeof color === 'string' ? color : 'grey',
    });
  }
  return out;
}

/**
 * One cell.
 *
 * Each type gets the input a browser already knows how to present: a date
 * picker for dates, a checkbox for booleans, `type="url"` for links. That is
 * not only less code — a native date input is the thing people already know how
 * to use, and on a phone it brings up the right keyboard.
 */
function Cell({
  field,
  value,
  canEdit,
  onChange,
}: {
  field: CollectionField;
  value: StoredCellValue | null;
  canEdit: boolean;
  onChange: (value: StoredCellValue | null) => void;
}): ReactElement {
  if (field.fieldType === 'checkbox') {
    const checked = value?.kind === 'checkbox' && value.value === true;
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled={!canEdit}
        aria-label={field.name}
        // No debounce: a checkbox is one decision, and delaying it means the
        // tick can be lost by navigating away.
        onChange={(event) =>
          onChange(event.target.checked ? { kind: 'checkbox', value: true } : null)
        }
      />
    );
  }

  if (field.fieldType === 'date') {
    const start = value?.kind === 'date' ? String(value.start).slice(0, 10) : '';
    return (
      <input
        type="date"
        value={start}
        disabled={!canEdit}
        aria-label={field.name}
        onChange={(event) =>
          onChange(
            event.target.value
              ? { kind: 'date', start: event.target.value, end: null }
              : null,
          )
        }
      />
    );
  }

  if (field.fieldType === 'number') {
    return (
      <TextishCell
        field={field}
        canEdit={canEdit}
        inputType="number"
        initial={value?.kind === 'number' ? String(value.value) : ''}
        toValue={(text) => {
          const trimmed = text.trim();
          if (trimmed === '') return null;
          const parsed = Number(trimmed);
          // Refused rather than stored as NaN, which no reader could
          // meaningfully display or compare.
          return Number.isFinite(parsed) ? { kind: 'number', value: parsed } : null;
        }}
        onChange={onChange}
      />
    );
  }

  if (field.fieldType === 'select' || field.fieldType === 'multiSelect') {
    return (
      <SelectCell
        field={field}
        value={value}
        canEdit={canEdit}
        multiple={field.fieldType === 'multiSelect'}
        onChange={onChange}
      />
    );
  }

  const kind = field.fieldType === 'text' ? 'text' : field.fieldType;
  const inputType =
    field.fieldType === 'url' ? 'url' : field.fieldType === 'email' ? 'email' : 'text';

  return (
    <TextishCell
      field={field}
      canEdit={canEdit}
      inputType={inputType}
      initial={textOf(value)}
      toValue={(text) =>
        text.trim() === '' ? null : ({ kind, value: text } as StoredCellValue)
      }
      onChange={onChange}
    />
  );
}

/**
 * A select cell.
 *
 * A native `<select>`, and a native multiple-select for the multi variant. Not a
 * custom popup: the native control already handles keyboard, screen readers and
 * the phone's own picker, and a table full of custom dropdowns is a table that
 * feels heavy to scroll.
 *
 * An option that no longer exists is shown as such rather than as an empty cell.
 * The value is still stored — a row owns its values — and telling somebody the
 * cell is empty when it is not would invite them to overwrite it without knowing
 * what they lost.
 */
function SelectCell({
  field,
  value,
  canEdit,
  multiple,
  onChange,
}: {
  field: CollectionField;
  value: StoredCellValue | null;
  canEdit: boolean;
  multiple: boolean;
  onChange: (value: StoredCellValue | null) => void;
}): ReactElement {
  const options = optionsOf(field);
  const known = new Set(options.map((option) => option.id));

  const chosen: string[] =
    value?.kind === 'select' && typeof value.optionId === 'string'
      ? [value.optionId]
      : value?.kind === 'multiSelect' && Array.isArray(value.optionIds)
        ? (value.optionIds as string[])
        : [];

  const missing = chosen.filter((id) => !known.has(id));

  if (options.length === 0) {
    return (
      <span className="muted collection-no-options">
        No options — add some in the column heading
      </span>
    );
  }

  return (
    <span className="collection-select">
      <select
        multiple={multiple}
        value={multiple ? chosen : (chosen[0] ?? '')}
        disabled={!canEdit}
        aria-label={field.name}
        onChange={(event) => {
          if (multiple) {
            const picked = [...event.target.selectedOptions].map((option) => option.value);
            onChange(picked.length > 0 ? { kind: 'multiSelect', optionIds: picked } : null);
            return;
          }
          const picked = event.target.value;
          onChange(picked === '' ? null : { kind: 'select', optionId: picked });
        }}
      >
        {/* Only for the single variant: clearing a multiple select is done by
            deselecting, and an empty entry there would look like an option. */}
        {!multiple && <option value="">—</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {missing.length > 0 && (
        <span className="collection-missing-option" title="This option was removed">
          {missing.length === 1 ? 'removed option' : `${missing.length} removed options`}
        </span>
      )}
    </span>
  );
}

/**
 * The text a value holds, if it holds text at all.
 *
 * Checked rather than indexed. A column's type can be changed, so a cell may be
 * holding a value of an older kind — a number where the column now says text —
 * and reading `.value` blindly would put `42` into a text box as though it had
 * been typed there. The tag exists precisely so that cannot happen quietly, and
 * the compiler refused to let me ignore it.
 */
export function textOf(value: StoredCellValue | null): string {
  if (!value) return '';
  const kind = value.kind;
  if (kind === 'text' || kind === 'url' || kind === 'email' || kind === 'phone') {
    return typeof value.value === 'string' ? value.value : '';
  }
  return '';
}

/**
 * A cell backed by a text input, saved shortly after typing stops.
 *
 * Debounced because a request per keystroke would put a document update per
 * character through the sync layer — and every collaborator would receive them.
 */
function TextishCell({
  field,
  canEdit,
  inputType,
  initial,
  toValue,
  onChange,
}: {
  field: CollectionField;
  canEdit: boolean;
  inputType: string;
  initial: string;
  toValue: (text: string) => StoredCellValue | null;
  onChange: (value: StoredCellValue | null) => void;
}): ReactElement {
  const [text, setText] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Follow the stored value unless there are unsaved keystrokes, so a change
  // from somebody else appears without overwriting what is being typed.
  useEffect(() => {
    if (!dirty.current) setText(initial);
  }, [initial]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = (next: string): void => {
    dirty.current = true;
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      onChange(toValue(next));
    }, SAVE_DELAY_MS);
  };

  return (
    <input
      type={inputType}
      value={text}
      disabled={!canEdit}
      aria-label={field.name}
      onChange={(event) => schedule(event.target.value)}
      onBlur={() => {
        // Saved immediately on leaving, or a value typed and then clicked away
        // from would wait on a timer the person cannot see.
        if (timer.current) clearTimeout(timer.current);
        if (dirty.current) {
          dirty.current = false;
          onChange(toValue(text));
        }
      }}
    />
  );
}
