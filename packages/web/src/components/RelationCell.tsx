/**
 * SONE web — a relation cell (ADR-0054).
 *
 * Chips for the rows this one points at, and a picker that searches inside the
 * collection the column names. Nothing here writes to the other side: the
 * reverse is derived from the projection, which is the decision the whole record
 * turns on.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { api, type CollectionRow } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';

export function RelationCell({
  pageIds,
  targetCollectionId,
  canEdit,
  onChange,
}: {
  pageIds: string[];
  /** Which collection this column points at. */
  targetCollectionId: string;
  canEdit: boolean;
  onChange: (pageIds: string[]) => void;
}): ReactElement {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CollectionRow[]>([]);
  /**
   * Titles for the ids this cell already holds.
   *
   * Fetched once when the cell is first opened rather than with the table: a
   * table of two hundred rows with a relation column would otherwise make two
   * hundred requests, and the id is enough to draw a chip that says "a row"
   * until somebody looks.
   */
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .collection(targetCollectionId, undefined, query.trim() || undefined)
      .then((result) => {
        if (cancelled) return;
        setFound(result.rows);
        // The picker's results name rows this cell holds as well, so opening it
        // once is what turns the chips from ids into titles.
        setTitles((current) => {
          const next = new Map(current);
          for (const row of result.rows) next.set(row.id, row.title);
          return next;
        });
      })
      .catch(() => {
        // A picker that cannot load shows nothing to pick. The chips already
        // there are unaffected, which is the important half.
        setFound([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, targetCollectionId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const remove = (id: string): void => onChange(pageIds.filter((one) => one !== id));

  return (
    <div className="relation-cell" ref={box}>
      <div className="relation-chips">
        {pageIds.map((id) => (
          <span key={id} className="relation-chip">
            {/* A link, because a row is a page and the point of a relation is
                getting to the other one. */}
            <a href={paths.page(id, titles.get(id) ?? '')}>
              {titles.get(id) ?? t('relation.aRow')}
            </a>
            {canEdit && (
              <button
                type="button"
                className="relation-remove"
                aria-label={t('relation.remove')}
                onClick={() => remove(id)}
              >
                ×
              </button>
            )}
          </span>
        ))}

        {canEdit && (
          <button
            type="button"
            className="relation-add"
            aria-label={t('relation.add')}
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            +
          </button>
        )}
      </div>

      {open && (
        <div className="relation-picker">
          <input
            className="relation-search"
            autoFocus
            value={query}
            placeholder={t('relation.search')}
            aria-label={t('relation.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul>
            {found.map((row) => {
              const already = pageIds.includes(row.id);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className={already ? 'relation-option current' : 'relation-option'}
                    aria-pressed={already}
                    onClick={() =>
                      already ? remove(row.id) : onChange([...pageIds, row.id])
                    }
                  >
                    {row.title || t('page.untitled')}
                  </button>
                </li>
              );
            })}
            {found.length === 0 && <li className="muted">{t('relation.nothing')}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
