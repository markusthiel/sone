/**
 * SONE web — the per-entry menu.
 *
 * One unobtrusive ⋯ per row: rename, new inside (folders only), delete.
 *
 * The button is always in the DOM and always occupies its space, but is
 * visually quiet until the row is hovered, focused, or the menu is open. That is
 * a narrower rule than it sounds: a control revealed *by* hover does not exist
 * on a phone (ADR-0016), so the opacity is only ever a de-emphasis of something
 * already present and already hittable. On touch there is no hover, so it stays
 * visible.
 *
 * Renaming happens inline rather than in a dialog. A dialog for a single text
 * field is a heavier interaction than the change deserves, and the title is
 * right there to edit.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { THEME_COLORS, isCustomColor, type EntryIcon } from '@sone/core';
import { Pipette } from 'lucide-react';

import { useT } from '../i18n/useT.tsx';

import { ICON_NAMES } from './EntryIconView.tsx';

import { api, type PageNode } from '../api/client.ts';
import { EntryIconView } from './EntryIconView.tsx';
import {
  LockIcon,
  UploadIcon,
  DownloadIcon,
  BookmarkIcon,
  PageIcon,
  FolderIcon,
  BrushIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FolderPlusIcon,
  MoreIcon,
  MoveIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  BellIcon,
  StarIcon,
  TrashIcon,
} from './icons.tsx';

/**
 * Choosing an icon and the colours around it.
 *
 * Applied straight away rather than behind a Save. The change is small,
 * reversible and visible the moment it lands — a confirmation step would be
 * more ceremony than the decision deserves, and it is the tree redrawing that
 * tells somebody it worked.
 *
 * A failure is silent for the same reason a theme's is: this is decoration, and
 * an error banner about a folder colour would be louder than what it reports.
 */
function EntryAppearance({
  node,
  onChanged,
}: {
  node: PageNode;
  onChanged: () => void;
}): ReactElement {
  const { t } = useT();
  const icon = node.icon;
  const current = icon?.kind === 'icon' ? icon.value : null;
  const [query, setQuery] = useState('');

  // Matched on the words in a name, so "arrow" finds `arrow-up` and "up" finds
  // it too. Bounded, because rendering two thousand icons at once is slow
  // enough to feel like the menu is broken.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = needle === ''
      ? ICON_NAMES
      : ICON_NAMES.filter((name) => name.includes(needle));
    return all.slice(0, 300);
  }, [query]);

  const apply = (changes: { icon?: EntryIcon | null; titleColor?: string | null }): void => {
    void api
      .setEntryIcon(node.id, changes)
      .then(() => onChanged())
      .catch(() => {
        // Decoration. The tree simply does not change.
      });
  };

  const chooseIcon = (name: string | null): void => {
    if (!name) {
      apply({ icon: null });
      return;
    }
    apply({
      icon: {
        kind: 'icon',
        value: name as EntryIcon['value'],
        // The colour is kept when the icon changes: somebody who picked blue
        // wants blue, not blue until they change their mind about the shape.
        ...(icon?.color ? { color: icon.color as NonNullable<EntryIcon['color']> } : {}),
      },
    });
  };

  return (
    <div className="entry-appearance">
      <p className="entry-menu-label">{t('icon.heading')}</p>

      {/* A filter rather than a shorter list.
        *
        * The set was fifty hand-picked names, kept short because a long grid is
        * a wall to scroll past. With a filter the length stops mattering and
        * the choosing gets better: somebody types "boat" instead of hunting for
        * it among two hundred squares. */}
      <input
        className="entry-icon-search"
        type="search"
        value={query}
        placeholder={t('icon.search')}
        aria-label={t('icon.search')}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="entry-icon-grid" role="group" aria-label={t('icon.heading')}>
        <button
          type="button"
          className={current === null ? 'entry-icon current' : 'entry-icon'}
          aria-pressed={current === null}
          aria-label={t('icon.default')}
          onClick={() => chooseIcon(null)}
        >
          {/* The entry's own kind, so the first swatch is the mark this entry
              already wears — a sheet for a page, a folder for a folder, a brush
              for a canvas. It was "folder or else page", which is the same
              narrowing the tree had: a canvas could not reach it, so the one
              swatch that means "the default" showed the wrong default. */}
          <EntryIconView icon={null} kind={node.kind} />
        </button>

        {matches.map((name) => (
          <button
            key={name}
            type="button"
            className={current === name ? 'entry-icon current' : 'entry-icon'}
            aria-pressed={current === name}
            aria-label={name.replace(/-/g, ' ')}
            title={name.replace(/-/g, ' ')}
            onClick={() => chooseIcon(name)}
          >
            <EntryIconView icon={{ kind: 'icon', value: name }} kind="page" />
          </button>
        ))}
      </div>

      <p className="entry-menu-label">{t('icon.colour')}</p>
      <ColourRow
        current={icon?.color ?? null}
        label="Icon colour"
        onChoose={(color) => {
          if (!current) return;
          apply({
            icon: {
              kind: 'icon',
              value: current as EntryIcon['value'],
              ...(color ? { color: color as NonNullable<EntryIcon['color']> } : {}),
            },
          });
        }}
        disabled={!current}
      />

      <p className="entry-menu-label">{t('icon.nameColour')}</p>
      <ColourRow
        current={icon?.titleColor ?? null}
        label="Name colour"
        onChoose={(color) => apply({ titleColor: color })}
      />
    </div>
  );
}

/**
 * The palette, with "no colour" first and drawn as a state rather than a shade.
 *
 * Exported because workspaces choose colours the same way (ADR-0030) — the same
 * control rather than one that looks like it. Two similar pickers would differ
 * in some small way, and the difference is what makes them worse than one.
 */
export function ColourRow({
  current,
  label,
  onChoose,
  disabled = false,
}: {
  current: string | null;
  label: string;
  onChoose: (color: string | null) => void;
  disabled?: boolean;
}): ReactElement {
  const { t } = useT();
  return (
    <div className="block-menu-swatches" role="group" aria-label={label}>
      <button
        type="button"
        className={current === null ? 'block-menu-swatch none current' : 'block-menu-swatch none'}
        aria-pressed={current === null}
        aria-label={t('swatch.asDesigned', { label })}
        disabled={disabled}
        onClick={() => onChoose(null)}
      />
      {THEME_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={
            current === color
              ? `block-menu-swatch tag-${color} current`
              : `block-menu-swatch tag-${color}`
          }
          aria-pressed={current === color}
          aria-label={`${label}: ${color}`}
          title={color}
          disabled={disabled}
          onClick={() => onChoose(color)}
        />
      ))}

      {/* A colour of one's own, beside the eight rather than instead of them.
        *
        * The names are what make a workspace restylable — change what blue
        * means and every blue thing follows — so this is the escape for the
        * case a palette cannot cover, not the ordinary way to pick a colour
        * (ADR-0023).
        *
        * A native colour input: every platform has one people already know, and
        * building a wheel would be a worse version of something the browser
        * ships. */}
      <label
        className={
          isCustomColor(current)
            ? 'block-menu-swatch custom current'
            : 'block-menu-swatch custom'
        }
        title={t('icon.ownColour')}
      >
        {/* A pipette rather than another circle.
          *
          * Nine circles say "one of these"; a tenth would say the same and mean
          * something else. The pipette says a colour is picked here, and it
          * carries the chosen one so it still reads as a swatch.
          *
          * The input covers the label and is invisible: the platform's own
          * picker opens, which is the part worth keeping, without its chrome
          * deciding the shape. */}
        <Pipette
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          style={isCustomColor(current) ? { color: current } : undefined}
        />
        <input
          type="color"
          value={isCustomColor(current) ? current : '#888888'}
          aria-label={t('swatch.own', { label })}
          disabled={disabled}
          onChange={(event) => onChoose(event.target.value)}
        />
      </label>
    </div>
  );
}

interface EntryMenuProps {
  node: PageNode;
  /**
   * May they change this entry (ADR-0095)?
   *
   * Passed rather than read from `node` here, so one row has one reading of its
   * role and the menu cannot answer differently from the row it hangs off.
   *
   * What it gates is the verbs: rename, reorder, appearance, new inside, move,
   * import, lock, delete. What it does **not** gate is what somebody who may
   * read this entry is entitled to anyway — starring it, watching it, exporting
   * it. Those are either personal or a read, and hiding them would be taking
   * something away rather than telling the truth about a refusal.
   */
  canEdit: boolean;
  /**
   * May they decide who else gets in?
   *
   * Stricter than `canEdit`, and matching `requirePageAdmin`, which is what the
   * sharing routes actually use: an editor may write this page and may not hand
   * it to somebody else.
   */
  canManage: boolean;
  /** Reloads the tree after an icon or colour changed. */
  onChanged: () => void;
  onRename: (pageId: string, title: string) => void;
  onCreate: (parentPageId: string, kind: 'page' | 'folder' | 'canvas') => void;
  onDelete: (pageId: string, descendants: number) => void;
  onStartRename: (pageId: string) => void;
  onStartMove: (pageId: string) => void;
  onStartMoveToWorkspace: (pageId: string) => void;
  /** Open the export dialog for this entry (ADR-0044). */
  onStartExport: (pageId: string) => void;
  /** Open the import dialog with this entry as the destination (ADR-0044). */
  onStartImport: (pageId: string) => void;
  onStartShare: (pageId: string) => void;
  onReorder: (pageId: string, direction: 'up' | 'down') => void;
  /** False at the ends of the list, so the entries are visibly unavailable. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  isFavourite: boolean;
  onToggleFavourite: (pageId: string, favourite: boolean) => void;
  /** Whether this entry is watched, and how to change that (ADR-0064). */
  isWatched?: boolean;
  onToggleWatch?: (pageId: string, watching: boolean) => void;
}

/** Descendant count, for telling someone what a delete will take with it. */
export function countDescendants(node: PageNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

export function EntryMenu({
  node,
  canEdit,
  canManage,
  onChanged,
  onCreate,
  onDelete,
  onStartRename,
  onStartMove,
  onStartMoveToWorkspace,
  onStartExport,
  onStartImport,
  onStartShare,
  onReorder,
  canMoveUp,
  canMoveDown,
  isFavourite,
  onToggleFavourite,
  isWatched,
  onToggleWatch,
}: EntryMenuProps): ReactElement {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isFolder = node.kind === 'folder';
  // From the tree's own record of the page, so the label is right the moment
  // the menu opens rather than after a request.
  const isTemplate = node.template === true;
  const isLocked = node.locked === true;
  const descendants = countDescendants(node);
  const title = node.title || (isFolder ? 'Untitled folder' : 'Untitled');

  return (
    <div className="entry-menu-wrap">
      <button
        ref={buttonRef}
        className="entry-more"
        type="button"
        aria-label={t('entry.menu', { title })}
        aria-expanded={open}
        onClick={(event) => {
          // Stops the click reaching the row, which would navigate.
          event.preventDefault();
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
      >
        <MoreIcon />
      </button>

      {open && (
        <div className="entry-menu" ref={panelRef} role="menu">
          {/* The five things done most, as one row.
            *
            * Rename, favourite, share, and the two reorderings were five
            * full-width rows of text, which was most of the menu's height
            * before anything about *this* entry appeared. Each is a verb with
            * an obvious picture, which is the condition for dropping the word —
            * and the word stays as the tooltip and the accessible label, the
            * same trade the block menu made (ADR-0042).
            */}
          {/* Both rows of marks in one band.
            *
            * You are right that "New" needs to stand apart, and I do not think a
            * line or a colour is the way. A line between two rows of icons
            * splits a thing that reads as one; a coloured row would be emphasis
            * with no meaning behind it, and colour here has always meant
            * something — a palette choice, or danger.
            *
            * What actually sets these apart is that they are controls and
            * everything below is a list. So they sit on their own surface, and
            * the surface is the separator: no line needed, and "New" is
            * distinct because it is labelled inside a band of buttons rather
            * than because it has been fenced off.
            */}
          <div className="entry-menu-band">
          <div className="entry-menu-actions" role="group" aria-label={t('entry.actions')}>
            {/* Beside the star, and not the same act (ADR-0064).
              *
              * A favourite is "I come here often"; watching is "tell me when
              * this changes". The two sit together because they are the same
              * shape of mark, and their titles are what keep them apart —
              * somebody who wanted a bookmark must not end up with mail. */}
            {onToggleWatch && (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={isWatched === true}
                className={isWatched ? 'entry-menu-action current' : 'entry-menu-action'}
                title={isWatched ? t('entry.unwatch') : t('entry.watch')}
                aria-label={isWatched ? t('entry.unwatch') : t('entry.watch')}
                onClick={() => {
                  setOpen(false);
                  onToggleWatch(node.id, isWatched !== true);
                }}
              >
                <BellIcon data-filled={isWatched ? 'true' : 'false'} />
              </button>
            )}

            {/* A verb, so it needs the rights for it (ADR-0095). The star and
                the bell above and below stay: one is personal and the other is
                a subscription, and neither writes to the entry. */}
            {canEdit && (
              <button
                type="button"
                role="menuitem"
                className="entry-menu-action"
                title={t('entry.rename')}
                aria-label={t('entry.rename')}
                onClick={() => {
                  setOpen(false);
                  onStartRename(node.id);
                }}
              >
                <PencilIcon />
              </button>
            )}

            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={isFavourite}
              className={isFavourite ? 'entry-menu-action current' : 'entry-menu-action'}
              title={isFavourite ? t('entry.unfavourite') : t('entry.favourite')}
              aria-label={isFavourite ? t('entry.unfavourite') : t('entry.favourite')}
              onClick={() => {
                setOpen(false);
                onToggleFavourite(node.id, !isFavourite);
              }}
            >
              <StarIcon data-filled={isFavourite ? 'true' : 'false'} />
            </button>

            {/* Handing this to somebody else, which is the one thing an
                editor may not do: the sharing routes are guarded by
                `requirePageAdmin` (ADR-0095). */}
            {canManage && (
              <button
                type="button"
                role="menuitem"
                className="entry-menu-action"
                title={t('entry.share')}
                aria-label={t('entry.share')}
                onClick={() => {
                  setOpen(false);
                  onStartShare(node.id);
                }}
              >
                <ShareIcon />
              </button>
            )}

            {/* Reordering without dragging.
             *
             * Dragging is a pointer-device feature — iOS never fires those
             * events — so on a tablet these two are the only way to reorder at
             * all. They also work with a keyboard, which dragging does not.
             *
             * Hidden rather than disabled when they may not (ADR-0095):
             * `disabled` here means "not at this end of the list", which is a
             * fact about position, and using the same appearance for "not
             * yours" would make one word answer two questions. */}
            {canEdit && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="entry-menu-action"
                  disabled={!canMoveUp}
                  title={t('entry.moveUp')}
                  aria-label={t('entry.moveUp')}
                  onClick={() => {
                    setOpen(false);
                    onReorder(node.id, 'up');
                  }}
                >
                  <ArrowUpIcon />
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="entry-menu-action"
                  disabled={!canMoveDown}
                  title={t('entry.moveDown')}
                  aria-label={t('entry.moveDown')}
                  onClick={() => {
                    setOpen(false);
                    onReorder(node.id, 'down');
                  }}
                >
                  <ArrowDownIcon />
                </button>
              </>
            )}
          </div>

          {/* What can be put inside, as three marks under one word.
            *
            * The same three the `+` offers and in the same order (page, canvas,
            * folder) — two menus offering the same things in two orders is two
            * things to learn. */}
          {isFolder && canEdit && (
            <div className="entry-menu-new">
              <span className="entry-menu-label">{t('entry.new')}</span>
              <div className="entry-menu-actions">
                {(
                  [
                    // The same three marks the tree draws these with. A `+` and
                    // a folder-with-a-plus were the marks for *adding*, which is
                    // what the row already says — so they were saying it twice
                    // and saying nothing about what is being added.
                    ['page', 'entry.newPage', PageIcon],
                    ['canvas', 'canvas.new', BrushIcon],
                    ['folder', 'entry.newFolder', FolderIcon],
                  ] as const
                ).map(([kind, key, Mark]) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    className="entry-menu-action"
                    title={t(key)}
                    aria-label={t(key)}
                    onClick={() => {
                      setOpen(false);
                      onCreate(node.id, kind);
                    }}
                  >
                    <Mark />
                  </button>
                ))}
              </div>
            </div>
          )}

          </div>

          {canEdit && (
            <button
              className="entry-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onStartMove(node.id);
              }}
            >
              <MoveIcon /> {t('entry.move')}
            </button>
          )}

          {/* Out of this workspace entirely (ADR-0038).
            *
            * Its own entry rather than a destination in the list above, because
            * it is a different decision: a move within a workspace loses
            * nothing, and this one revokes share links, drops restrictions and
            * severs links to what stays behind. */}
          {canEdit && (
            <button
              className="entry-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onStartMoveToWorkspace(node.id);
              }}
            >
              <MoveIcon /> {t('entry.moveToWorkspace')}
            </button>
          )}

          {/* Handing the page's contents back (ADR-0044).
            *
            * Beside the two moves, because it belongs to the same family: all
            * three are about the page going somewhere. Read rights are enough,
            * so it is offered to everybody who can see the entry. */}
          <button
            className="entry-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onStartExport(node.id);
            }}
          >
            <DownloadIcon /> {t('entry.export')}
          </button>

          {/* Beside the export, and gated where the export is not (ADR-0095).
            *
            * This was offered unconditionally, with a note saying so: "this
            * menu has no notion of rights and I was about to invent one for a
            * single entry — one item guarded differently from its neighbours
            * would be a lie about the other four." That was the right call at
            * the time and it is the wrong one now: the menu has a notion of
            * rights, given to it rather than invented, and all five neighbours
            * ask it. Writing into somebody else's folder is a write. */}
          {canEdit && (
            <button
              className="entry-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onStartImport(node.id);
              }}
            >
              <UploadIcon /> {t('entry.import')}
            </button>
          )}

          {/* Offered as a shape to start from (ADR-0045).
            *
            * A toggle in the entry's own menu rather than a setting somewhere
            * else: whether this page is a shape is a fact about this page, and
            * it is decided while looking at it. Only for pages and canvases —
            * a folder has no document to copy. */}
          {!isFolder && canEdit && (
            <button
              className="entry-menu-item"
              type="button"
              role="menuitemcheckbox"
              aria-checked={isTemplate}
              onClick={() => {
                setOpen(false);
                void api
                  .setPageTemplate(node.id, !isTemplate)
                  .then(() => onChanged())
                  .catch(() => onChanged());
              }}
            >
              <BookmarkIcon /> {isTemplate ? t('template.stop') : t('template.use')}
            </button>
          )}

          {/* The consequential half, for whoever may change this entry
              (ADR-0095). Kept together rather than gated one by one, so the
              two rules that separate it are not left drawing lines around
              nothing. */}
          {canEdit && (
            <>
            <hr className="entry-menu-rule" />

            {/* Appearance last, above the trash.
              *
              * It was in the middle, and it is by far the largest block here — a
              * search field, thirty-odd icons and two rows of colours. Anything
              * that big in the middle pushes everything below it out of reach: on
              * a phone the trash needed scrolling past the icon grid to find.
              *
              * It is also the rarest thing anybody comes here for. Frequent and
              * reversible at the top, rare and consequential at the bottom, and
              * the big rare block belongs with the second group. */}
            {/* Icon and the two colours.
              *
              * In the menu the entry already has rather than a dialog: choosing
              * an icon is a small decision, and making somebody open a window for
              * it turns a moment into a task. The menu stays open while choosing,
              * because people try several before settling. */}
            <EntryAppearance node={node} onChanged={onChanged} />

            <hr className="entry-menu-rule" />

            {/* Locking, in the group above the trash (ADR-0049).
              *
              * Consequential and reversible, which is the group the trash is in —
              * and above it, because it is the lesser of the two. A checkbox item
              * rather than two entries, so the state is visible without opening
              * anything.
              *
              * The wording says "against accidental changes" rather than
              * "protected": anybody who may edit can lift it, and a lock that
              * anybody can lift must not read like a permission. */}
            <button
              className="entry-menu-item"
              type="button"
              role="menuitemcheckbox"
              aria-checked={isLocked}
              title={isLocked ? t('entry.unlock.hint') : t('entry.lock.hint')}
              onClick={() => {
                setOpen(false);
                void api
                  .setPageLocked(node.id, !isLocked)
                  .then(() => onChanged())
                  .catch(() => onChanged());
              }}
            >
              {/* Short. The full sentence is the title, because `white-space:
                  nowrap` on a menu item means a long label does not wrap — it
                  leaves the panel, which is what mine did. A menu is a column of
                  verbs; the explanation belongs on hover and in the record. */}
              <LockIcon /> {isLocked ? t('entry.unlock') : t('entry.lock')}
            </button>

            <button
              className="entry-menu-item destructive"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDelete(node.id, descendants);
              }}
            >
              <TrashIcon />{' '}
              {/* The count is stated here rather than only in a confirmation,
                  because it changes whether someone opens the confirmation at
                  all. */}
              {descendants > 0
                ? t('entry.deleteWithChildren', { count: descendants })
                : t('entry.delete')}
            </button>
            </>
          )}

        </div>
      )}
    </div>
  );
}
