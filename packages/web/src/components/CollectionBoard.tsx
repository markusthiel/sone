/**
 * SONE web — a collection as a board.
 *
 * Grouped by a select column: each option is a column, and dragging a card into
 * one sets that value. That drag *is* the feature — a board that cannot be
 * rearranged by hand is a grouped list, which the table already gives you.
 *
 * ## What a board is not
 *
 * It is not a different set of rows. Every view of a collection shows the same
 * entries, because they are the folder's contents; a board only arranges them.
 * So there is no "add to this column" that creates a hidden row, and moving a
 * card between columns changes one value rather than moving a page.
 *
 * ## Entries with no value
 *
 * They get their own column, first. Hiding them would mean a board that shows
 * fewer entries than the table, with no indication that anything is missing —
 * and the entries most likely to need attention are exactly the unsorted ones.
 */

import { useMemo, type ReactElement } from 'react';

import type {
  CollectionField,
  CollectionRow,
  StoredCellValue,
} from '../api/client.ts';
import { usePointerDrag } from '../hooks/usePointerDrag.ts';
import { paths } from '../routes/paths.ts';
import { optionsOf } from './CollectionTable.tsx';

interface BoardProps {
  rows: CollectionRow[];
  /** The select column the board groups by. */
  groupBy: CollectionField;
  canEdit: boolean;
  onSetValue: (rowId: string, value: StoredCellValue | null) => void;
}

/** The column for entries with no value. Not an option id, so it cannot clash. */
const UNSET = '\u0000unset';

export function CollectionBoard({
  rows,
  groupBy,
  canEdit,
  onSetValue,
}: BoardProps): ReactElement {
  const options = useMemo(() => optionsOf(groupBy), [groupBy]);

  /**
   * Which column each entry belongs in.
   *
   * A value pointing at a removed option counts as unset here, so the entry
   * appears rather than vanishing into a column that is not drawn. The value
   * itself is untouched — it is still in the document, and restoring the option
   * would bring the card back to its place.
   */
  const columns = useMemo(() => {
    const known = new Set(options.map((option) => option.id));
    const grouped = new Map<string, CollectionRow[]>();
    grouped.set(UNSET, []);
    for (const option of options) grouped.set(option.id, []);

    for (const row of rows) {
      const value = row.values[groupBy.id];
      const optionId =
        value?.kind === 'select' && typeof value.optionId === 'string'
          ? value.optionId
          : null;
      const column = optionId !== null && known.has(optionId) ? optionId : UNSET;
      grouped.get(column)!.push(row);
    }
    return grouped;
  }, [rows, options, groupBy.id]);

  const drag = usePointerDrag<string>({
    idFrom: (element) => (canEdit ? (element.dataset['boardCard'] ?? null) : null),
    targetAt: (x, y, draggedId) => {
      const element = document.elementFromPoint(x, y);
      const column = element?.closest<HTMLElement>('[data-board-column]');
      const columnId = column?.dataset['boardColumn'];
      if (!columnId) return null;

      // Its own column offers nothing.
      const value = rows.find((row) => row.id === draggedId)?.values[groupBy.id];
      const current =
        value?.kind === 'select' && typeof value.optionId === 'string'
          ? value.optionId
          : UNSET;
      return columnId === current ? null : columnId;
    },
    canDrop: () => canEdit,
    onDrop: (rowId, columnId) => {
      onSetValue(
        rowId,
        columnId === UNSET ? null : { kind: 'select', optionId: columnId },
      );
    },
  });

  const dragged = drag.dragging
    ? rows.find((row) => row.id === drag.dragging)
    : undefined;

  return (
    <div className="board">
      {[{ id: UNSET, name: 'No value', color: 'grey' }, ...options].map((option) => {
        const entries = columns.get(option.id) ?? [];
        return (
          <section
            key={option.id}
            className="board-column"
            data-board-column={option.id}
            data-drop={drag.target === option.id ? 'into' : undefined}
          >
            <header className="board-column-head">
              <span
                className={`option-swatch option-${option.color}`}
                aria-hidden="true"
              />
              <span className="board-column-name">{option.name || 'Untitled'}</span>
              <span className="board-column-count">{entries.length}</span>
            </header>

            <ul className="board-cards">
              {entries.map((row) => (
                <li
                  key={row.id}
                  className="board-card"
                  data-board-card={row.id}
                  data-dragging={drag.dragging === row.id ? 'true' : undefined}
                  onPointerDown={drag.onPointerDown}
                >
                  {/* A card is a page, so its title opens it — the same as the
                      first column of the table. */}
                  <a href={paths.page(row.id, row.title)}>
                    {row.title || <span className="muted">Untitled</span>}
                  </a>
                </li>
              ))}
            </ul>

            {entries.length === 0 && (
              <p className="muted board-empty">
                {option.id === UNSET ? 'Everything is sorted.' : 'Nothing here yet.'}
              </p>
            )}
          </section>
        );
      })}

      {/* What is travelling. The highlighted column says where it will land; it
          does not say what is moving. */}
      {dragged && drag.pointer && (
        <div
          className="board-drag-preview"
          style={{ left: drag.pointer.x, top: drag.pointer.y }}
          aria-hidden="true"
        >
          {dragged.title || 'Untitled'}
        </div>
      )}
    </div>
  );
}
