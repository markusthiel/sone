/**
 * SONE web — editing a select column's options.
 *
 * The piece that makes select columns usable, and the reason they were held
 * back: a column whose options nobody can manage is a column nobody can fill.
 *
 * The rule this interface has to respect: **an option's id never changes.** A
 * row's value points at an id, not at a name, so renaming has to keep the id or
 * every row pointing at that option loses its value. New options get a new id;
 * existing ones keep theirs, including through a rename and a colour change.
 */

import { useT } from '../i18n/useT.tsx';
import { useState, type ReactElement } from 'react';

import { OPTION_COLORS } from '@sone/core';

import { PlusIcon, TrashIcon } from './icons.tsx';

export interface EditableOption {
  id: string;
  name: string;
  color: string;
}

interface OptionEditorProps {
  options: EditableOption[];
  /**
   * Where to draw it, in viewport coordinates.
   *
   * Against the viewport rather than inside the column heading, because the
   * table scrolls and a scroller with `overflow-x: auto` clips the other axis
   * too — the panel was cut off at the edge of the table, which is what was
   * reported. The caller measures the button it hangs from.
   */
  at: { x: number; y: number };
  onSave: (options: EditableOption[]) => void;
  onClose: () => void;
}

/** A new id. Not derived from the name, which changes. */
const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function OptionEditor({
  options,
  at,
  onSave,
  onClose,
}: OptionEditorProps): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState<EditableOption[]>(options);

  const update = (id: string, changes: Partial<EditableOption>): void =>
    setDraft((current) =>
      current.map((option) => (option.id === id ? { ...option, ...changes } : option)),
    );

  return (
    <div
      className="option-editor"
      role="dialog"
      aria-label={t('option.options')}
      // Clamped so the panel cannot leave the window on the right, which is
      // where a last column's heading is.
      style={{
        left: `min(${Math.round(at.x)}px, calc(100vw - 23rem))`,
        top: `${Math.round(at.y)}px`,
      }}
    >
      <ul className="option-list">
        {draft.map((option) => (
          <li key={option.id}>
            <span className={`option-swatch option-${option.color}`} aria-hidden="true" />
            <input
              className="option-name"
              value={option.name}
              aria-label={t('option.name')}
              onChange={(event) => update(option.id, { name: event.target.value })}
            />
            <select
              className="option-color"
              value={option.color}
              aria-label={t('option.colourFor', { option: option.name || t('option.thisOne') })}
              onChange={(event) => update(option.id, { color: event.target.value })}
            >
              {OPTION_COLORS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="option-remove"
              aria-label={t('option.remove', { option: option.name || t('option.thisOne') })}
              onClick={() =>
                setDraft((current) => current.filter((entry) => entry.id !== option.id))
              }
            >
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>

      {draft.length === 0 && (
        <p className="muted option-empty">
          {t('option.none')}
        </p>
      )}

      <div className="option-editor-actions">
        <button
          type="button"
          className="option-add"
          onClick={() =>
            setDraft((current) => [
              ...current,
              // A fresh id: reusing one would attach this option to whatever
              // rows pointed at the old one.
              { id: newId(), name: '', color: 'grey' },
            ])
          }
        >
          <PlusIcon /> {t('option.add')}
        </button>
        <span className="option-editor-spacer" />
        <button type="button" className="btn" onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            // Empty names are dropped rather than saved: an unnamed option is
            // indistinguishable from every other unnamed one in a cell.
            onSave(draft.filter((option) => option.name.trim() !== ''))
          }
        >
          {t('you.save')}
        </button>
      </div>

      {/* Accurate rather than reassuring.
       *
       * A first draft of this said "add it back with the same name to see them
       * again", which is false: a new option gets a new id, and a row's value
       * points at an id. Renaming preserves values; removing does not, and
       * saying otherwise would invite somebody to remove a column's options
       * expecting an undo that does not exist. */}
      <p className="muted option-note">
        {t('option.rename.note')}
      </p>
    </div>
  );
}
