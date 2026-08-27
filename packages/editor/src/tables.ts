/**
 * SONE — tables.
 *
 * Commands and plugins over prosemirror-tables. That package does the hard
 * parts — rectangular cell selection, merging and splitting, column resizing,
 * repairing a malformed table — and this file adds what SONE needs on top:
 * creating a table with block ids, and a set of commands the interface can call
 * without knowing the package's vocabulary.
 *
 * One thing worth knowing about tables in a CRDT document: two people editing
 * the same table converge, but a row inserted concurrently with a column can
 * leave a table whose rows have different cell counts. `fixTables` repairs that,
 * and the plugin runs it — so the state after a merge is always a valid table
 * rather than something the renderer has to be defensive about.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  fixTables,
  goToNextCell,
  isInTable,
  mergeCells,
  splitCell,
  tableEditing,
  toggleHeaderColumn,
  toggleHeaderRow,
} from 'prosemirror-tables';
import { Plugin } from 'prosemirror-state';

import { schema } from './schema.js';

export interface CreateTableOptions {
  rows?: number;
  columns?: number;
  /** A header row is the common case and worth defaulting to. */
  headerRow?: boolean;
  /** Injected in tests so ids are deterministic. */
  generateId?: () => string;
}

const defaultId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(16)}`;
};

/**
 * Build a table node.
 *
 * Every node gets an id here rather than relying on the blockIds plugin. The
 * plugin would assign them on the next transaction, and until then the table
 * would be invisible to the tree reader — which matters because the table may
 * be materialised before anyone types again.
 */
export function buildTable(options: CreateTableOptions = {}): PMNode | null {
  const rows = Math.max(1, Math.min(options.rows ?? 3, 50));
  const columns = Math.max(1, Math.min(options.columns ?? 3, 20));
  const headerRow = options.headerRow ?? true;
  const generateId = options.generateId ?? defaultId;

  const tableType = schema.nodes['table'];
  const rowType = schema.nodes['table_row'];
  const cellType = schema.nodes['table_cell'];
  const headerType = schema.nodes['table_header'];
  const paragraph = schema.nodes['paragraph'];
  if (!tableType || !rowType || !cellType || !headerType || !paragraph) return null;

  const blockAttrs = (): Record<string, unknown> => ({
    [BLOCK_ATTRS.id]: generateId(),
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: null,
  });

  const makeCell = (header: boolean): PMNode => {
    const type = header ? headerType : cellType;
    return type.create(
      { ...blockAttrs(), colspan: 1, rowspan: 1, colwidth: null },
      // Every cell holds a paragraph: a cell with no block content cannot be
      // typed into, and an empty table nobody can type into is worse than none.
      paragraph.create(blockAttrs()),
    );
  };

  const rowNodes: PMNode[] = [];
  for (let r = 0; r < rows; r++) {
    const isHeader = headerRow && r === 0;
    const cells: PMNode[] = [];
    for (let c = 0; c < columns; c++) cells.push(makeCell(isHeader));
    rowNodes.push(rowType.create(blockAttrs(), Fragment.fromArray(cells)));
  }

  return tableType.create(blockAttrs(), Fragment.fromArray(rowNodes));
}

/** Insert a table at the selection. */
export function insertTable(options: CreateTableOptions = {}): Command {
  return (state, dispatch) => {
    const table = buildTable(options);
    if (!table) return false;

    // Refused inside a table: nesting one is possible in the schema and almost
    // never intended, and unpicking it by hand is unpleasant.
    if (isInTable(state)) return false;

    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(table);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * The commands a table menu offers, with labels.
 *
 * Exported as data so the interface renders the list rather than restating it —
 * a menu that drifts from the commands behind it offers things that do nothing.
 */
export interface TableAction {
  id: string;
  label: string;
  command: Command;
  destructive?: boolean;
}

export const TABLE_ACTIONS: readonly TableAction[] = [
  { id: 'row-before', label: 'Insert row above', command: addRowBefore },
  { id: 'row-after', label: 'Insert row below', command: addRowAfter },
  { id: 'column-before', label: 'Insert column left', command: addColumnBefore },
  { id: 'column-after', label: 'Insert column right', command: addColumnAfter },
  { id: 'toggle-header-row', label: 'Toggle header row', command: toggleHeaderRow },
  { id: 'toggle-header-column', label: 'Toggle header column', command: toggleHeaderColumn },
  { id: 'merge', label: 'Merge cells', command: mergeCells },
  { id: 'split', label: 'Split cell', command: splitCell },
  { id: 'delete-row', label: 'Delete row', command: deleteRow, destructive: true },
  { id: 'delete-column', label: 'Delete column', command: deleteColumn, destructive: true },
  { id: 'delete-table', label: 'Delete table', command: deleteTable, destructive: true },
];

/**
 * Repair tables after a change from anywhere.
 *
 * A CRDT merge can produce a table whose rows have different cell counts — one
 * client added a row while another added a column, and both updates are valid
 * on their own. `fixTables` normalises it, and doing so here means the rest of
 * the code never has to be defensive about a ragged table.
 *
 * Not added to history: repairing a merge is not an edit anybody made, and
 * undoing it would produce the broken state again.
 */
function tableRepair(): Plugin {
  return new Plugin({
    appendTransaction: (_transactions, oldState, newState) => {
      const fixed = fixTables(newState, oldState);
      if (!fixed) return null;
      return fixed.setMeta('addToHistory', false);
    },
  });
}

export function tablePlugins(): Plugin[] {
  return [
    // Resizing before editing, as prosemirror-tables requires: the resize
    // plugin has to see a mousedown on a column edge before the editing plugin
    // treats it as a cell selection.
    columnResizing({}),
    tableEditing({ allowTableNodeSelection: true }),
    tableRepair(),
  ];
}

/** Tab moves between cells inside a table, and does nothing outside one. */
export const tableKeymap: Record<string, Command> = {
  // Registered ahead of the block indent binding, so Tab in a table moves to
  // the next cell rather than indenting the paragraph inside it.
  Tab: goToNextCell(1),
  'Shift-Tab': goToNextCell(-1),
};

export { isInTable };
