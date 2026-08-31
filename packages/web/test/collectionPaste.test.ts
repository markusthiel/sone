/**
 * Pasting a grid into a collection (ADR-0034).
 *
 * The parsing is where this can go quietly wrong, so most of these are about
 * text: a trailing newline that would otherwise create an empty page, a quoted
 * cell containing a tab, a comma decimal from a German spreadsheet.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { valueFromText } from '../src/components/CollectionTable.tsx';
import { MAX_PASTE_ROWS, looksLikeGrid, parsePastedGrid } from '../src/components/pastedGrid.ts';
import type { CollectionField } from '../src/api/client.ts';
import { codeOf, stylesOf } from './helpers/source.ts';

const field = (
  fieldType: string,
  config: Record<string, unknown> = {},
): CollectionField =>
  ({ id: 'f1', name: 'F', fieldType, config }) as unknown as CollectionField;

test('a three-column selection becomes three columns', () => {
  const grid = parsePastedGrid('Barthel\tRenate\t4516-0007\nEck\tUte\t4084-0580');
  assert.deepEqual(grid.rows, [
    ['Barthel', 'Renate', '4516-0007'],
    ['Eck', 'Ute', '4084-0580'],
  ]);
  assert.equal(grid.ignored, 0);
});

test('a trailing newline does not create an empty entry', () => {
  // A spreadsheet ends its copy with one, and an empty row here is a page.
  assert.deepEqual(parsePastedGrid('a\tb\n').rows, [['a', 'b']]);
  assert.deepEqual(parsePastedGrid('a\r\nb\r\n').rows, [['a'], ['b']]);
});

test('blank lines inside a selection are dropped', () => {
  assert.deepEqual(parsePastedGrid('a\n\n\t\nb').rows, [['a'], ['b']]);
});

test('a quoted cell may contain a tab, a newline and a quote', () => {
  // Without this the grid shears apart at exactly the cell somebody quoted
  // because it needed quoting.
  const grid = parsePastedGrid('"a\tb"\t"line\nbreak"\t"say ""hi"""');
  assert.deepEqual(grid.rows, [['a\tb', 'line\nbreak', 'say "hi"']]);
});

test('carriage returns are line breaks, with or without a newline', () => {
  assert.deepEqual(parsePastedGrid('a\r\nb').rows, [['a'], ['b']]);
  assert.deepEqual(parsePastedGrid('a\rb').rows, [['a'], ['b']]);
});

test('the cap is fifty, and it says what it left', () => {
  // Craft's number. The rest stays on the clipboard, and pasting again appends —
  // which is what makes this a limit on one operation rather than on the table.
  const many = Array.from({ length: 63 }, (_, at) => `row ${at}`).join('\n');
  const grid = parsePastedGrid(many);
  assert.equal(grid.rows.length, MAX_PASTE_ROWS);
  assert.equal(grid.ignored, 13);
  assert.equal(grid.rows[0]?.[0], 'row 0', 'the first fifty, in order');
  assert.equal(grid.rows[49]?.[0], 'row 49');
});

test('a single value is left to the browser', () => {
  // It goes into the field somebody is typing in, which is what they meant.
  assert.equal(looksLikeGrid('Barthel'), false);
  assert.equal(looksLikeGrid('  spaced words  '), false);
  assert.equal(looksLikeGrid('a\tb'), true);
  assert.equal(looksLikeGrid('a\nb'), true);
});

// --- what a pasted string becomes -------------------------------------------

test('a number accepts a comma decimal', () => {
  // What a German spreadsheet writes, and a paste is the one place this
  // application meets one.
  assert.deepEqual(valueFromText(field('number'), '12,5'), { kind: 'number', value: 12.5 });
  assert.deepEqual(valueFromText(field('number'), '1 200'), { kind: 'number', value: 1200 });
  assert.equal(valueFromText(field('number'), 'about ten'), null);
});

test('a PIN in a text column keeps its leading zero', () => {
  // The reason a paste does not create columns and guess their types: as a
  // number this loses the zero, silently and irreversibly.
  assert.deepEqual(valueFromText(field('text'), '0415-0007'), {
    kind: 'text',
    value: '0415-0007',
  });
});

test('a date is taken only in ISO form', () => {
  // Guessing between 03/04 as March and April is a coin toss with somebody's
  // data, and a wrong date looks right.
  assert.deepEqual(valueFromText(field('date'), '2026-03-04'), {
    kind: 'date',
    start: '2026-03-04',
    end: null,
  });
  assert.equal(valueFromText(field('date'), '03/04/2026'), null);
});

test('a select is matched on the option name, and an unknown one is empty', () => {
  const options = { options: [{ id: 'o1', name: 'Open' }, { id: 'o2', name: 'Done' }] };
  assert.deepEqual(valueFromText(field('select', options), 'done'), {
    kind: 'select',
    optionId: 'o2',
  });
  // Not a new option: inferring structure from pasted data is the thing ADR-0034
  // refuses to do.
  assert.equal(valueFromText(field('select', options), 'Blocked'), null);
});

test('an empty cell is empty rather than a value', () => {
  for (const type of ['text', 'number', 'date', 'checkbox', 'select']) {
    assert.equal(valueFromText(field(type), '   '), null, type);
  }
});

// --- the table's own gestures ------------------------------------------------

const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('the name is edited in the cell and the page is one control away', () => {
  // It was a link, and clicking it left the table — which is exactly the gesture
  // somebody makes while filling the first column.
  assert.match(table, /<TitleCell/);
  assert.match(table, /className="collection-open-row"/);
  assert.doesNotMatch(
    table,
    /collection-title-column"[^>]*>\s*\{?\s*\/?\*?[^<]*<a\n?\s*href=\{paths\.page/,
    'the cell itself is no longer the link',
  );
  // And the control is de-emphasised rather than hidden, because hover does not
  // exist on a phone.
  assert.match(css, /\.collection-open-row \{[^}]*opacity: 0\.45/);
  assert.match(css, /@media \(hover: none\) \{\s*\.collection-open-row \{ opacity: 0\.7; \}/);
});

test('a paste is appended, never written over what is there', () => {
  // The one thing asked for that Craft does not do: a second fifty adds to the
  // first. Only an empty anchor row is filled, because an empty row has nothing
  // to lose and is the row somebody just made in order to paste into it.
  assert.match(table, /addCollectionRows\(collectionId, rows\)/);
  assert.match(table, /const anchorEmpty =/);
  const server = codeOf(new URL('../../server/src/http/collections.ts', import.meta.url));
  assert.match(server, /ORDER BY idx DESC, id DESC LIMIT 1/);
  assert.match(server, /export const MAX_BULK_ROWS = 50;/);
});

test('emptying the table archives rather than deletes', () => {
  // A row is a page, so this fills the trash — which is what makes it
  // reversible, and undo is the reason to have built the stack first.
  const server = codeOf(new URL('../../server/src/http/collections.ts', import.meta.url));
  assert.match(server, /UPDATE pages SET archived_at = now\(\)[\s\S]{0,140}RETURNING id/);
  assert.doesNotMatch(server, /DELETE FROM pages WHERE collection_id/);
  // And it asks in a sentence rather than a dialog dismissed by reflex.
  assert.match(table, /Move all \{data\?\.rows\.length \?\? 0\} entries to the trash\?/);
});

test('undo and redo are each other, not two implementations', () => {
  const history = codeOf(new URL('../src/hooks/useTableHistory.ts', import.meta.url));
  assert.match(history, /forward: \(\) => Promise<void>/);
  assert.match(history, /backward: \(\) => Promise<void>/);
  // The stack is read from a ref, because reading state inside the callback that
  // also updates it is how a correct undo occasionally does nothing.
  assert.match(history, /const stack = useRef<HistoryEntry\[\]>/);
  assert.match(history, /HISTORY_DEPTH/);
});

test('the column menu looks like every other menu, and names types by shape', () => {
  // It had its own frame and its own type scale, and once it moved out of the
  // table it inherited the page's font — so it read as belonging to a different
  // application. Its items are the shared item now, which also picks up the
  // touch rules that list is in.
  assert.match(table, /className="entry-menu-item"/);
  assert.match(table, /<entry\.Icon \/> \{entry\.label\}/);

  const menu = css.slice(css.indexOf('.collection-type-menu {'));
  const rule = menu.slice(0, menu.indexOf('}'));
  assert.match(rule, /inline-size: 190px/, 'the same width as the entry menu');
  assert.match(rule, /border-radius: var\(--sone-radius-lg\)/);
  assert.match(rule, /font-size: 0\.88rem/);
  // And no item rule of its own left behind to disagree with the shared one.
  assert.doesNotMatch(css, /\.collection-type-menu button \{/);

  // Every addable type has an icon, or the menu is a mix of shapes and gaps.
  const entries = [...table.matchAll(/\{ type: '[a-zA-Z]+', label: '[^']+', Icon: (\w+) \}/g)];
  assert.equal(entries.length, 10, 'every addable type, with an icon each');
  for (const [, icon] of entries) {
    assert.match(
      codeOf(new URL('../src/components/icons.tsx', import.meta.url)),
      new RegExp(`export function ${icon}\\(`),
      `${icon} is drawn in the set`,
    );
  }
});
