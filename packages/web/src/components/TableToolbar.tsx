/**
 * SONE web — table controls.
 *
 * A table had no visible controls at all. The actions existed, in the block
 * menu behind the ⋮⋮ handle, which is where nobody looks — so what appeared on
 * the page was a container with no indication of what could be done to it.
 *
 * This shows the common actions while the caret is in a table, and nothing
 * otherwise. It is deliberately small: add and remove a row or a column, and
 * the header toggle. Everything else — merging, splitting, deleting the table —
 * stays in the block menu, because a toolbar with eleven buttons is its own
 * kind of unusable.
 *
 * The positioning and touch handling are the ones already worked out for the
 * other overlays: measured from the DOM, re-placed when the page moves, retried
 * when a measurement fails, and activated on click rather than pointerdown so a
 * finger can scroll.
 */

import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  isInTable,
  toggleHeaderRow,
} from '@sone/editor';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { MessageKey } from '../i18n/messages.en.ts';
import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { useViewportChanges } from '../hooks/useViewportChanges.ts';
import { keepsEditorSelection, popupItem } from './popup.ts';

interface TableToolbarProps {
  view: EditorView;
  /** Bumped by the editor on every transaction. */
  revision: number;
}

/**
 * What the toolbar offers.
 *
 * Labels rather than icons: there is no conventional glyph for "insert a column
 * to the right", and an unlabelled icon that has to be hovered to be understood
 * is no better than the menu this replaces.
 */
const ACTIONS: ReadonlyArray<{
  id: string;
  /** Message keys: the toolbar translates them where it draws them (ADR-0041). */
  label: MessageKey;
  title: MessageKey;
  command: Command;
  destructive?: boolean;
}> = [
  { id: 'row', label: 'tableBlock.addRow', title: 'tableBlock.addRow.title', command: addRowAfter },
  {
    id: 'col',
    label: 'tableBlock.addColumn',
    title: 'tableBlock.addColumn.title',
    command: addColumnAfter,
  },
  {
    id: 'header',
    label: 'tableBlock.header',
    title: 'tableBlock.header.title',
    command: toggleHeaderRow,
  },
  {
    id: 'del-row',
    label: 'tableBlock.removeRow',
    title: 'tableBlock.removeRow.title',
    command: deleteRow,
    destructive: true,
  },
  {
    id: 'del-col',
    label: 'tableBlock.removeColumn',
    title: 'tableBlock.removeColumn.title',
    command: deleteColumn,
    destructive: true,
  },
];

export function TableToolbar({ view, revision }: TableToolbarProps): ReactElement | null {
  const { t } = useT();
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const inTable = isInTable(view.state);
  // The editor's element too — see the note in useViewportChanges (ADR-0083).
  const viewportToken = useViewportChanges(inTable, view.dom as HTMLElement);

  useEffect(() => {
    if (!inTable) {
      setBox(null);
      return undefined;
    }

    // Anchored to the table's own wrapper rather than to the caret: a toolbar
    // that follows the cursor from cell to cell is a distraction, and the
    // actions apply to the table rather than to the character.
    const found = view.domAtPos(view.state.selection.from);
    const element =
      found.node.nodeType === 1
        ? (found.node as HTMLElement)
        : (found.node.parentElement as HTMLElement | null);
    const wrapper = element?.closest('.tableWrapper');
    if (!wrapper) return undefined;

    try {
      const rect = wrapper.getBoundingClientRect();
      setBox({ top: rect.top - 38, left: rect.left });
    } catch {
      const retry = requestAnimationFrame(() => setRetryToken((n) => n + 1));
      return () => cancelAnimationFrame(retry);
    }
    return undefined;
  }, [view, revision, inTable, retryToken, viewportToken]);

  if (!inTable || !box) return null;

  const run = (command: Command): void => {
    command(view.state, view.dispatch);
    view.focus();
  };

  return (
    <div
      className="table-toolbar"
      style={{ top: box.top, left: box.left }}
      role="toolbar"
      aria-label={t('tableBlock.label')}
      {...keepsEditorSelection}
    >
      {ACTIONS.map((action) => {
        // Disabled rather than hidden, so the row of controls does not change
        // shape as the caret moves between cells.
        const possible = action.command(view.state, undefined);
        return (
          <button
            key={action.id}
            type="button"
            title={t(action.title)}
            disabled={!possible}
            className={
              action.destructive ? 'table-toolbar-button destructive' : 'table-toolbar-button'
            }
            {...popupItem(() => run(action.command))}
          >
            {t(action.label)}
          </button>
        );
      })}
    </div>
  );
}
