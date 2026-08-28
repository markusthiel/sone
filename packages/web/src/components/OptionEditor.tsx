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
  onSave: (options: EditableOption[]) => void;
  onClose: () => void;
}

/** A new id. Not derived from the name, which changes. */
const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function OptionEditor({
  options,
  onSave,
  onClose,
}: OptionEditorProps): ReactElement {
  const [draft, setDraft] = useState<EditableOption[]>(options);

  const update = (id: string, changes: Partial<EditableOption>): void =>
    setDraft((current) =>
      current.map((option) => (option.id === id ? { ...option, ...changes } : option)),
    );

  return (
    <div className="option-editor" role="dialog" aria-label="Options">
      <ul className="option-list">
        {draft.map((option) => (
          <li key={option.id}>
            <span className={`option-swatch option-${option.color}`} aria-hidden="true" />
            <input
              className="option-name"
              value={option.name}
              aria-label="Option name"
              onChange={(event) => update(option.id, { name: event.target.value })}
            />
            <select
              className="option-color"
              value={option.color}
              aria-label={`Colour for ${option.name || 'this option'}`}
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
              aria-label={`Remove ${option.name || 'this option'}`}
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
          No options yet. Add one, then pick it in a cell.
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
          <PlusIcon /> Add option
        </button>
        <span className="option-editor-spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Cancel
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
          Save
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
        Rename an option freely — entries keep it. Removing one hides it from the
        entries that use it, and adding a new option with the same name does not
        bring them back.
      </p>
    </div>
  );
}
