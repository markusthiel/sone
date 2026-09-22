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
  blocksInSelection,
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
  isBlockLocked,
  readAssignee,
  setAssignee,
  setBlockLocked,
  setBlockStyle,
  setFileDisplay,
  setVideoDisplay,
  showImageAs,
} from '@sone/editor';
import { en, type MessageKey } from '../i18n/messages.en.ts';
import { BLOCK_MARKS } from './blockMarks.ts';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.ts';
import { blockAddress } from '../routes/internalLinks.ts';
import { useT } from '../i18n/useT.tsx';
import {
  BLOCK_COLORS,
  CALLOUT_TONES,
  DIVIDER_ORNAMENTS,
  DIVIDER_ORNAMENT_PLACES,
  DIVIDER_RULES,
} from '@sone/core';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useViewportChanges } from '../hooks/useViewportChanges.ts';

import {
  LockIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  DuplicateIcon,
  IndentIcon,
  OutdentIcon,
  TrashIcon,
  AlignAutoIcon,
  AlignCentreIcon,
  AlignLeftIcon,
  AlignRightIcon, GripIcon, PlusIcon, ToneIcon, OrnamentIcon } from './icons.tsx';
import { keepsEditorSelection, popupItem } from './popup.ts';

interface BlockMenuProps {
  view: EditorView;
  /** Bumped on every transaction, so the button follows the caret. */
  revision: number;
  /**
   * The workspace's people, for assigning a task (ADR-0052).
   *
   * Passed in rather than fetched here: the page already has them for the
   * comments panel, and a second fetch of the same list per menu opening would
   * be a request for something already in hand.
   */
  members: Array<{ userId: string; displayName: string }>;
  /** The page these blocks are on, for the address of one (ADR-0170). */
  pageId: string;
  /** Its title, which is the decorative half of that address. */
  pageTitle: string;
}

interface Action {
  id: string;
  /** A message key: the menu translates it where it draws it (ADR-0041). */
  label: MessageKey;
  /** The picture on the button. The label becomes its tooltip. */
  Mark: (props: { size?: number }) => ReactElement;
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
  // Width, which is content or full, and that is what was asked for. No colour —
  // a video is not tinted — and no alignment: a player narrower than the column
  // is not a thing anybody wants, and one aligned inside its own width is a
  // control with nothing to do (ADR-0037).
  video: { width: true, color: false, align: false },
  table: { width: true, color: false, align: false },
  collectionView: { width: true, color: false, align: false },
  divider: { width: true, color: true, align: false },
};

/** The appearance controls for one block. */
function BlockAppearance({
  view,
  node,
  members,
  run,
}: {
  view: EditorView;
  node: PMNodeLike;
  /** Who a task can be given to: the workspace's people (ADR-0052). */
  members: Array<{ userId: string; displayName: string }>;
  run: (command: Command) => void;
}): ReactElement | null {
  const { t } = useT();
  /*
   * Read from the node this section is about, not from the document.
   *
   * My first version looked the node up again by position in the outer
   * component — a second lookup of something already in hand, which is one more
   * place to be wrong about which block the menu belongs to.
   */
  const assignedHere = readAssignee(node as never);
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
      <p className="block-menu-label">{t('block.appearance')}</p>

      {/* Whose task it is (ADR-0052).
        *
        * Only for a task: a paragraph assigned to somebody is a note about them
        * rather than work, and offering it everywhere would make the
        * notification mean less each time it arrives. */}
      {node.type.name === 'todo' && members.length > 0 && (
        <div className="block-menu-group">
          <p className="block-menu-label">{t('block.assignee')}</p>
          <select
            className="block-assignee"
            aria-label={t('block.assignee')}
            value={assignedHere ?? ''}
            onChange={(event) => run(setAssignee(event.target.value || null))}
          >
            <option value="">{t('block.assignee.nobody')}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {applies.align && (
        <div className="block-menu-choices" role="group" aria-label={t('block.alignment')}>
          {/* Symbols, not words. Four German labels in a row overflowed the menu
              and gave it a scrollbar — and alignment is one of the few settings
              a picture states better than a word, because the icon is the
              result. The name is still the title and the accessible label. */}
          {[
            { id: null, label: 'block.align.auto' as MessageKey, Mark: AlignAutoIcon },
            { id: 'start' as const, label: 'block.align.left' as MessageKey, Mark: AlignLeftIcon },
            {
              id: 'center' as const,
              label: 'block.align.centre' as MessageKey,
              Mark: AlignCentreIcon,
            },
            { id: 'end' as const, label: 'block.align.right' as MessageKey, Mark: AlignRightIcon },
          ].map((choice) => (
            <button
              key={t(choice.label)}
              type="button"
              role="menuitemradio"
              aria-checked={current.align === choice.id}
              className={
                current.align === choice.id ? 'block-menu-choice current' : 'block-menu-choice'
              }
              title={t(choice.label)}
              aria-label={t(choice.label)}
              {...popupItem(() => run(setBlockStyle({ align: choice.id })))}
            >
              <choice.Mark />
            </button>
          ))}
        </div>
      )}

      {applies.width && (
        <div className="block-menu-choices" role="group" aria-label={t('block.width')}>
          {[
            { id: null, label: 'block.width.column' as MessageKey },
            // "Wide" is a step between the reading column and the page, and for
            // an image it is a distinction without a difference: all three read
            // as "the width of the text, or a bit more". An image is either in
            // the column with the writing or across the page.
            ...(node.type.name === 'image'
              ? []
              : [{ id: 'wide' as const, label: 'block.width.wide' as MessageKey }]),
            { id: 'full' as const, label: 'block.width.full' as MessageKey },
          ].map((choice) => (
            <button
              key={t(choice.label)}
              type="button"
              role="menuitemradio"
              aria-checked={current.width === choice.id}
              className={
                current.width === choice.id ? 'block-menu-choice current' : 'block-menu-choice'
              }
              {...popupItem(() => run(setBlockStyle({ width: choice.id })))}
            >
              {t(choice.label)}
            </button>
          ))}
        </div>
      )}

      {/* What kind of callout this is (ADR-0188). Symbols in the tone's colour,
          because the symbol *is* the tone: the box will show this exact mark.
          Before the colour swatches, since the tone decides the background and
          the colour only the words. */}
      {node.type.name === 'callout' && (
        <div className="block-menu-choices block-menu-tones" role="group" aria-label={t('block.tone')}>
          {CALLOUT_TONES.map((tone) => {
            const chosen = (current.tone ?? 'note') === tone;
            const label = t(`block.tone.${tone}` as MessageKey);
            return (
              <button
                key={tone}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                data-tone={tone}
                className={chosen ? 'block-menu-choice block-menu-tone current' : 'block-menu-choice block-menu-tone'}
                title={label}
                aria-label={label}
                {...popupItem(() => run(setBlockStyle({ tone })))}
              >
                <ToneIcon tone={tone} />
              </button>
            );
          })}
        </div>
      )}

      {/* How a divider is drawn (ADR-0189): the line, a symbol on it, and where
          the symbol sits. The line choices are drawn by the same stylesheet
          rules as the line itself, so each button shows what it does. */}
      {node.type.name === 'divider' && (
        <>
          <div className="block-menu-choices block-menu-rules" role="group" aria-label={t('block.rule')}>
            {DIVIDER_RULES.map((rule) => {
              const chosen = (current.rule ?? 'solid') === rule;
              const label = t(`block.rule.${rule}` as MessageKey);
              return (
                <button
                  key={rule}
                  type="button"
                  role="menuitemradio"
                  aria-checked={chosen}
                  className={chosen ? 'block-menu-choice block-menu-rule current' : 'block-menu-choice block-menu-rule'}
                  title={label}
                  aria-label={label}
                  {...popupItem(() => run(setBlockStyle({ rule })))}
                >
                  <span className="divider-preview" data-rule={rule}>
                    <hr />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="block-menu-choices block-menu-ornaments" role="group" aria-label={t('block.ornament')}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={current.ornament === null}
              aria-label={t('block.ornament.none')}
              title={t('block.ornament.none')}
              className={
                current.ornament === null
                  ? 'block-menu-choice block-menu-ornament none current'
                  : 'block-menu-choice block-menu-ornament none'
              }
              {...popupItem(() => run(setBlockStyle({ ornament: null })))}
            />
            {DIVIDER_ORNAMENTS.map((ornament) => {
              const chosen = current.ornament === ornament;
              const label = t(`block.ornament.${ornament}` as MessageKey);
              return (
                <button
                  key={ornament}
                  type="button"
                  role="menuitemradio"
                  aria-checked={chosen}
                  className={chosen ? 'block-menu-choice block-menu-ornament current' : 'block-menu-choice block-menu-ornament'}
                  title={label}
                  aria-label={label}
                  {...popupItem(() => run(setBlockStyle({ ornament })))}
                >
                  <OrnamentIcon ornament={ornament} />
                </button>
              );
            })}
          </div>
          {current.ornament !== null && (
            <div className="block-menu-choices" role="group" aria-label={t('block.ornamentAt')}>
              {DIVIDER_ORNAMENT_PLACES.map((place) => {
                const chosen = (current.ornamentAt ?? 'center') === place;
                return (
                  <button
                    key={place}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chosen}
                    className={chosen ? 'block-menu-choice current' : 'block-menu-choice'}
                    {...popupItem(() => run(setBlockStyle({ ornamentAt: place })))}
                  >
                    {t(`block.ornamentAt.${place}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Who said it (ADR-0188). One line under the quote; empty removes it. */}
      {node.type.name === 'quote' && (
        <label className="block-menu-field">
          <span className="block-menu-label">{t('block.source')}</span>
          <input
            type="text"
            className="block-menu-input"
            placeholder={t('block.source.placeholder')}
            defaultValue={current.source ?? ''}
            // The panel prevents mousedown to keep the editor's selection; a
            // text field needs that event to take focus. The editor keeps its
            // selection in state regardless, which is what the command reads.
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              // The menu's arrow keys and Enter belong to the field while it
              // has focus; only Escape is left to close the menu.
              if (event.key !== 'Escape') event.stopPropagation();
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
            onBlur={(event) => {
              if (event.target.value.trim() !== (current.source ?? '')) {
                run(setBlockStyle({ source: event.target.value }));
              }
            }}
          />
        </label>
      )}

      {applies.color && (
        <div className="block-menu-swatches" role="group" aria-label={t('block.colour')}>
          {/* Null first, and shown as a slash rather than a colour: "no colour
              chosen" is a state, not a shade, and drawing it as one would make
              the default look like a decision. */}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={current.color === null}
            aria-label={t('block.defaultColour')}
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
  const { t } = useT();
  const fileId = String(node.attrs['fileId'] ?? '');
  if (fileId === '') return null;

  const url = `/api/files/${fileId}`;
  const name = String(node.attrs['filename'] ?? 'file');
  const category = node.attrs['category'];
  const display = String(node.attrs['display'] ?? 'card');
  const viewable = category === 'pdf' || category === 'text' || category === 'image';

  const options: Array<{ id: string; label: MessageKey }> = [
    { id: 'card', label: 'block.display.card' },
    { id: 'line', label: 'block.display.line' },
  ];
  // An image has "Image" in the section below instead: a picture in a viewer
  // frame is a picture behind a scrollbar, which is worse than the picture.
  if (viewable && category !== 'image') options.push({ id: 'full', label: 'block.display.viewer' });

  return (
    <div className="block-menu-group">
      <p className="block-menu-label">{t('block.file')}</p>

      {viewable && (
        <a
          className="block-menu-item"
          role="menuitem"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('block.openInNewTab')}
        </a>
      )}
      <a className="block-menu-item" role="menuitem" href={url} download={name}>
        {t('block.download')}
      </a>

      {/* The file as uploaded, for an image that has a smaller copy.
        *
        * Offered for every image rather than only where a variant exists: the
        * block does not know whether one was made, and the server answers with
        * the original either way — so the entry is always truthful, and the
        * alternative is asking the server on every menu that opens.
        *
        * Only for images, because nothing else has a second version. */}
      {category === 'image' && (
        <a
          className="block-menu-item"
          role="menuitem"
          href={`${url}?original=true`}
          download={name}
        >
          {t('block.downloadOriginal')}
        </a>
      )}

      <div className="block-menu-choices" role="group" aria-label={t('block.showAs')}>
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
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A video's own actions (ADR-0037).
 *
 * The file group's shape, because the questions are the same ones: how should
 * this be drawn, and how do I get at the thing itself. What differs is that two
 * of the three sources are somewhere else — so "Download" belongs to an upload
 * and "Open" to a link, and neither is offered where it would lie.
 */
function VideoActions({
  node,
  at,
  run,
}: {
  node: PMNodeLike;
  at: number;
  run: (command: Command) => void;
}): ReactElement | null {
  const { t } = useT();
  const source = String(node.attrs['source'] ?? 'file');
  const fileId = String(node.attrs['fileId'] ?? '');
  const url = String(node.attrs['url'] ?? '');
  const display = String(node.attrs['display'] ?? 'player');
  const name = String(node.attrs['title'] ?? 'video');

  // A stream is offered only as a player: a card for something that is
  // interesting only while it is live is a dead link tomorrow. The command
  // refuses it too, so this is the menu agreeing rather than the menu deciding.
  const options: Array<{ id: string; label: MessageKey }> =
    source === 'stream'
      ? [{ id: 'player', label: 'block.display.player' }]
      : [
          { id: 'player', label: 'block.display.player' },
          { id: 'card', label: 'block.display.card' },
          { id: 'link', label: 'block.display.line' },
        ];

  return (
    <div className="block-menu-group">
      <p className="block-menu-label">{t('block.video')}</p>

      {source === 'file' && fileId !== '' && (
        <a className="block-menu-item" role="menuitem" href={`/api/files/${fileId}`} download={name}>
          {/* Not "Download the original": there is no second copy. An image has a
              smaller version made for display, and a video is stored as it
              arrived — nothing is transcoded (ADR-0037). */}
          {t('block.download')}
        </a>
      )}

      {source !== 'file' && url !== '' && (
        <a
          className="block-menu-item"
          role="menuitem"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('block.openWhereItLives')}
        </a>
      )}

      <div className="block-menu-choices" role="group" aria-label={t('block.showAs')}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={display === option.id}
            className={display === option.id ? 'block-menu-choice current' : 'block-menu-choice'}
            {...popupItem(() =>
              run(setVideoDisplay(at, option.id as 'player' | 'card' | 'link')),
            )}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * How an image is shown.
 *
 * The three layouts a file has, offered on an image too — and reached by
 * converting the block rather than by drawing them twice. An image is a file
 * with a special way of being drawn.
 */
function ImageDisplay({
  node,
  at,
  run,
}: {
  node: PMNodeLike;
  at: number;
  run: (command: Command) => void;
}): ReactElement {
  const { t } = useT();
  const current = node.type.name === 'image' ? 'image' : String(node.attrs['display'] ?? 'card');

  return (
    <div className="block-menu-group">
      <p className="block-menu-label">{t('block.showAs')}</p>
      <div className="block-menu-choices" role="group" aria-label={t('block.showAs')}>
        {[
          { id: 'image' as const, label: 'block.display.image' as MessageKey },
          { id: 'card' as const, label: 'block.display.card' as MessageKey },
          { id: 'line' as const, label: 'block.display.link' as MessageKey },
        ].map((choice) => (
          <button
            key={choice.id}
            type="button"
            role="menuitemradio"
            aria-checked={current === choice.id}
            className={
              current === choice.id ? 'block-menu-choice current' : 'block-menu-choice'
            }
            {...popupItem(() => run(showImageAs(at, choice.id)))}
          >
            {t(choice.label)}
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

export function BlockMenu({
  view,
  revision,
  members,
  pageId,
  pageTitle,
}: BlockMenuProps): ReactElement | null {
  const { t } = useT();
  const { copy, copied } = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const range = selectedBlockRange(view.state);
  /*
   * Which blocks a type change will act on (ADR-0165).
   *
   * Not `range`: that is a block and its indented children, which is the right
   * answer for dragging, indenting and duplicating, and the wrong one for "the
   * four lines I selected".
   */
  const spanned = blocksInSelection(view.state);
  const from = range?.from ?? null;
  const size = range ? range.endIndex - range.index : 0;

  // Re-place when the page moves: a scroll produces no transaction, so nothing
  // else would tell this component that the text is no longer where it was.
  // The editor's own box as well as the window: the page panel opening narrows
  // the text without any window event, and a stale anchor then puts these
  // controls where the text used to be.
  const viewportToken = useViewportChanges(from !== null, view.dom as HTMLElement);

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

  /**
   * Whether the block this menu is about is locked.
   *
   * From the node at the range's start rather than from a selection scan: the
   * menu is about one block, and a mixed answer for a selection spanning two
   * would make one label wrong.
   */
  const lockedHere = (() => {
    const node = view.state.doc.nodeAt(range.from);
    return node ? isBlockLocked(node) : false;
  })();

  /**
   * The block's own id, which is what an internal link points at (ADR-0170).
   *
   * Empty for the moment between a block appearing and `blockIds` assigning it
   * one — a plugin pass, not a render — and the entry is left out rather than
   * offering an address that names nothing.
   */
  const blockId = String(range.node.attrs['id'] ?? '');

  /**
   * What can be done to the block, as one row of six.
   *
   * Six full-width rows of text was most of the menu's height before anything
   * about the block itself appeared — and two of them, indent and outdent, were
   * offered a second time in a "Nesting" section below. That section is gone:
   * the same two commands with two names in one menu is the menu disagreeing
   * with itself.
   *
   * Every one of these is a verb with an obvious picture, which is the condition
   * for dropping the word. The word stays as the tooltip and the accessible
   * label — nothing is hidden, only folded.
   */
  const actions: Action[] = [
    { id: 'move-up', label: 'block.moveUp', Mark: ArrowUpIcon, command: moveBlockUp },
    { id: 'move-down', label: 'block.moveDown', Mark: ArrowDownIcon, command: moveBlockDown },
    { id: 'outdent', label: 'block.outdent', Mark: OutdentIcon, command: outdentBlockSubtree },
    { id: 'indent', label: 'block.indent', Mark: IndentIcon, command: indentBlockSubtree },
    {
      id: 'duplicate',
      label: 'block.duplicate',
      Mark: DuplicateIcon,
      command: duplicateBlockSubtree,
    },
    /*
     * Locking, beside duplicate and before delete (ADR-0049).
     *
     * A verb with an obvious picture, which is this row's condition. Its label
     * flips, so one control says both what it does and what the block's state
     * is — a padlock that only ever said "lock" would leave somebody guessing
     * whether it already was.
     */
    {
      id: 'lock',
      label: lockedHere ? 'block.unlock' : 'block.lock',
      Mark: LockIcon,
      command: setBlockLocked(!lockedHere),
    },
    {
      id: 'delete',
      label: 'block.delete',
      Mark: TrashIcon,
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
          aria-label={t('block.insert')}
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
            size > 1 ? t('block.actions.counted', { count: size }) : t('block.actions')
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
              {t('block.appliesToNested', { count: size - 1 })}
            </p>
          )}

          <div className="block-menu-actions" role="group" aria-label={t('block.actions')}>
            {actions.map((action) => {
              // Disabled when the command refuses, so the menu never offers
              // something that silently does nothing.
              const possible = action.command(view.state, undefined);
              return (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  className={
                    [
                      'block-menu-action',
                      action.destructive ? 'destructive' : '',
                      // The padlock says which way it is standing (ADR-0194).
                      // One control that only ever said "lock" left somebody
                      // guessing whether the block already was — the flipped
                      // label did that in a tooltip, which is where nobody
                      // looks before clicking.
                      action.id === 'lock' && lockedHere ? 'current' : '',
                    ]
                      .filter((part) => part !== '')
                      .join(' ')
                  }
                  aria-pressed={action.id === 'lock' ? lockedHere : undefined}
                  /*
                   * Refused by the lock, and said so here (ADR-0194).
                   *
                   * The dry run below asks the *command* whether it would act,
                   * and every one of these would: what refuses them is
                   * `filterTransaction` in `blockLock`, one layer further on,
                   * where a menu cannot ask. So moving, duplicating and
                   * deleting a locked block appeared to be on offer and then
                   * did nothing at all.
                   */
                  disabled={!possible || (lockedHere && action.id !== 'lock')}
                  title={t(action.label)}
                  aria-label={t(action.label)}
                  {...popupItem(() => run(action.command))}
                >
                  <action.Mark />
                </button>
              );
            })}
          </div>

          {/* The address of this block, to paste as a link (ADR-0170).
            *
            * Asked for here in so many words: *„dass man dazu bei einem
            * vorhandenen Content Element auf dem Anfasser einen Button hat mit
            * «Interne URL kopieren»"*.
            *
            * Not in the icon row above, and not because it would not fit: every
            * item in that row is a `Command` the editor can refuse, and this one
            * changes nothing about the document. A row whose members are all one
            * kind of thing is a row somebody can reason about.
            *
            * The menu is left open, unlike everything else here, so the label
            * has somewhere to say *copied*. A confirmation on a menu that has
            * already closed is a confirmation nobody sees. */}
          {blockId !== '' && (
            <div className="block-menu-group">
              <button
                type="button"
                role="menuitem"
                className="block-menu-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void copy(
                    blockAddress(window.location.origin, pageId, blockId, pageTitle),
                    blockId,
                  );
                }}
              >
                {copied === blockId ? t('block.linkCopied') : t('block.copyLink')}
              </button>
            </div>
          )}

          {/* How this block looks.
            *
            * Only the settings that mean something for its type: width on a
            * paragraph does nothing anybody wants, and colour on an image is
            * not a thing. A section of controls that have no effect teaches
            * people the panel is decoration.
            */}
          {/* Why the rest of the menu is not here (ADR-0194).
            *
            * Reported as *„Ich habe hier einen Info-Block eingesetzt den ich
            * jetzt nicht mehr bearbeiten kann. Weder Farben noch Typ ändern
            * klappt. Es bleibt blau."* — the block was locked, and every
            * setting below was refused by `blockLock`'s filter without a word.
            *
            * The sections are left out rather than greyed: forty disabled
            * controls are noise, and this menu already says elsewhere that a
            * section of controls with no effect teaches people the panel is
            * decoration. One sentence and a padlock that shows its state are
            * the whole answer. */}
          {lockedHere && <p className="block-menu-note">{t('block.lockedNote')}</p>}

          {/* A file's own actions, where every other block's are.
            *
            * They lived in a `···` button on the block itself, which was a
            * second place to ask the same kind of question — and the gutter is
            * where somebody already looks. */}
          {!lockedHere && range.node.type.name === 'video' && (
            <VideoActions node={range.node} at={range.from} run={run} />
          )}

          {!lockedHere && range.node.type.name === 'file' && (
            <FileActions view={view} node={range.node} at={range.from} run={run} />
          )}

          {/* An image can also be a card or a line: those are the file block's
              own layouts, reached by becoming one. */}
          {!lockedHere &&
            (range.node.type.name === 'image' ||
              (range.node.type.name === 'file' &&
                range.node.attrs['category'] === 'image')) && (
            <ImageDisplay node={range.node} at={range.from} run={run} />
          )}

          {!lockedHere && (
            <BlockAppearance view={view} node={range.node} members={members} run={run} />
          )}

          {/* Table actions, only inside a table. prosemirror-tables' commands
              refuse elsewhere, and a menu section full of disabled items is
              noise rather than information. */}
          {!lockedHere && isInTable(view.state) && (
            <div className="block-menu-group">
              <p className="block-menu-label">{t('block.table')}</p>
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
                    {/* By id, not by the label the editor package carries: that
                        package has no catalogue and should not gain one
                        (ADR-0041). Its label is the fallback. */}
                    {`tableAction.${action.id}` in en
                      ? t(`tableAction.${action.id}` as MessageKey)
                      : action.label}
                  </button>
                );
              })}
            </div>
          )}

          {!lockedHere && (
          <div className="block-menu-group">
            <p className="block-menu-label">{t('block.turnInto')}</p>
            {BLOCK_TYPE_ORDER.map((name) => {
              const type = schema.nodes[name];
              if (!type) return null;
              // Current when *every* block this will act on is already that
              // type — the same rule the command toggles on. Marking it from
              // the first of four would say "these are bullets" about a
              // selection that is one bullet and three paragraphs.
              const active =
                spanned.length > 1
                  ? spanned.every((one) => one.node.type.name === name)
                  : range.node.type.name === name;
              return (
                <button
                  key={name}
                  type="button"
                  role="menuitem"
                  className="block-menu-item"
                  aria-current={active}
                  {...popupItem(() => {
                    /*
                     * Restore the caret into the block first: the type change
                     * acts on the selection, and a tap may have moved it.
                     *
                     * **Only when the selection is inside one block**
                     * (ADR-0165). Putting the caret back into the handle's own
                     * block threw the other three away, which is why turning
                     * four selected lines into a list turned one. A selection
                     * that spans blocks is the answer to "which blocks", not
                     * something to recover from.
                     *
                     * Asked of `blocksInSelection` rather than of `size`: that
                     * one counts a block **and its indented children**, so it
                     * is larger than one for a bullet with sub-bullets and says
                     * nothing about what is selected.
                     */
                    if (spanned.length <= 1) {
                      const $pos = view.state.doc.resolve(range.from + 1);
                      view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
                    }
                    run(toggleBlockType(type));
                  })}
                >
                  {/* The same mark the / menu gives this block: one subject, one
                      symbol, or the two lists teach two things for one. */}
                  {(() => {
                    const Mark = BLOCK_MARKS[name];
                    return Mark ? <Mark /> : null;
                  })()}
                  {/* A name the list does not know is shown as it is — that is a
                      block type, not a sentence. */}
                  <span>{LABELS[name] ? t(LABELS[name]) : name}</span>
                  {active ? ' ·' : ''}
                </button>
              );
            })}
          </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * What each block is called under "Turn into".
 *
 * The same names the `/` menu uses, and the same keys — one word for one thing,
 * or the two menus would drift apart in a translation (ADR-0041). "Heading" is
 * the exception: this list offers it at any level, so it is not one of the
 * menu's three.
 */
const LABELS: Record<string, MessageKey> = {
  paragraph: 'slash.paragraph',
  heading: 'block.heading',
  bulletList: 'slash.bulletList',
  numberedList: 'slash.numberedList',
  todo: 'slash.todo',
  toggle: 'slash.toggle',
  quote: 'slash.quote',
  callout: 'slash.callout',
  code: 'slash.code',
  divider: 'slash.divider',
};
