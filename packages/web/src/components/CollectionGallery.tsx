/**
 * SONE web — a collection drawn as covers (ADR-0039).
 *
 * The same rows as the table, with a picture attached: filters, sorting and the
 * search box are the view's and apply here unchanged, which is the reason a
 * gallery is a view type rather than a display mode of the table.
 *
 * The cover is the first image in a files column (ADR-0035 gave the table
 * those), and a row without one gets a blank panel of the same size rather than
 * a placeholder image or the first picture found somewhere in its document — a
 * gallery must not show a picture that is not in the column it says it shows.
 */

import type { CollectionField, CollectionFile, CollectionRow } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import { usePageLink } from '../routes/pageLink.tsx';

interface GalleryProps {
  rows: CollectionRow[];
  /** The value columns, in the order the view shows them. */
  fields: CollectionField[];
  /** Which files column the cover comes from, if the view named one. */
  coverFieldId: string | null;
  /** What the ids in a files cell refer to. */
  files: Map<string, CollectionFile>;
}

/** The files column a cover comes from: the named one, else the first. */
export function coverField(
  fields: CollectionField[],
  coverFieldId: string | null,
): CollectionField | undefined {
  const named = coverFieldId
    ? fields.find((field) => field.id === coverFieldId && field.fieldType === 'files')
    : undefined;
  return named ?? fields.find((field) => field.fieldType === 'files');
}

/** The first image in that cell, or nothing. */
function coverOf(
  row: CollectionRow,
  field: CollectionField | undefined,
  files: Map<string, CollectionFile>,
): string | null {
  if (!field) return null;
  const value = row.values[field.id];
  if (!value || value.kind !== 'files' || !Array.isArray(value.fileIds)) return null;
  for (const id of value.fileIds) {
    // Category rather than the file name: the server decides what a file is from
    // its bytes, and a `.png` that is not a picture must not be drawn as one.
    if (files.get(id)?.category === 'image') return id;
  }
  return null;
}

/** What a card says under its name: the values the view is already showing. */
function chipsOf(
  row: CollectionRow,
  fields: CollectionField[],
  files: Map<string, CollectionFile>,
): string[] {
  const chips: string[] = [];
  for (const field of fields) {
    /*
     * A derived column first, because its value is not in `values` at all
     * (ADR-0054).
     *
     * Without this a rollup could never appear on a card: this function reads
     * `row.values`, and a rollup lives in `row.derived`. A column that works in
     * the table and is invisible in the gallery is the half-state I keep
     * finding in other people's software and had just built.
     */
    const derived = row.derived?.[field.id];
    if (derived) {
      if (typeof derived.number === 'number') chips.push(`${field.name}: ${derived.number}`);
      // The linked rows by name, and only how many when there are several: a
      // card is not the place for a list.
      else if (derived.rows && derived.rows.length > 0) {
        chips.push(
          derived.rows.length === 1
            ? (derived.rows[0]?.title ?? field.name)
            : `${field.name}: ${derived.rows.length}`,
        );
      }
      if (chips.length >= 4) break;
      continue;
    }

    const value = row.values[field.id];
    if (!value) continue;
    if (
      value.kind === 'text' ||
      value.kind === 'url' ||
      value.kind === 'email' ||
      value.kind === 'phone'
    ) {
      // Read defensively: a value's shape comes out of a document, so its type is
      // what the document claims rather than what this expects.
      if (typeof value.value === 'string' && value.value !== '') chips.push(value.value);
    } else if (value.kind === 'number') {
      chips.push(String(value.value));
    } else if (value.kind === 'date') {
      if (typeof value.start === 'string') chips.push(value.start);
    } else if (value.kind === 'checkbox') {
      if (value.value) chips.push(field.name);
    } else if (value.kind === 'files' && Array.isArray(value.fileIds)) {
      // Named rather than counted, and only the first: "plan.pdf" says more than
      // "2 files", and the cell itself is one control away.
      const first = value.fileIds.map((id) => files.get(id)?.filename).find(Boolean);
      if (first) chips.push(first);
    } else if (value.kind === 'relation' && Array.isArray(value.pageIds)) {
      // Counted, not named: this card has ids and no titles for them, and
      // fetching a title per card is a request per row for one word. The count
      // is true and the cell is one control away.
      if (value.pageIds.length > 0) chips.push(`${field.name}: ${value.pageIds.length}`);
    }
    // Select and multi-select are drawn by the table's own chips, which need the
    // option list; a gallery card showing a raw option id would be worse than
    // showing nothing.
    if (chips.length >= 4) break;
  }
  return chips;
}

export function CollectionGallery({
  rows,
  fields,
  coverFieldId,
  files,
}: GalleryProps): React.ReactElement {
  const pageLink = usePageLink();
  const { t } = useT();
  const cover = coverField(fields, coverFieldId);

  if (rows.length === 0) {
    return <p className="muted">{t('gallery.empty')}</p>;
  }

  return (
    <ul className="gallery-grid">
      {rows.map((row) => {
        const fileId = coverOf(row, cover, files);
        return (
          <li className="gallery-card" key={row.id}>
            {/* The whole card opens the row, because a row is a page — the same
                as the first column of the table and the title of a board card. */}
            <a href={pageLink(row.id, row.title)}>
              {fileId ? (
                <img
                  className="gallery-cover"
                  src={`/api/files/${fileId}`}
                  alt=""
                  loading="lazy"
                />
              ) : (
                // A panel of the same size rather than an icon: what keeps a
                // grid a grid is that every cell is the same shape.
                <span className="gallery-cover gallery-cover-empty" aria-hidden="true" />
              )}

              <span className="gallery-card-body">
                <strong>{row.title || 'Untitled'}</strong>
                <span className="gallery-chips">
                  {chipsOf(row, fields, files).map((chip, at) => (
                    <span className="gallery-chip" key={`${chip}-${at}`}>
                      {chip}
                    </span>
                  ))}
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
