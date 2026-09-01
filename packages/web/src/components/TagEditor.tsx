/**
 * SONE web — the tags on a page.
 *
 * Chips with a text field, in the properties panel. Adding a tag matches an
 * existing one case-insensitively, so typing "meeting" beside a page tagged
 * "Meeting" joins that tag rather than making a near-duplicate — which is the
 * failure mode of every tag field that skips this.
 *
 * Suggestions come from the workspace's tags, which are derived from use: there
 * is no list to create a tag in, and none to clean up (ADR-0020).
 */

import { useT } from '../i18n/useT.tsx';
import { useState, type ReactElement } from 'react';

import type { WorkspaceTag } from '../api/client.ts';
import { derivedTagColor } from '@sone/core';

import { TagIcon } from './icons.tsx';
import { popupItem } from './popup.ts';

interface TagEditorProps {
  tags: string[];
  known: WorkspaceTag[];
  canEdit: boolean;
  onChange: (tags: string[]) => void;
}

/** Normalisation, matching @sone/core's tagKey. */
const keyOf = (raw: string): string => raw.trim().replace(/\s+/g, ' ').toLowerCase();

export function TagEditor({
  tags,
  known,
  canEdit,
  onChange,
}: TagEditorProps): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState('');

  const add = (raw: string): void => {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (value === '') return;

    const key = keyOf(value);
    if (tags.some((tag) => keyOf(tag) === key)) {
      // Already carried. Cleared rather than left, so the field does not sit
      // there looking as though the tag failed to be added.
      setDraft('');
      return;
    }

    // An existing spelling wins over what was just typed, so a workspace does
    // not end up showing "Meeting" and "meeting" as separate chips.
    const existing = known.find((tag) => tag.key === key);
    onChange([...tags, existing?.label ?? value]);
    setDraft('');
  };

  const suggestions = draft.trim()
    ? known
        .filter(
          (tag) =>
            tag.key.includes(keyOf(draft)) &&
            !tags.some((carried) => keyOf(carried) === tag.key),
        )
        .slice(0, 6)
    : [];

  /**
   * The colour a tag carries.
   *
   * From the full workspace list — that answer already accounts for a chosen
   * override — and derived locally otherwise. Not from `suggestions`, which is
   * filtered by what is being typed and would leave every chip uncoloured the
   * moment the box was empty. A tag typed a moment ago
   * is not in the list yet, and showing it grey until the next refresh would
   * make a new tag look different from the same tag on another page.
   */
  const colorFor = (tag: string): string =>
    known.find((entry) => entry.key === keyOf(tag))?.color ?? derivedTagColor(tag);

  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {tags.length === 0 && !canEdit && <span className="muted">{t('tag.none')}</span>}
        {tags.map((tag) => (
          <span
            className={`tag-chip tag-${colorFor(tag)}`}
            key={keyOf(tag)}
          >
            <TagIcon />
            {tag}
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(tags.filter((other) => keyOf(other) !== keyOf(tag)))}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {canEdit && (
        <div className="tag-input-wrap">
          <input
            className="tag-input"
            value={draft}
            placeholder={t('tag.add')}
            aria-label={t('tag.add')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                add(draft);
              } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
                // Backspace on an empty field removes the last chip, which is
                // what every tag field does and what fingers expect.
                onChange(tags.slice(0, -1));
              }
            }}
            onBlur={() => add(draft)}
          />

          {suggestions.length > 0 && (
            <div className="tag-suggestions">
              {suggestions.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  className="tag-suggestion"
                  // mousedown is prevented so the input does not blur and add
                  // the half-typed draft before the suggestion is chosen; the
                  // choice itself happens on click, which a scroll gesture does
                  // not produce.
                  onMouseDown={(event) => event.preventDefault()}
                  {...popupItem(() => add(tag.label))}
                >
                  {tag.label}
                  <span className="muted"> {tag.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
