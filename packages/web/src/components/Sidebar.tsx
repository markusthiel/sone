/**
 * SONE web — page tree sidebar.
 *
 * A drawer on narrow screens and a column on wide ones, from the same markup.
 * Controls that matter are always rendered, never revealed on hover: a control
 * that appears on :hover does not exist on a phone (ADR-0016).
 *
 * Collapse state is per page and persisted, because a tree that reopens
 * everything on reload has to be re-collapsed on every visit. It lives in
 * localStorage rather than on the server: it describes this browser's view, not
 * the workspace, and syncing it would mean collapsing a branch on a laptop
 * closes it on a phone mid-sentence.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import type { FavouriteEntry, PageNode } from '../api/client.ts';
import {
  canMoveInto,
  canReorderInto,
  canStep,
  findNode,
  siblingsOf,
  stepTarget,
} from './moveRules.ts';
import { useTreeDrag, type TreeDrag } from '../hooks/useTreeDrag.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import { EntryMenu } from './EntryMenu.tsx';
import { AccountMenu } from './AccountMenu.tsx';
import { WorkspaceMenu } from './WorkspaceMenu.tsx';
import { EntryIconView, titleColorStyle } from './EntryIconView.tsx';
import type { WorkspaceIcon } from '../api/client.ts';
import {
  PenIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
  StarIcon,
  TrashIcon,
} from './icons.tsx';

interface SidebarProps {
  workspaceId: string;
  workspaceName: string;
  onSwitchWorkspace: (workspaceId: string) => void;
  tree: PageNode[];
  currentPageId: string | null;
  open: boolean;
  onClose: () => void;
  onCreatePage: (parentPageId: string | null, kind: 'page' | 'folder' | 'canvas') => void;
  onRename: (pageId: string, title: string) => void;
  onDelete: (pageId: string, descendants: number) => void;
  onStartMove: (pageId: string) => void;
  /** Moving out of this workspace entirely (ADR-0038). Its own dialog. */
  onStartMoveToWorkspace: (pageId: string) => void;
  onStartShare: (pageId: string) => void;
  /**
   * Moves an entry into a folder, or to the root when the target is null.
   *
   * `afterPageId` omitted means last, `null` means first. The two differ on
   * purpose: a drop between rows has an opinion about order, and a drop onto a
   * folder does not.
   */
  onMove: (
    pageId: string,
    parentPageId: string | null,
    afterPageId?: string | null,
  ) => void;
  favourites: FavouriteEntry[];
  favouriteIds: Set<string>;
  onToggleFavourite: (pageId: string, favourite: boolean) => void;
  /** Reloads the tree after an entry's icon or colour changed. */
  onReloadTree: () => void;
  /** Whether to offer the way into the workspace administration. */
  canManageWorkspaces: boolean;
  /** Whether to offer the way into the instance administration (ADR-0032). */
  isInstanceAdmin: boolean;
  /** The mark for the workspace you are in (ADR-0030). */
  currentIcon: WorkspaceIcon | null;
  onLogout: () => void;
  /** For the account entry at the foot of the sidebar. */
  displayName: string;
  /** Whose picture to show at the foot of the sidebar. */
  userId: string;
}

const COLLAPSED_KEY = 'sone.collapsedPages';

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    // Corrupt or unavailable storage must not stop the sidebar rendering.
    return new Set();
  }
}

export function Sidebar({
  workspaceId,
  workspaceName,
  onSwitchWorkspace,
  tree,
  currentPageId,
  open,
  onClose,
  onCreatePage,
  onRename,
  onDelete,
  onStartMove,
  onStartMoveToWorkspace,
  onStartShare,
  onMove,
  favourites,
  favouriteIds,
  onToggleFavourite,
  onReloadTree,
  canManageWorkspaces,
  isInstanceAdmin,
  currentIcon,
  onLogout,
  displayName,
  userId,
}: SidebarProps): ReactElement {
  const { t } = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [renaming, setRenaming] = useState<string | null>(null);
  // One drag at a time, and every row has to know about it — so it belongs
  // here rather than in a row.
  const drag = useTreeDrag({
    canDrop: (draggedId, position) => {
      const moving = findNode(tree, draggedId);
      const row = findNode(tree, position.rowId);
      if (!moving || !row || moving.id === row.id) return false;
      // Reordering targets the parent the entry is usually already in, so it
      // must not be judged by the "already here" rule that governs a move.
      return position.intent === 'into'
        ? canMoveInto(tree, moving, row.id)
        : canReorderInto(tree, moving, row.parentPageId);
    },
    onDrop: (draggedId, position) => {
      const moving = findNode(tree, draggedId);
      const row = findNode(tree, position.rowId);
      if (!moving || !row) return;

      if (position.intent === 'into') {
        onMove(draggedId, row.id);
        return;
      }

      // Beside a row means into that row's parent, positioned relative to it.
      // `before` needs the sibling that precedes the row, and null when there
      // is none — which the API reads as "first".
      const siblings = siblingsOf(tree, row.parentPageId).filter(
        (sibling) => sibling.id !== draggedId,
      );
      const at = siblings.findIndex((sibling) => sibling.id === row.id);
      const after =
        position.intent === 'after' ? row.id : (siblings[at - 1]?.id ?? null);
      onMove(draggedId, row.parentPageId, after);
    },
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Private browsing with storage disabled. Losing the preference is
      // acceptable; failing to render is not.
    }
  }, [collapsed]);

  const toggle = useCallback((pageId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  // A collapsed branch must still reveal the page being viewed, or opening a
  // subpage from a search result leaves the sidebar showing nothing about it.
  useEffect(() => {
    if (!currentPageId) return;
    const ancestors = findAncestors(tree, currentPageId);
    if (ancestors.length === 0) return;
    setCollapsed((previous) => {
      if (!ancestors.some((id) => previous.has(id))) return previous;
      const next = new Set(previous);
      for (const id of ancestors) next.delete(id);
      return next;
    });
  }, [currentPageId, tree]);

  return (
    <>
      {open && (
        <button className="scrim" aria-label={t('sidebar.close')} onClick={onClose} type="button" />
      )}
      <nav className={`sidebar${open ? ' open' : ''}`} aria-label={t('sidebar.label')}>
        <div className="sidebar-head">
          <WorkspaceMenu
          canManageWorkspaces={canManageWorkspaces}
          currentIcon={currentIcon}
            currentId={workspaceId}
            currentName={workspaceName}
            onSwitch={onSwitchWorkspace}
            onCreated={onSwitchWorkspace}
          />
          <div className="sidebar-head-actions">
            {/* The collapse control belongs here, at the top of the thing it
                collapses. "New folder" used to sit here and was in the wrong
                place twice over: it is not a navigation action, and it is only
                ever wanted while looking at the tree — so it lives at the
                bottom of the tree instead. */}
            <button
              className="quiet drawer-close"
              type="button"
              onClick={onClose}
              title={t('sidebar.hide')}
              aria-label={t('sidebar.hide')}
            >
              <SidebarIcon />
            </button>
          </div>
        </div>

        <a className="sidebar-search" href={paths.search()}>
          <SearchIcon /> {t('sidebar.search')}
        </a>

        {/* Above the tree, because a shortcut list is only useful if it is the
            first thing in reach. Hidden entirely when empty rather than shown
            as an empty heading, which would take space to say nothing. */}
        {favourites.length > 0 && (
          <div className="sidebar-section">
            <p className="sidebar-label">{t('sidebar.favourites')}</p>
            {favourites.map((entry) => (
              <div className="tree-row" data-kind={entry.kind} key={entry.pageId}>
                <span className="tree-twisty" data-placeholder="true" aria-hidden="true" />
                <a
                  className="tree-link"
                  // Links are draggable by default; the browser's own drag
                  // would cancel this app's gesture before it started.
                  draggable={false}
                  href={paths.page(entry.pageId, entry.title)}
                  {...(entry.pageId === currentPageId
                    ? { 'aria-current': 'page' as const }
                    : {})}
                >
                  {/* Favourites carry no icon in their own shape, so they keep
                      the default one. Reaching for the tree node here would
                      make the favourites list depend on the tree being loaded,
                      which it deliberately does not. */}
                  {entry.kind === 'folder' ? <FolderIcon /> : <PageIcon />}{' '}
                  {entry.title || 'Untitled'}
                </a>
                <button
                  className="entry-more"
                  type="button"
                  aria-label={`Remove ${entry.title || 'Untitled'} from favourites`}
                  onClick={() => onToggleFavourite(entry.pageId, false)}
                >
                  <StarIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        {tree.length === 0 ? (
          <p className="muted" style={{ padding: '8px' }}>
            {t('sidebar.empty')}
          </p>
        ) : (
          <TreeLevel
            nodes={tree}
            currentPageId={currentPageId}
            collapsed={collapsed}
            renaming={renaming}
            onToggle={toggle}
            onCreatePage={onCreatePage}
            onRename={(pageId, title) => {
              setRenaming(null);
              onRename(pageId, title);
            }}
            onCancelRename={() => setRenaming(null)}
            onStartRename={setRenaming}
            onDelete={onDelete}
            onStartMove={onStartMove}
            onStartMoveToWorkspace={onStartMoveToWorkspace}
            onStartShare={onStartShare}
            favouriteIds={favouriteIds}
            onToggleFavourite={onToggleFavourite}
            onReloadTree={onReloadTree}
            tree={tree}
            onMove={onMove}
            drag={drag}
          />
        )}

        {/* At the bottom of the tree, where the thing it adds to ends.
          *
          * Both kinds of container, side by side. A canvas was reachable only
          * through a folder's ⋮ menu, so somebody with no folders — or somebody
          * looking at a page — could not find one at all. A thing you can create
          * has to be offered where creating happens, and this is where. */}
        <div className="tree-new">
          <button
            className="tree-new-folder"
            type="button"
            onClick={() => onCreatePage(null, 'folder')}
          >
            <FolderPlusIcon /> {t('sidebar.newFolder')}
          </button>
          <button
            className="tree-new-folder"
            type="button"
            onClick={() => onCreatePage(null, 'canvas')}
          >
            <PenIcon /> {t('canvas.new')}
          </button>
        </div>

        {/* The face, and the menu behind it (AccountMenu).
          *
          * Lifted out of this file so the settings columns can carry the same
          * one: it was only here, so getting from the administration area to
          * your own profile meant leaving the settings and coming back in. */}
        <AccountMenu
          displayName={displayName}
          userId={userId}
          canAdminister={isInstanceAdmin || canManageWorkspaces}
          onLogout={onLogout}
        />
      </nav>

      {/* The entry under the pointer.
       *
       * The indicator lines say where a drop lands; they do not say what is
       * travelling. HTML5 dragging drew this for free, and losing it made the
       * gesture harder to read — which is exactly what was reported. Rendered
       * once here rather than per row, since only one entry moves at a time,
       * and outside the nav so the sidebar's own scrolling cannot clip it. */}
      {drag.dragging && drag.pointer && (
        <div
          className="drag-preview"
          style={{ left: drag.pointer.x, top: drag.pointer.y }}
          aria-hidden="true"
        >
          {findNode(tree, drag.dragging)?.kind === 'folder' ? <FolderIcon /> : <PageIcon />}
          {findNode(tree, drag.dragging)?.title || 'Untitled'}
        </div>
      )}
    </>
  );
}

function TreeLevel({
  nodes,
  currentPageId,
  collapsed,
  renaming,
  onToggle,
  onCreatePage,
  onRename,
  onCancelRename,
  onStartRename,
  onDelete,
  onStartMove,
  onStartMoveToWorkspace,
  onStartShare,
  favouriteIds,
  onToggleFavourite,
  onReloadTree,
  tree,
  onMove,
  drag,
}: {
  nodes: PageNode[];
  currentPageId: string | null;
  collapsed: Set<string>;
  renaming: string | null;
  onToggle: (pageId: string) => void;
  onCreatePage: (parentPageId: string | null, kind: 'page' | 'folder' | 'canvas') => void;
  onRename: (pageId: string, title: string) => void;
  onCancelRename: () => void;
  onStartRename: (pageId: string) => void;
  onDelete: (pageId: string, descendants: number) => void;
  onStartMove: (pageId: string) => void;
  /** Moving out of this workspace entirely (ADR-0038). Its own dialog. */
  onStartMoveToWorkspace: (pageId: string) => void;
  onStartShare: (pageId: string) => void;
  favouriteIds: Set<string>;
  onToggleFavourite: (pageId: string, favourite: boolean) => void;
  /** Reloads the tree after an entry's icon or colour changed. */
  onReloadTree: () => void;
  /** Whether to offer the way into the workspace administration. */
  /** The whole tree, for validating a drop against the subtree rule. */
  tree: PageNode[];
  onMove: (
    pageId: string,
    parentPageId: string | null,
    afterPageId?: string | null,
  ) => void;
  drag: TreeDrag;
}): ReactElement {
  const { t } = useT();
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.id);
        const isFolder = node.kind === 'folder';
        const title = node.title || (isFolder ? 'Untitled folder' : 'Untitled');

        return (
          <div key={node.id} className="tree-node">
            <div
              className="tree-row"
              data-kind={node.kind}
              // Dragging works with a finger as well as a mouse; see
              // hooks/useTreeDrag.ts for how a drag is told from a scroll.
              data-tree-row={node.id}
              data-tree-kind={node.kind}
              // Needed to tell a gap between siblings — which has one meaning
              // — from a gap at a nesting boundary, which has two.
              data-tree-parent={node.parentPageId ?? 'root'}
              onPointerDown={drag.onPointerDown}
              data-drop={
                drag.target?.rowId === node.id && drag.dragging
                  ? drag.target.intent
                  : undefined
              }
              data-dragging={drag.dragging === node.id ? 'true' : undefined}
            >
              <button
                className="tree-twisty"
                type="button"
                // Rendered even without children, invisibly, so page titles line
                // up whether or not a page has subpages. Titles that shift as
                // children appear are worse than a little unused space.
                data-placeholder={hasChildren ? 'false' : 'true'}
                {...(hasChildren
                  ? {
                      'aria-expanded': !isCollapsed,
                      'aria-label': `${isCollapsed ? 'Expand' : 'Collapse'} ${title}`,
                    }
                  : { 'aria-hidden': true })}
                tabIndex={hasChildren ? 0 : -1}
                onClick={() => {
                  if (hasChildren) onToggle(node.id);
                }}
              >
                <ChevronRightIcon />
              </button>

              {node.id === renaming ? (
                <RenameField
                  initial={node.title}
                  onCommit={(next) => onRename(node.id, next)}
                  onCancel={onCancelRename}
                />
              ) : (
                // Both kinds navigate. A folder opens an overview of what is
                // inside it; expanding stays on the disclosure triangle, which
                // already exists and is the control people expect for it. Using
                // the name to expand wasted the gesture people reach for most
                // and left a folder with nothing to open.
                <a
                  className="tree-link"
                  // Links are draggable by default; the browser's own drag
                  // would cancel this app's gesture before it started.
                  draggable={false}
                  href={paths.page(node.id, node.title)}
                  {...(node.id === currentPageId ? { 'aria-current': 'page' as const } : {})}
                >
                  <EntryIconView icon={node.icon} kind={isFolder ? 'folder' : 'page'} />{' '}
                  <span style={titleColorStyle(node.icon)}>{title}</span>
                </a>
              )}

              {node.id !== renaming && (
                <>
                  {/* Only a folder offers "new inside this". A page contains
                      nothing (ADR-0019), so offering it there would produce a
                      refusal the person could not have predicted. */}
                  {isFolder && (
                    <button
                      className="tree-add"
                      type="button"
                      onClick={() => onCreatePage(node.id, 'page')}
                      title={t('sidebar.newPageIn', { title })}
                      aria-label={t('sidebar.newPageIn', { title })}
                    >
                      <PlusIcon />
                    </button>
                  )}
                  <EntryMenu
                    node={node}
                    onChanged={onReloadTree}
                    onRename={onRename}
                    onCreate={onCreatePage}
                    onDelete={onDelete}
                    onStartRename={onStartRename}
                    onStartMove={onStartMove}
            onStartMoveToWorkspace={onStartMoveToWorkspace}
                    onStartShare={onStartShare}
                    onReorder={(id, direction) => {
                      const target = stepTarget(tree, id, direction);
                      if (target === undefined) return;
                      onMove(id, node.parentPageId, target);
                    }}
                    canMoveUp={canStep(tree, node.id, 'up')}
                    canMoveDown={canStep(tree, node.id, 'down')}
                    isFavourite={favouriteIds.has(node.id)}
                    onToggleFavourite={onToggleFavourite}
                  />
                </>
              )}
            </div>

            {hasChildren && !isCollapsed && (
              // Children are nested in the markup rather than flattened with a
              // margin per depth, so a guide line can be drawn down the branch.
              // Depth-as-margin gave no element spanning a level, which is why
              // the tree read as a flat list of differently indented rows.
              <div className="tree-children">
                <TreeLevel
                  nodes={node.children}
                  currentPageId={currentPageId}
                  collapsed={collapsed}
                  renaming={renaming}
                  onToggle={onToggle}
                  onCreatePage={onCreatePage}
                  onRename={onRename}
                  onCancelRename={onCancelRename}
                  onStartRename={onStartRename}
                  onDelete={onDelete}
                  onStartMove={onStartMove}
            onStartMoveToWorkspace={onStartMoveToWorkspace}
                  onStartShare={onStartShare}
                  favouriteIds={favouriteIds}
                  onToggleFavourite={onToggleFavourite}
                  onReloadTree={onReloadTree}
                  tree={tree}
                  onMove={onMove}
                  drag={drag}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Inline rename field.
 *
 * Inline rather than a dialog: a dialog for one text field is heavier than the
 * change deserves, and the title is already on screen to edit.
 *
 * Enter commits, Escape cancels, and losing focus commits — because a rename
 * abandoned by clicking elsewhere is far more often "done" than "undo", and
 * discarding it would silently lose typing.
 */
function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}): ReactElement {
  const { t } = useT();
  const [value, setValue] = useState(initial);
  const committed = useRef(false);

  const commit = (): void => {
    if (committed.current) return;
    committed.current = true;
    const next = value.trim();
    // An empty title is allowed — untitled is a real state — but a rename that
    // changes nothing should not write a document update.
    if (next === initial) onCancel();
    else onCommit(next);
  };

  return (
    <input
      className="tree-rename"
      value={value}
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          committed.current = true;
          onCancel();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
      aria-label={t('sidebar.rename')}
    />
  );
}

/**
 * Ids of every ancestor of a page, outermost first.
 *
 * Used to reveal a page a collapsed branch would otherwise hide. Exported
 * because "opening a subpage from search leaves the sidebar showing nothing
 * about it" is a behaviour worth pinning down in a test.
 */
export function findAncestors(nodes: PageNode[], pageId: string): string[] {
  const walk = (list: PageNode[], trail: string[]): string[] | null => {
    for (const node of list) {
      if (node.id === pageId) return trail;
      const found = walk(node.children, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}
