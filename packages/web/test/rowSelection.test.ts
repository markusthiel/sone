/**
 * Selected rows, and what the three actions mean (ADR-0040).
 *
 * The copy format is the paste format, so these test each against the other
 * rather than against a fixture: the round trip is the property that matters.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellText, exportFilename, rowsAsCsv, rowsAsTabbed } from '../src/components/rowsAsText.ts';
import { parsePastedGrid } from '../src/components/pastedGrid.ts';
import { codeOf, stylesOf } from './helpers/source.ts';

const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

const fields = [
  { id: 'f1', name: 'Nachname', fieldType: 'text', config: {} },
  { id: 'f2', name: 'PIN', fieldType: 'number', config: {} },
  { id: 'f3', name: 'Da', fieldType: 'checkbox', config: {} },
] as never as Parameters<typeof rowsAsTabbed>[1];

const rows = [
  {
    id: 'r1',
    title: 'Name 1',
    values: {
      f1: { kind: 'text', value: 'Thiel' },
      f2: { kind: 'number', value: 5139 },
      f3: { kind: 'checkbox', value: true },
    },
  },
  { id: 'r2', title: 'Name 2', values: { f1: { kind: 'text', value: 'Barthel' } } },
] as never as Parameters<typeof rowsAsTabbed>[0];

const files = new Map();

test('what is copied is what a paste reads', () => {
  // ADR-0034 made a table fillable by pasting a grid; the clipboard format is
  // that grid. So copy and paste round-trip, and duplicating rows needs no
  // second action.
  const text = rowsAsTabbed(rows, fields, files);
  const parsed = parsePastedGrid(text);
  assert.equal(parsed.rows.length, 3, 'the header and two entries');
  assert.deepEqual(parsed.rows[0], ['Name', 'Nachname', 'PIN', 'Da']);
  assert.deepEqual(parsed.rows[1], ['Name 1', 'Thiel', '5139', 'yes']);
  // An unset cell is empty rather than absent, or the columns would shift.
  assert.deepEqual(parsed.rows[2], ['Name 2', 'Barthel', '', '']);
});

test('a tab or a newline inside a value does not become a new cell', () => {
  // The clipboard format has no way to escape them, and splitting somebody's
  // sentence across two cells is worse than losing a line break.
  const messy = [
    { id: 'r1', title: 'One', values: { f1: { kind: 'text', value: 'a\tb\nc' } } },
  ] as never as Parameters<typeof rowsAsTabbed>[0];
  const parsed = parsePastedGrid(rowsAsTabbed(messy, fields, files));
  assert.deepEqual(parsed.rows[1], ['One', 'a b c', '', '']);
});

test('CSV quotes only what needs it, and doubles a quote', () => {
  // A CSV that breaks on a comma is worse than no export; one that quotes every
  // cell is unreadable.
  const awkward = [
    {
      id: 'r1',
      title: 'Thiel, Markus',
      values: { f1: { kind: 'text', value: 'He said "no"' } },
    },
  ] as never as Parameters<typeof rowsAsCsv>[0];
  const csv = rowsAsCsv(awkward, fields, files);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Name,Nachname,PIN,Da');
  assert.equal(lines[1], '"Thiel, Markus","He said ""no""",,');
});

test('CSV ends its lines the way a spreadsheet expects', () => {
  assert.ok(rowsAsCsv(rows, fields, files).includes('\r\n'));
});

test('a checkbox exports as a word, not as TRUE', () => {
  // A spreadsheet reads TRUE as its own boolean in one locale and as a string in
  // another; "yes" is a word in both.
  const field = { id: 'f3', name: 'Da', fieldType: 'checkbox', config: {} } as never;
  assert.equal(cellText(rows[0]!, field, files), 'yes');
  // And a checkbox nobody has touched is empty rather than "no": the row has no
  // value there, and writing one would be this export inventing a fact.
  assert.equal(cellText(rows[1]!, field, files), '');
});

test('the file is named after the view, safely', () => {
  assert.equal(exportFilename('Table'), 'Table.csv');
  assert.equal(exportFilename('Meine / Tabelle: 2026'), 'Meine Tabelle 2026.csv');
  assert.equal(exportFilename('   '), 'table.csv');
});

test('deleting a selection is archiving, and says so', () => {
  // A row is a page, so removing one is what removing a page is — and somebody
  // who reads "delete" and means it will look for the recovery the word denies.
  assert.match(table, /archiveCollectionRows\(collectionId, ids\)/);
  assert.match(table, /moved to the trash, where they can be brought back/);
  assert.match(table, /To the trash/);
  assert.doesNotMatch(table, /Delete permanently|hard delete/);
});

test('the export is the rows the view is showing', () => {
  // A view exists to narrow a table, and an export that widened it again would be
  // the one place that ignored the filter.
  assert.match(table, /const chosen = data\.rows\.filter\(\(row\) => selected\.has\(row\.id\)\)/);
  assert.match(table, /rowsAsCsv\(chosen, columns, fileIndex/);
  assert.doesNotMatch(table, /api\.exportCollection/);
});

test('the selection is always reachable, and a reader has it too', () => {
  // Hover does not exist on a touch device, and reading a table is exactly when
  // somebody wants a copy of it.
  assert.match(table, /collection-select-column/);
  assert.doesNotMatch(css, /\.collection-select-column[^}]*display: none/);
  // Only the destructive action asks whether they may edit.
  assert.match(table, /\{data\.canEdit && \(\s*<button[\s\S]{0,200}To the trash/);
});

test('a selected row is tinted rather than outlined', () => {
  // An outline on a table row lands on the cell borders and reads as a rendering
  // fault.
  assert.match(css, /tr\[data-selected='true'\] > td[^}]*background/);
});
