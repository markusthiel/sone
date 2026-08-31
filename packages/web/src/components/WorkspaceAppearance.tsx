/**
 * SONE web — choosing how a workspace looks (ADR-0030).
 *
 * The same controls entries use, not ones that resemble them: the icon grid
 * with its filter, and the palette row. Somebody who has decorated a folder has
 * already learnt this, and a second similar picker would differ in some small
 * way — the difference being what makes two worse than one.
 */

import { useMemo, useState, type ReactElement } from 'react';

import { api, type WorkspaceIcon } from '../api/client.ts';
import { ColourRow } from './EntryMenu.tsx';
import { EntryIconView, ICON_NAMES } from './EntryIconView.tsx';

export function WorkspaceAppearance({
  workspaceId,
  icon,
  onChanged,
}: {
  workspaceId: string;
  icon: WorkspaceIcon | null;
  /** Handed what was saved, so the caller does not have to guess it. */
  onChanged: (icon: WorkspaceIcon | null) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const current = icon?.icon ?? null;

  // Bounded at 300, as in the entry picker: rendering two thousand icons at
  // once is slow enough to feel like something is broken.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all =
      needle === '' ? ICON_NAMES : ICON_NAMES.filter((name) => name.includes(needle));
    return all.slice(0, 300);
  }, [query]);

  const apply = (next: WorkspaceIcon | null): void => {
    // Only the icon: sending a name the picker never asked about is how a
    // rename happens by accident.
    void api
      .updateWorkspaceIcon(workspaceId, next)
      // The server's answer rather than what was sent: if it ever normalises
      // anything, the interface should show what is stored and not what was
      // hoped for.
      .then((saved) => onChanged(saved.icon))
      .catch(() => {
        // Decoration. Nothing changes and nothing is lost.
      });
  };

  return (
    <div className="entry-appearance">
      <p className="entry-menu-label">Icon</p>

      <input
        className="entry-icon-search"
        type="search"
        value={query}
        placeholder="Search icons"
        aria-label="Search icons"
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="entry-icon-grid" role="group" aria-label="Icon">
        <button
          type="button"
          className={current === null ? 'entry-icon current' : 'entry-icon'}
          aria-pressed={current === null}
          aria-label="No icon"
          onClick={() => apply(null)}
        >
          {/* The initial, which is what a workspace shows without an icon —
              so the "none" option looks like what choosing it produces. */}
          <span className="workspace-mark-sample">A</span>
        </button>

        {matches.map((name) => (
          <button
            key={name}
            type="button"
            className={current === name ? 'entry-icon current' : 'entry-icon'}
            aria-pressed={current === name}
            aria-label={name.replace(/-/g, ' ')}
            title={name.replace(/-/g, ' ')}
            // The colours are kept when the shape changes: somebody who picked
            // blue wants blue, not blue until they change their mind about the
            // icon.
            onClick={() => apply({ ...icon, icon: name })}
          >
            <EntryIconView icon={{ kind: 'icon', value: name }} kind="page" />
          </button>
        ))}
      </div>

      <p className="entry-menu-label">Icon colour</p>
      <ColourRow
        current={icon?.iconColor ?? null}
        label="Icon colour"
        disabled={!current}
        onChoose={(color) => {
          if (!current) return;
          // Spread and delete rather than assigning undefined: this project
          // treats an absent property and one set to undefined as different
          // things, and "no colour" means absent.
          const next: WorkspaceIcon = { ...icon, icon: current };
          if (color) next.iconColor = color;
          else delete next.iconColor;
          apply(next);
        }}
      />

      <p className="entry-menu-label">Name colour</p>
      <ColourRow
        current={icon?.titleColor ?? null}
        label="Name colour"
        onChoose={(color) => {
          const next: WorkspaceIcon = { ...icon };
          if (color) next.titleColor = color;
          else delete next.titleColor;
          apply(next);
        }}
      />
    </div>
  );
}
