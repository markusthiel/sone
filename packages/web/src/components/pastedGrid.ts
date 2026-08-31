/**
 * SONE web — reading a pasted grid (ADR-0034).
 *
 * `text/plain`, split on newlines and tabs. That is what every spreadsheet and
 * every HTML table puts on the clipboard as its plain-text flavour, so the grid
 * is already there — and parsing `text/html` instead would mean maintaining a
 * parser for arbitrary markup arriving from the clipboard to learn the same
 * thing.
 *
 * Pure, and separate from the table, because the interesting cases are all about
 * text: a trailing newline, a quoted field containing a tab, one cell that
 * happens to contain a line break.
 */

/** Most rows one paste may create. Craft's number, and ADR-0034 says why. */
export const MAX_PASTE_ROWS = 50;

export interface PastedGrid {
  /** Rows of cells, outer array in reading order. */
  rows: string[][];
  /** How many rows were left on the clipboard because of the cap. */
  ignored: number;
}

/**
 * Split a clipboard string into a grid.
 *
 * Quoted fields are honoured, because a spreadsheet quotes any cell containing a
 * tab or a newline and the whole grid would otherwise shear apart at that cell.
 * Two quotes inside a quoted field are one quote, which is the same convention.
 *
 * `\r\n` and `\r` are both line breaks: the first is what Windows and Excel
 * write, and the second is what some older Mac exports still do.
 */
export function parsePastedGrid(text: string): PastedGrid {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const endCell = (): void => {
    row.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === '\t') {
      endCell();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      // Swallowed with the newline that follows it, or left as a line break of
      // its own where it stands alone.
      if (text[at + 1] === '\n') continue;
      endRow();
    } else {
      cell += char;
    }
  }

  // Whatever is left. A grid that ends without a newline has a last row, and one
  // that ends with a newline does not — a trailing blank row would otherwise
  // create an empty entry on every paste out of a spreadsheet.
  if (cell !== '' || row.length > 0) endRow();

  // Rows that are entirely empty are dropped, wherever they are: a selection in
  // a spreadsheet often includes a blank line, and an empty row here is a page.
  const filled = rows.filter((cells) => cells.some((value) => value.trim() !== ''));

  return {
    rows: filled.slice(0, MAX_PASTE_ROWS),
    ignored: Math.max(0, filled.length - MAX_PASTE_ROWS),
  };
}

/**
 * Is this a paste the table should take over?
 *
 * A single cell of text is left to the browser: it goes into the field somebody
 * is typing in, which is what they meant. Anything with a tab or a line break is
 * a grid, and grids become entries.
 */
export function looksLikeGrid(text: string): boolean {
  return /[\t\r\n]/.test(text.trim()) || text.includes('\t');
}
