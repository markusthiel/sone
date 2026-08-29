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
  openSlashMenu,
  deleteBlockSubtree,
  duplicateBlockSubtree,
  indentBlockSubtree,
  moveBlockDown,
  moveBlockUp,
  outdentBlockSubtree,
  schema,
  selectedBlockRange,
  toggleBlockType,
  currentBlockStyle,
  setBlockStyle,
  setFileDisplay,
} from '@sone/editor';
import { BLOCK_COLORS } from '@sone/core';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useViewportChanges } from '../hooks/useViewportChanges.ts';

import { GripIcon, PlusIcon } from './icons.tsx';
import { keepsEditorSelection, popupItem } from './popup.ts';

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

/** Clearance between the gutter controls and the text they sit beside. */
const GUTTER_GAP = 6;

/**
 * The gutter's width, matching `.block-gutter` in the stylesheet.
 *
 * Fixed there rather than left to the content, so the first placement is
 * correct instead of being measured a frame later and moving.
 */
const GUTTER_WIDTH = 54;

/**
 * Which presentation settings apply to a block type.
 *
 * Width is for things that can usefully be wider than the reading column — an
 * image, a table, a collection. A wide paragraph is just a harder-to-read
 * paragraph, which is why the column exists.
 *
 * Colour is for things made of text. An image has no colour to set, and
 * offering one would be a control that does nothing.
 */
const APPEARANCE: Record<string, { width: boolean; color: boolean; align: boolean }> = {
  paragraph: { width: false, color: true, align: true },
  heading: { width: false, color: true, align: true },
  quote: { width: false, color: true, align: true },
  callout: { width: true, color: true, align: false },
  code: { width: true, color: false, align: false },
  bulletItem: { width: false, color: true, align: false },
  numberedItem: { width: false, color: true, align: false },
  todoItem: { width: false, color: true, align: false },
  toggleItem: { width: false, color: true, align: false },
  image: { width: true, color: false, align: true },
  table: { width: true, color: false, align: false },
  collectionView: { width: true, color: false, align: false },
  divider: { width: true, color: true, align: false },
};

/** The appearance controls for one block. */
function BlockAppearance({
  view,
  node,
  run,
}: {
  view: EditorView;
  node: PMNodeLike;
  run: (command: Command) => void;
}): ReactElement | null {
  const applies = APPEARANCE[node.type.name] ?? {
    // A block type nobody listed still gets alignment, which is meaningful for
    // anything: better a small default than a section that vanishes when
    // somebody adds a block type and forgets this table.
    width: false,
    color: true,
    align: true,
  };

  const current = currentBlockStyle(view.state);

  return (
    <div className="block-menu-group">
      <p className="block-menu-label">Appearance</p>

      {applies.align && (
        <div className="block-menu-choices" role="group" aria-label="Alignment">
          {[
            { id: null, label: 'Auto' },
            { id: 'start' as const, label: 'Left' },
            { id: 'center' as const, label: 'Centre' },
            { id: 'end' as const, label: 'Right' },
          ].map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="menuitemradio"
              aria-checked={current.align === choice.id}
              className={
                current.align === choice.id ? 'block-menu-choice current' : 'block-menu-choice'
              }
              {...popupItem(() => run(setBlockStyle({ align: choice.id })))}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {applies.width && (
        <div className="block-menu-choices" role="group" aria-label="Width">
          {[
            { id: null, label: 'Column' },
            // "Wide" is a step between the reading column and the page, and for
            // an image it is a distinction without a difference: all three read
            // as "the width of the text, or a bit more". An image is either in
            // the column with the writing or across the page.
            ...(node.type.name === 'image'
              ? []
              : [{ id: 'wide' as const, label: 'Wide' }]),
            { id: 'full' as const, label: 'Full page' },
          ].map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="menuitemradio"
              aria-checked={current.width === choice.id}
              className={
                current.width === choice.id ? 'block-menu-choice current' : 'block-menu-choice'
              }
              {...popupItem(() => run(setBlockStyle({ width: choice.id })))}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {applies.color && (
        <div className="block-menu-swatches" role="group" aria-label="Colour">
          {/* Null first, and shown as a slash rather than a colour: "no colour
              chosen" is a state, not a shade, and drawing it as one would make
              the default look like a decision. */}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={current.color === null}
            aria-label="Default colour"
            className={
              current.color === null ? 'block-menu-swatch none current' : 'block-menu-swatch none'
            }
            {...popupItem(() => run(setBlockStyle({ color: null })))}
          />
          {BLOCK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="menuitemradio"
              aria-checked={current.color === color}
              aria-label={color}
              title={color}
              className={
                current.color === color
                  ? `block-menu-swatch tag-${color} current`
                  : `block-menu-swatch tag-${color}`
              }
              {...popupItem(() => run(setBlockStyle({ color })))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What a file block can do, in the gutter menu.
 *
 * The same two questions the `···` menu asked — what to do with it, and how to
 * show it — and offering a viewer only where a browser can draw one, because a
 * viewer on a spreadsheet is a promise nothing here can keep.
 */
function FileActions({
  node,
  at,
  run,
}: {
  view: EditorView;
  node: PMNodeLike;
  at: number;
  run: (command: Command) => void;
}): ReactElement | null {
  const fileId = String(node.attrs['fileId'] ?? '');
  if (fileId === '') return null;

  const url = `/api/files/${fileId}`;
  const name = String(node.attrs['filename'] ?? 'file');
  const category = node.attrs['category'];
  const display = String(node.attrs['display'] ?? 'card');
  const viewable = category === 'pdf' || category === 'text' || category === 'image';

  const options: Array<{ id: string; label: string }> = [
    { id: 'card', label: 'Card' },
    { id: 'line', label: 'One line' },
  ];
  if (viewable) options.push({ id: 'full', label: 'Viewer' });

  return (
    <div className="block-menu-group">
      <p className="block-menu-label">File</p>

      {viewable && (
        <a
          className="block-menu-item"
          role="menuitem"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in a new tab
        </a>
      )}
      <a className="block-menu-item" role="menuitem" href={url} download={name}>
        Download
      </a>

      <div className="block-menu-choices" role="group" aria-label="Show as">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={display === option.id}
            className={
              display === option.id ? 'block-menu-choice current' : 'block-menu-choice'
            }
            {...popupItem(() => run(setFileDisplay(at, option.id as 'card' | 'line' | 'full')))}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The little of a ProseMirror node this needs; see CollectionNodeView. */
interface PMNodeLike {
  type: { name: string };
  attrs: Record<string, unknown>;
}

export function BlockMenu({ view, revision }: BlockMenuProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const range = selectedBlockRange(view.state);
  const from = range?.from ?? null;
  const size = range ? range.endIndex - range.index : 0;

  // Re-place when the page moves: a scroll produces no transaction, so nothing
  // else would tell this component that the text is no longer where it was.
  const viewportToken = useViewportChanges(from !== null);

  // Positioned from the block's own DOM node rather than from the caret, so the
  // button sits beside the block and not beside the cursor within it.
  useEffect(() => {
    if (from === null) {
      setAnchor(null);
      return;
    }
    try {
      // The node's own element first.
      //
      // `domAtPos(from + 1)` looks *inside* the block, which works for a
      // paragraph and not for an atom: an image or a file has nothing inside to
      // find, so the lookup returned the editor's root and the gutter was
      // positioned against that — at the very top of the page, which is exactly
      // where it appeared.
      const own = view.nodeDOM(from);
      const direct = own instanceof HTMLElement ? own : null;

      const at = direct ? null : view.domAtPos(from + 1);
      const element =
        direct ??
        (at && at.node.nodeType === 1
          ? (at.node as HTMLElement)
          : ((at?.node.parentElement ?? null) as HTMLElement | null));
      const blockElement = element?.closest('[data-block]') ?? element;
      if (!blockElement) return;

      const box = blockElement.getBoundingClientRect();
      const editorBox = view.dom.getBoundingClientRect();

      // Placed so its *right* edge stops short of the text, rather than its
      // left edge starting at the editor's.
      //
      // The previous version put the left edge four pixels outside the editor
      // box and a comment claimed that was the gutter the padding reserves. The
      // padding is 24px and the two controls are about 50px wide, so half of
      // the gutter sat on top of the first line — which is exactly what it
      // looked like.
      //
      // Both numbers are measured rather than assumed: the padding is a custom
      // property that can change, and the width depends on how many controls
      // are rendered.
      const padding = Number.parseFloat(
        getComputedStyle(view.dom).paddingInlineStart || '0',
      );
      // Measured when the gutter exists, and otherwise the width the
      // stylesheet gives it. The fallback is only used on the very first
      // placement, and a test keeps the two in step.
      const gutterWidth = gutterRef.current?.offsetWidth || GUTTER_WIDTH;
      const textStart = editorBox.left + (Number.isFinite(padding) ? padding : 0);

      setAnchor({
        top: box.top,
        // Clamped to the viewport: on a narrow screen there may genuinely be no
        // room beside the text, and a control pushed off the left edge is worse
        // than one that overlaps slightly.
        left: Math.max(2, textStart - gutterWidth - GUTTER_GAP),
      });
    } catch {
      // A stale position for a frame after a document change. Retried on the
      // next frame rather than abandoned: `anchor` stays null on failure and the
      // component returns null while it is, so one failure removed the + and the
      // ⋮⋮ for good.
      const retry = requestAnimationFrame(() => setRetryToken((n) => n + 1));
      return () => cancelAnimationFrame(retry);
    }
    return undefined;
  }, [view, from, revision, retryToken, viewportToken]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node)) return;
      // The gutter too, not only the panel.
      //
      // The ⋮⋮ button lives outside the panel, so without this the sequence on
      // a tap is: this listener closes the menu, then the button's click
      // toggles it — from closed back to open. The button could never close
      // what it had opened.
      if (gutterRef.current?.contains(event.target as Node)) return;
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
      {/* Two controls in the gutter, as Craft has.
       *
       * The + is the point: requiring `/` means knowing the shortcut exists,
       * and someone who does not will conclude the editor cannot insert
       * anything. A visible control beats one that has to be explained.
       *
       * The ⋮⋮ opens the block menu. It previously rendered and did nothing
       * useful, which is worse than not being there — a control that looks
       * interactive and is not teaches people to distrust the whole surface. */}
      <div
        className="block-gutter"
        ref={gutterRef}
        style={{ top: anchor.top, left: anchor.left }}
      >
        <button
          type="button"
          className="block-insert"
          aria-label="Insert a block"
          // Click, not pointerdown: on touch, pointerdown fires as the finger
          // lands, so the menu opened before anyone lifted. The mousedown
          // handler beside it is what preserves the editor's selection.
          onMouseDown={(event) => event.preventDefault()}
          {...popupItem(() => {
            setOpen(false);
            openSlashMenu(view);
          })}
        >
          <PlusIcon />
        </button>

        <button
          type="button"
          className="block-handle"
          aria-label={
            size > 1
              ? `Block actions (${size} blocks including children)`
              : 'Block actions'
          }
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          {...popupItem(() => setOpen((previous) => !previous))}
        >
          <GripIcon />
        </button>
      </div>

      {open && (
        <div
          className="block-menu"
          ref={panelRef}
          // Offset past both gutter buttons, so the menu does not cover the
          // control that opened it.
          style={{ top: anchor.top, left: anchor.left + 56 }}
          role="menu"
          {...keepsEditorSelection}
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
                {...popupItem(() => run(action.command))}
              >
                {action.label}
              </button>
            );
          })}

          {/* Moving a block in and out.
            *
            * Only Tab did this, and a phone keyboard has no Tab key — so on a
            * touch device there was no way to indent anything at all. That is
            * what made a toggle unusable there: its content *is* the blocks
            * indented under it, so without indenting a toggle can have a title
            * and nothing inside it, which is exactly what was reported. */}
          <div className="block-menu-group">
            <p className="block-menu-label">Nesting</p>
            <div className="block-menu-choices" role="group" aria-label="Nesting">
              <button
                type="button"
                role="menuitem"
                className="block-menu-choice"
                {...popupItem(() => run(outdentBlockSubtree))}
              >
                ← Out
              </button>
              <button
                type="button"
                role="menuitem"
                className="block-menu-choice"
                {...popupItem(() => run(indentBlockSubtree))}
              >
                → In
              </button>
            </div>
          </div>

          {/* How this block looks.
            *
            * Only the settings that mean something for its type: width on a
            * paragraph does nothing anybody wants, and colour on an image is
            * not a thing. A section of controls that have no effect teaches
            * people the panel is decoration.
            */}
          {/* A file's own actions, where every other block's are.
            *
            * They lived in a `···` button on the block itself, which was a
            * second place to ask the same kind of question — and the gutter is
            * where somebody already looks. */}
          {range.node.type.name === 'file' && (
            <FileActions view={view} node={range.node} at={range.from} run={run} />
          )}

          <BlockAppearance view={view} node={range.node} run={run} />

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
                    {...popupItem(() => run(action.command))}
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
                  {...popupItem(() => {
                    // Restore the caret into the block first: the type change
                    // acts on the selection, and a tap may have moved it.
                    const $pos = view.state.doc.resolve(range.from + 1);
                    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
                    run(toggleBlockType(type));
                  })}
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
