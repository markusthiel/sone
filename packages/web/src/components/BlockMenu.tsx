/**
 * SONE web — the block menu.
 *
 * A button per block that opens move, duplicate, delete and turn-into.
 *
 * Deliberately a menu rather than a drag handle. Dragging is the obvious design
 * and the wrong first one: on a touch screen it competes with scrolling, it
 * needs a drop indicator to be comprehensible, and a drag that moves a block
 * without its indented children silently reparents them (ADR-0018). The menu
 * uses the same subtree-aware operations, works with a thumb and a keyboard,
 * and can be reasoned about. Dragging can come later on top of it.
 *
 * The button is always rendered, never revealed on hover, because a control
 * that appears on :hover does not exist on a phone (ADR-0016).
 */

import {
  BLOCK_TYPE_ORDER,
  TABLE_ACTIONS,
  isInTable,
  deleteBlockSubtree,
  duplicateBlockSubtree,
  indentBlockSubtree,
  moveBlockDown,
  moveBlockUp,
  outdentBlockSubtree,
  schema,
  selectedBlockRange,
  toggleBlockType,
} from '@sone/editor';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState, type ReactElement } from 'react';

interface BlockMenuProps {
  view: EditorView;
  /** Bumped on every transaction, so the button follows the caret. */
  revision: number;
}

interface Action {
  id: string;
  label: string;
  hint?: string;
  command: Command;
  destructive?: boolean;
}

export function BlockMenu({ view, revision }: BlockMenuProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const range = selectedBlockRange(view.state);
  const from = range?.from ?? null;
  const size = range ? range.endIndex - range.index : 0;

  // Positioned from the block's own DOM node rather than from the caret, so the
  // button sits beside the block and not beside the cursor within it.
  useEffect(() => {
    if (from === null) {
      setAnchor(null);
      return;
    }
    try {
      const at = view.domAtPos(from + 1);
      const element =
        at.node.nodeType === 1
          ? (at.node as HTMLElement)
          : (at.node.parentElement as HTMLElement | null);
      const blockElement = element?.closest('[data-block]') ?? element;
      if (!blockElement) return;

      const box = blockElement.getBoundingClientRect();
      const editorBox = view.dom.getBoundingClientRect();
      setAnchor({
        top: box.top,
        // Left of the text column, in the gutter the editor's padding reserves.
        left: editorBox.left - 4,
      });
    } catch {
      // A stale position for one frame after a document change. Skipping beats
      // throwing inside an effect.
    }
  }, [view, from, revision]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close when the caret moves to a different block: a menu labelled for one
  // block while another is selected would act on the wrong one.
  useEffect(() => {
    setOpen(false);
  }, [from]);

  if (!range || !anchor) return null;

  const run = (command: Command): void => {
    command(view.state, view.dispatch);
    view.focus();
    setOpen(false);
  };

  const actions: Action[] = [
    {
      id: 'move-up',
      label: 'Move up',
      command: moveBlockUp,
    },
    {
      id: 'move-down',
      label: 'Move down',
      command: moveBlockDown,
    },
    {
      id: 'outdent',
      label: 'Outdent',
      command: outdentBlockSubtree,
    },
    {
      id: 'indent',
      label: 'Indent',
      command: indentBlockSubtree,
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      command: duplicateBlockSubtree,
    },
    {
      id: 'delete',
      label: 'Delete',
      command: deleteBlockSubtree,
      destructive: true,
    },
  ];

  return (
    <>
      <button
        type="button"
        className="block-handle"
        style={{ top: anchor.top, left: anchor.left }}
        aria-label={
          size > 1 ? `Block actions (${size} blocks including children)` : 'Block actions'
        }
        aria-expanded={open}
        onPointerDown={(event) => {
          // The editor loses focus on mousedown, so a click handler would act
          // on a lost selection.
          event.preventDefault();
          setOpen((previous) => !previous);
        }}
      >
        ⋮⋮
      </button>

      {open && (
        <div
          className="block-menu"
          ref={panelRef}
          style={{ top: anchor.top, left: anchor.left + 28 }}
          role="menu"
        >
          {size > 1 && (
            // Stated plainly, because acting on children the person did not
            // see selected is exactly the surprise worth avoiding.
            <p className="block-menu-note">
              Applies to this block and {size - 1} nested{' '}
              {size - 1 === 1 ? 'block' : 'blocks'}
            </p>
          )}

          {actions.map((action) => {
            // Disabled when the command refuses, so the menu never offers
            // something that silently does nothing.
            const possible = action.command(view.state, undefined);
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={action.destructive ? 'block-menu-item destructive' : 'block-menu-item'}
                disabled={!possible}
                onPointerDown={(event) => {
                  event.preventDefault();
                  run(action.command);
                }}
              >
                {action.label}
              </button>
            );
          })}

          {/* Table actions, only inside a table. prosemirror-tables' commands
              refuse elsewhere, and a menu section full of disabled items is
              noise rather than information. */}
          {isInTable(view.state) && (
            <div className="block-menu-group">
              <p className="block-menu-label">Table</p>
              {TABLE_ACTIONS.map((action) => {
                const possible = action.command(view.state, undefined);
                return (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    className={
                      action.destructive
                        ? 'block-menu-item destructive'
                        : 'block-menu-item'
                    }
                    disabled={!possible}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      run(action.command);
                    }}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="block-menu-group">
            <p className="block-menu-label">Turn into</p>
            {BLOCK_TYPE_ORDER.map((name) => {
              const type = schema.nodes[name];
              if (!type) return null;
              const active = range.node.type.name === name;
              return (
                <button
                  key={name}
                  type="button"
                  role="menuitem"
                  className="block-menu-item"
                  aria-current={active}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    // Restore the caret into the block first: the type change
                    // acts on the selection, and a click may have moved it.
                    const $pos = view.state.doc.resolve(range.from + 1);
                    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
                    run(toggleBlockType(type));
                  }}
                >
                  {LABELS[name] ?? name}
                  {active ? ' ·' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

const LABELS: Record<string, string> = {
  paragraph: 'Text',
  heading: 'Heading',
  bulletList: 'Bulleted list',
  numberedList: 'Numbered list',
  todo: 'To-do',
  toggle: 'Toggle',
  quote: 'Quote',
  callout: 'Callout',
  code: 'Code',
  divider: 'Divider',
};
