/**
 * The gallery view (ADR-0039).
 *
 * The decision it records is what the picture on a card *is*, so that is what
 * these check: the cover comes from a files column and from nowhere else, and a
 * row without one is drawn as a panel rather than as something invented.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const gallery = codeOf(new URL('../src/components/CollectionGallery.tsx', import.meta.url));
const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('the cover is the first image in a files column, decided by category', () => {
  // Not a new attribute on a row: ADR-0035 gave the table columns that hold
  // files, and a second place to put a picture has no good answer to "why does
  // mine not show".
  assert.match(gallery, /field\.fieldType === 'files'/);
  // Category rather than the filename, because the server decides what a file is
  // from its bytes — a `.png` that is not a picture must not be drawn as one.
  assert.match(gallery, /files\.get\(id\)\?\.category === 'image'/);
  assert.doesNotMatch(gallery, /\.endsWith\('\.png'\)|filename\.match/);
});

test('a named cover column wins, and otherwise the first is used', () => {
  assert.match(gallery, /export function coverField/);
  assert.match(gallery, /named \?\? fields\.find/);
});

test('a row with no image gets a panel, not a placeholder', () => {
  assert.match(gallery, /gallery-cover-empty/);
  assert.match(css, /\.gallery-cover \{[^}]*aspect-ratio: 4 \/ 3/);
  assert.match(css, /\.gallery-cover \{[^}]*object-fit: cover/);
});

test('a gallery is a view, so the filters and the search apply to it', () => {
  // Which is the argument for it being a view type rather than a display mode of
  // the table: nothing had to be reimplemented for it.
  assert.match(table, /view\?\.viewType === 'gallery' && \(/);
  assert.match(table, /rows=\{data\.rows\}/);
});

test('the offer to add one appears only when there is something to draw', () => {
  // A gallery of blank panels is not a view. Same rule as the board's offer,
  // which appears when a select column exists.
  assert.match(
    table,
    /columns\.some\(\(field\) => field\.fieldType === 'files'\) && \(/,
  );
  assert.match(table, /!data\.views\.some\(\(entry\) => entry\.viewType === 'gallery'\)/);
});

test('a card opens the row, because a row is a page', () => {
  assert.match(gallery, /paths\.page\(row\.id, row\.title\)/);
});
