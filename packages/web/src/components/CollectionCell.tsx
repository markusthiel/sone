/**
 * SONE web — drawing one cell of a collection.
 *
 * Moved out of `CollectionTable.tsx`, where these four functions were the last
 * five hundred lines, when a row's own page needed to draw its cells too
 * (ADR-0054's deferred item). One renderer, imported twice — the alternative
 * being two that drift, which is precisely what I had just found between the
 * table and the gallery: a rollup the table drew and a card could not.
 *
 * The move was safe to make mechanically because the four were contiguous at
 * the end of the file. Nothing about them changed.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { api } from '../api/client.ts';
import type {
  CollectionField,
  CollectionFile,
  DerivedCellValue,
  StoredCellValue,
} from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { paths } from '../routes/paths.ts';
import { PaperclipIcon, PlusIcon } from './icons.tsx';
import { RelationCell } from './RelationCell.tsx';
import type { EditableOption } from './OptionEditor.tsx';

export function FilesCell({
  field,
  value,
  canEdit,
  files,
  pageId,
  onChange,
  onUploaded,
}: {
  field: CollectionField;
  value: StoredCellValue | null;
  canEdit: boolean;
  files: Map<string, CollectionFile>;
  pageId: string;
  onChange: (value: StoredCellValue | null) => void;
  onUploaded: (file: CollectionFile) => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const ids = value?.kind === 'files' && Array.isArray(value.fileIds) ? value.fileIds : [];

  const set = (next: string[]): void =>
    onChange(next.length === 0 ? null : { kind: 'files', fileIds: next });

  const upload = async (chosen: File): Promise<void> => {
    setBusy(true);
    try {
      // Uploaded against the row, which is a page — so the file is authorised
      // through the thing it belongs to, and deleting the row takes it along.
      const result = await api.uploadFile(pageId, chosen);
      onUploaded({
        id: result.id,
        filename: result.filename,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        category: result.category,
      });
      set([...ids, result.id]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cell-files">
      {ids.map((id) => {
        const file = files.get(id);
        const name = file?.filename ?? 'File';
        return (
          <span className="cell-file" key={id}>
            <a href={`/api/files/${id}`} target="_blank" rel="noreferrer" title={name}>
              {file?.category === 'image' ? (
                // The thumbnail is the name, for an image: a filename out of a
                // camera says nothing and the picture says everything.
                <img src={`/api/files/${id}`} alt={name} loading="lazy" />
              ) : (
                <>
                  <PaperclipIcon />
                  <span className="cell-file-name">{name}</span>
                </>
              )}
            </a>
            {canEdit && (
              <button
                type="button"
                className="cell-file-remove"
                aria-label={`Remove ${name}`}
                // The reference goes; the file stays where it was uploaded, on
                // the row's own page. Removing a chip is not deleting a file, and
                // a cell is the wrong place to make that decision.
                onClick={() => set(ids.filter((other) => other !== id))}
              >
                ×
              </button>
            )}
          </span>
        );
      })}

      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            className="cell-file-input"
            aria-label={`Add a file to ${field.name}`}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen) void upload(chosen);
            }}
          />
          <button
            type="button"
            className="cell-file-add"
            disabled={busy}
            title={`Add a file to ${field.name}`}
            aria-label={`Add a file to ${field.name}`}
            onClick={() => input.current?.click()}
          >
            {busy ? '…' : <PlusIcon />}
          </button>
        </>
      )}
    </div>
  );
}

/** How long after the last keystroke a text cell is saved. */
export const SAVE_DELAY_MS = 600;

/*
 * The options of a select column, read defensively.
 *
 * Moved here with the cells rather than left behind: both this module and the
 * table need it, and a copy in each is how two answers to one question begin.
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


export function Cell({
  field,
  value,
  derived,
  canEdit,
  files,
  pageId,
  onChange,
  onUploaded,
}: {
  field: CollectionField;
  value: StoredCellValue | null;
  canEdit: boolean;
  /** What the ids in a files cell refer to. Empty for every other type. */
  files: Map<string, CollectionFile>;
  /** The row, which is the page a file uploaded here belongs to. */
  pageId: string;
  /** What the server computed for this cell, when the column is derived. */
  derived: DerivedCellValue | null;
  onChange: (value: StoredCellValue | null) => void;
  /** So a newly uploaded file can be named before the next reload. */
  onUploaded: (file: CollectionFile) => void;
}): ReactElement {
  // `Cell` had no translations of its own; the partial marker needs one.
  const { t } = useT();

  /*
   * A derived column is read-only, and drawn before anything else asks what
   * kind it is (ADR-0054).
   *
   * Before, because the alternative is a branch per derived type in a dispatch
   * that is about *stored* kinds — and because an editable cell whose value the
   * server computes would be a lie the moment somebody typed in it.
   */
  if (field.fieldType === 'rollup') {
    if (!derived) return <span className="muted">—</span>;
    return (
      <span className="derived-cell">
        {derived.rows
          ? derived.rows.map((row, at) => (
              <span key={row.id}>
                {at > 0 && ', '}
                <a href={paths.page(row.id, row.title)}>{row.title || '—'}</a>
              </span>
            ))
          : (derived.number ?? '—')}
        {/* Said, not hidden: two people seeing different numbers on one page is
            correct, and looks like a fault when nothing explains it. */}
        {derived.partial && (
          <span className="derived-partial" title={t('rollup.partial')}>
            {' *'}
          </span>
        )}
      </span>
    );
  }
  if (field.fieldType === 'relation') {
    /*
     * Which collection this points at, from the column's own config (ADR-0054).
     *
     * A relation cannot be created without it, so absence here means the config
     * was edited into that state — drawn as nothing rather than as a picker
     * over everything, which is what the column would have been if the target
     * were optional.
     */
    const target = field.config?.['collectionId'];
    if (typeof target !== 'string' || target === '') return <span className="muted">—</span>;

    const ids =
      value?.kind === 'relation' && Array.isArray(value.pageIds)
        ? value.pageIds.filter((one): one is string => typeof one === 'string')
        : [];

    return (
      <RelationCell
        pageIds={ids}
        targetCollectionId={target}
        canEdit={canEdit}
        onChange={(next) =>
          // An empty relation is no value rather than an empty list: the same
          // shape every other cell uses for "nothing here".
          onChange(next.length > 0 ? { kind: 'relation', pageIds: next } : null)
        }
      />
    );
  }

  if (field.fieldType === 'files') {
    return (
      <FilesCell
        field={field}
        value={value}
        canEdit={canEdit}
        files={files}
        pageId={pageId}
        onChange={onChange}
        onUploaded={onUploaded}
      />
    );
  }

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
  const { t } = useT();
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
        {t('table.noOptions')}
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
        <span className="collection-missing-option" title={t('table.removedOption')}>
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
/**
 * Turn one pasted string into a value the column can hold (ADR-0034).
 *
 * Text arrives from a clipboard with no types in it, so the column decides.
 * Anything that cannot be read as the column's type becomes null — an empty cell
 * rather than a refused paste, because one unparseable date in fifty rows should
 * not cost somebody the other forty-nine, and an empty cell is visible.
 *
 * A select is matched on the option's *name*, which is what a spreadsheet
 * contains; an unknown name is null rather than a new option, for the reason the
 * ADR gives about inferring structure from data.
 */
export function valueFromText(
  field: CollectionField,
  text: string,
): StoredCellValue | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  switch (field.fieldType) {
    case 'number': {
      // A comma decimal separator, because that is what a German spreadsheet
      // writes and the paste is the one place this application meets one.
      const parsed = Number(trimmed.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(parsed) ? { kind: 'number', value: parsed } : null;
    }
    case 'checkbox': {
      const yes = ['true', 'yes', 'y', '1', 'x', 'ja', 'wahr', '✓'];
      return yes.includes(trimmed.toLowerCase()) ? { kind: 'checkbox', value: true } : null;
    }
    case 'date': {
      // ISO only. Guessing between 03/04 as March and April is a coin toss with
      // somebody's data, and a wrong date looks right.
      return /^\d{4}-\d{2}-\d{2}/.test(trimmed)
        ? { kind: 'date', start: trimmed.slice(0, 10), end: null }
        : null;
    }
    case 'select':
    case 'multiSelect': {
      const options = optionsOf(field);
      const names = trimmed.split(',').map((part) => part.trim().toLowerCase());
      const matched = options.filter((option) => names.includes(option.name.toLowerCase()));
      if (matched.length === 0) return null;
      return field.fieldType === 'select'
        ? { kind: 'select', optionId: matched[0]!.id }
        : { kind: 'multiSelect', optionIds: matched.map((option) => option.id) };
    }
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return { kind: field.fieldType, value: text } as StoredCellValue;
    default:
      // A derived column, or one this table cannot edit. Skipped rather than
      // guessed at.
      return null;
  }
}

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
