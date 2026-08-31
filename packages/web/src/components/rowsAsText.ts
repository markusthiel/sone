/**
 * SONE web — selected rows, as text (ADR-0040).
 *
 * Two formats, and the difference is deliberate.
 *
 * Tab-separated for the clipboard, because that is exactly what a pasted grid is
 * read as (ADR-0034) — so copy and paste round-trip: in this table, into another
 * table, and out to a spreadsheet. Which also answers "duplicate these rows"
 * without a second action, since a paste appends and never overwrites.
 *
 * CSV for a file, because a `.csv` is what a spreadsheet opens by double-click.
 * Quoted on demand rather than always: a value containing a comma, a quote or a
 * newline is wrapped and its quotes doubled, and one that contains none of them
 * is left as it is so the file stays readable.
 *
 * Both take the rows they are given — the filtered, sorted, searched ones the view
 * is showing. An export that quietly widened the selection back to the whole
 * table would be the one place that ignored the filter, and nobody would notice
 * until a spreadsheet had the wrong rows in it.
 */

import type { CollectionField, CollectionFile, CollectionRow } from '../api/client.ts';

/** What one cell reads as, in either format. */
export function cellText(
  row: CollectionRow,
  field: CollectionField,
  files: Map<string, CollectionFile>,
): string {
  const value = row.values[field.id];
  if (!value) return '';

  switch (value.kind) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof value.value === 'string' ? value.value : '';
    case 'number':
      return String(value.value);
    case 'checkbox':
      // Words rather than true/false: a spreadsheet column of "yes" reads, and a
      // column of "TRUE" is a spreadsheet's own boolean in one locale and a
      // string in another.
      return value.value ? 'yes' : 'no';
    case 'date':
      return typeof value.start === 'string' ? value.start : '';
    case 'select':
      // The option's own text is not on the value — it is in the column's
      // configuration, so the caller resolves it and this is the fallback.
      return typeof value.optionId === 'string' ? value.optionId : '';
    case 'files':
      return Array.isArray(value.fileIds)
        ? value.fileIds
            .map((id) => files.get(id)?.filename)
            .filter((name): name is string => typeof name === 'string')
            .join(', ')
        : '';
    default:
      return '';
  }
}

/** The header, then a line per row: the title first, then the view's columns. */
function grid(
  rows: CollectionRow[],
  fields: CollectionField[],
  files: Map<string, CollectionFile>,
  titleHeading: string,
): string[][] {
  return [
    [titleHeading, ...fields.map((field) => field.name)],
    ...rows.map((row) => [
      row.title,
      ...fields.map((field) => cellText(row, field, files)),
    ]),
  ];
}

/** For the clipboard. Tabs and newlines, which is what a paste reads. */
export function rowsAsTabbed(
  rows: CollectionRow[],
  fields: CollectionField[],
  files: Map<string, CollectionFile>,
  titleHeading = 'Name',
): string {
  return grid(rows, fields, files, titleHeading)
    // A tab or a newline inside a value would become a cell boundary, so they
    // are flattened to spaces: the clipboard format has no way to escape them,
    // and silently splitting somebody's sentence into two cells is worse than
    // losing a line break.
    .map((line) => line.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

/** For a file. Quoted where a value needs it. */
export function rowsAsCsv(
  rows: CollectionRow[],
  fields: CollectionField[],
  files: Map<string, CollectionFile>,
  titleHeading = 'Name',
): string {
  const quote = (cell: string): string =>
    /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;

  return grid(rows, fields, files, titleHeading)
    .map((line) => line.map(quote).join(','))
    // CRLF, which is what the CSV specification says and what Excel expects.
    .join('\r\n');
}

/**
 * A file name for the export.
 *
 * From the page's title, because that is what somebody will look for in their
 * downloads. Reduced to what a file system takes everywhere rather than what any
 * one of them takes.
 */
export function exportFilename(title: string): string {
  const base = title.trim().replace(/[^\w\-. ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base === '' ? 'table' : base.slice(0, 60)}.csv`;
}
