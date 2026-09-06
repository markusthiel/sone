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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { FavouriteEntry, PageNode } from '../api/client.ts';
import { useSidebarWidth } from '../hooks/useSidebarWidth.ts';
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
import { usePageLink } from '../routes/pageLink.tsx';
import { EntryMenu } from './EntryMenu.tsx';
import { AddEntryMenu } from './AddEntryMenu.tsx';
import { mayEdit, mayManage } from '../entryRights.ts';
import type { Mode } from './modes.tsx';
import { WorkspaceMenu } from './WorkspaceMenu.tsx';
import { EntryIconView, titleColorStyle } from './EntryIconView.tsx';
import type { WorkspaceIcon } from '../api/client.ts';
import {
  LockIcon,
  ChevronRightIcon,
  FolderIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
  StarIcon,
  TrashIcon,
} from './icons.tsx';

interface SidebarProps {
  /**
   * Which mode the shell is in (ADR-0069).
   *
   * 'tree' draws the workspace switcher as the head and the page tree as the
   * body. Every other mode gets a title and whatever menu it passed as
   * children — the column's job is the same either way: it navigates.
   */
  mode: Mode;
  /** The mode's name. Unused in the tree's mode, where the switcher is it. */
  panelTitle?: ReactNode | undefined;
  /** What the mode is looking at — a workspace, or how long the trash keeps. */
  panelScope?: string | undefined;
  /*
   * A control belonging to the head rather than to the body (ADR-0070).
   *
   * The Workspaces mode's chooser is the one: it has to be outside the body,
   * because the body scrolls and a menu dropping out of a scrolling box is
   * clipped at its edge. Which is the same reason the tree's switcher is the
   * head and not the first row of the tree.
   */
  panelChooser?: ReactNode | undefined;
  /** One action belonging to the whole mode, never to a row inside it. */
  panelAction?: ReactNode | undefined;
  /** The mode's menu. Ignored in the tree's mode. */
  children?: ReactNode | undefined;
  /**
   * What is in the search field above the tree, and what to do when it changes
   * (ADR-0118).
   *
   * Held by the shell rather than here, because the query lives in the URL: a
   * search is a place, it is shareable, and the panel of the search mode edits
   * the same string. Two copies of it would be two answers to what is being
   * searched for.
   */
  searchQuery: string;
  onSearch: (query: string, options?: { commit?: boolean }) => void;
  workspaceId: string;
  workspaceName: string;
  onSwitchWorkspace: (workspaceId: string) => void;
  tree: PageNode[];
  currentPageId: string | null;
  open: boolean;
  onClose: () => void;
  onCreatePage: (
    parentPageId: string | null,
    kind: 'page' | 'folder' | 'canvas',
    templateId?: string,
  ) => void;
  onRename: (pageId: string, title: string) => void;
  onDelete: (pageId: string, descendants: number) => void;
  onStartMove: (pageId: string) => void;
  /** Moving out of this workspace entirely (ADR-0038). Its own dialog. */
  onStartMoveToWorkspace: (pageId: string) => void;
  onStartExport: (pageId: string) => void;
  onStartImport: (pageId: string) => void;
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
  /** Which entries are watched, and how to change that (ADR-0064). */
  watchedIds?: Set<string>;
  onToggleWatch?: (pageId: string, watching: boolean) => void;
  /** Reloads the tree after an entry's icon or colour changed. */
  onReloadTree: () => void;
  /*
   * Neither right is asked for here any more (ADR-0070).
   *
   * They were passed down so the switcher could offer a way into the
   * administration; the switcher answers "which workspace" and nothing else
   * now, so both props were being threaded through two components to reach
   * code that had been deleted.
   */
  /** The mark for the workspace you are in (ADR-0030). */
  currentIcon: WorkspaceIcon | null;
  /*
   * No account here any more (ADR-0074).
   *
   * The face used to be at this foot below the breakpoint, because the rail is
   * not drawn there. The mode bar is, and it carries the account like the rail
   * does — so the three props that fed it were being threaded through the
   * sidebar to reach a component it no longer draws.
   */
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


/**
 * A heading that folds what is under it.
 *
 * The heading itself is the control, which is what makes both sections behave
 * the same: a caret beside a label somebody has to hit precisely is a control
 * that only works with a mouse.
 *
 * The count when folded, because a section that says only "Favourites" with
 * nothing under it looks like an empty section rather than a closed one.
 */
function SidebarSection({
  label,
  open,
  count,
  onToggle,
  onAdd,
  addLabel,
  children,
}: {
  label: string;
  open: boolean;
  count: number;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="sidebar-section" data-open={open}>
      <div className="sidebar-section-head">
        <button
          type="button"
          className="sidebar-section-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <ChevronRightIcon />
          <span className="sidebar-label">{label}</span>
          {!open && count > 0 && <span className="sidebar-section-count">{count}</span>}
        </button>

        {/* Always drawn, never on hover: a control that appears when a pointer
            is near it does not exist on a phone, and this is the way to make a
            folder now that the button at the foot of the tree is gone. */}
        {onAdd && addLabel && (
          <button
            type="button"
            className="sidebar-section-add"
            aria-label={addLabel}
            title={addLabel}
            onClick={onAdd}
          >
            <PlusIcon />
          </button>
        )}
      </div>

      {open && children}
    </div>
  );
}

/** Shared empty set, so a default is not a new object each render. */
const NOTHING_WATCHED: Set<string> = new Set();

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
  onStartExport,
  onStartImport,
  onStartShare,
  onMove,
  favourites,
  favouriteIds,
  onToggleFavourite,
  // Defaulted here so everything below sees a Set rather than a maybe — and to
  // a module constant rather than `new Set()`, which would be a fresh object
  // every render and defeat any memo comparing it.
  watchedIds = NOTHING_WATCHED,
  // Defaulted to a no-op for the same reason: the tree below wants a function,
  // not a maybe, and a sidebar rendered without watching (a share link, say)
  // should draw no bell rather than crash on a click that cannot happen.
  onToggleWatch = () => {},
  onReloadTree,
  currentIcon,
  mode,
  panelTitle,
  panelScope,
  panelChooser,
  panelAction,
  children,
  searchQuery,
  onSearch,
}: SidebarProps): ReactElement {
  const pageLink = usePageLink();
  const { t } = useT();

  /**
   * Which sections are open, remembered per browser.
   *
   * A fold somebody set is an instruction, and a reload undoing it is the
   * application forgetting one — the same argument the comment folds make
   * (ADR-0046). Not on the account, because a sidebar on a phone is not a
   * sidebar at a desk.
   */
  // How wide this is, remembered locally: a preference about this screen rather
  // than a fact about the account (see useSidebarWidth).
  const { startResize, reset: resetWidth } = useSidebarWidth();

  const [sectionsOpen, setSectionsOpen] = useState<{ favourites: boolean; folders: boolean }>(
    () => {
      try {
        const stored: unknown = JSON.parse(localStorage.getItem('sone.sidebarSections') ?? '{}');
        const value = (stored ?? {}) as Record<string, unknown>;
        return {
          // Open unless somebody closed it: a sidebar that starts folded hides
          // the thing it exists to show.
          favourites: value['favourites'] !== false,
          folders: value['folders'] !== false,
        };
      } catch {
        return { favourites: true, folders: true };
      }
    },
  );
  const toggleSection = (which: 'favourites' | 'folders'): void => {
    setSectionsOpen((current) => {
      const next = { ...current, [which]: !current[which] };
      try {
        localStorage.setItem('sone.sidebarSections', JSON.stringify(next));
      } catch {
        // Folded for this session and not remembered, which beats refusing.
      }
      return next;
    });
  };
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
      <nav
        className={`sidebar${open ? ' open' : ''}`}
        aria-label={t('sidebar.label')}
        /*
         * The same for this side, which has had the fault longer.
         *
         * On a narrow screen this stays in the DOM when closed so it can slide,
         * and it had neither `aria-hidden` nor `inert` — so a tab from the page
         * walked into an off-screen sidebar. Found while giving the right panel
         * its animation, which is the sort of thing symmetry turns up.
         */
        {...(open ? {} : { 'aria-hidden': true, inert: true })}
      >
        {/* The head names the mode and what it is looking at (ADR-0069).
          *
          * Not decoration: the rail mixes two scopes. An inbox spans workspaces
          * — ADR-0052 says its route carries none — and a trash belongs to
          * exactly one, so without a line saying which, the same column shows
          * two different worlds and looks identical doing it.
          *
          * In the tree's mode that head *is* the workspace switcher, which is
          * how the switcher stays where it always was and stops being a special
          * case: it is this column's title, like every other mode's. */}
        <div className="panel-head">
          <div className="sidebar-head">
            {mode === 'tree' ? (
              <WorkspaceMenu
                currentIcon={currentIcon}
                currentId={workspaceId}
                currentName={workspaceName}
                onSwitch={onSwitchWorkspace}
                onCreated={onSwitchWorkspace}
              />
            ) : (
              <div className="panel-title">{panelTitle}</div>
            )}
            <div className="sidebar-head-actions">
              {panelAction}
              {/* The collapse control belongs here, at the top of the thing it
                  collapses. "New folder" used to sit here and was in the wrong
                  place twice over: it is not a navigation action, and it is
                  only ever wanted while looking at the tree — so it lives at
                  the bottom of the tree instead. */}
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
          {panelScope !== undefined && <div className="panel-scope">{panelScope}</div>}
          {/* Its own positioning context: the switcher's menu is anchored to
              whatever is positioned above it, and without this it would be the
              sidebar — so the menu would drop from the foot of the column. */}
          {panelChooser !== undefined && (
            <div className="panel-chooser">{panelChooser}</div>
          )}
        </div>

        {/* The body navigates and never holds content (ADR-0069): the tree
          *  here, a menu of views in every other mode. */}
        <div className="panel-body">
          {mode === 'tree' ? (
            <>
        {/* A field, not a link to a field (ADR-0118).
          *
          * It was a labelled row that opened the search screen, where the
          * first thing anybody did was type — so the row was a door in front of
          * a door. Typing here navigates into the search mode carrying what has
          * been typed so far, which is the same landing the row produced with
          * one fewer step.
          *
          * `replace` while typing: a keystroke is not a place to go back to,
          * and pushing one per character would bury whatever came before the
          * search under forty entries.
          *
          * Still `type="search"`, so a browser offers its own clear button and
          * announces it as one. */}
        <div className="sidebar-search">
          <SearchIcon aria-hidden="true" />
          <input
            type="search"
            className="sidebar-search-field"
            value={searchQuery}
            placeholder={t('sidebar.search')}
            aria-label={t('sidebar.search')}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              // Enter is how somebody says "that one, now" — it commits the
              // search as a place in the history rather than another replace.
              if (event.key === 'Enter') onSearch(event.currentTarget.value, { commit: true });
            }}
          />
        </div>

        {/* Above the tree, because a shortcut list is only useful if it is the
            first thing in reach. Hidden entirely when empty rather than shown
            as an empty heading, which would take space to say nothing. */}
        {favourites.length > 0 && (
          <SidebarSection
            label={t('sidebar.favourites')}
            open={sectionsOpen.favourites}
            count={favourites.length}
            onToggle={() => toggleSection('favourites')}
          >
            {favourites.map((entry) => (
              <div className="tree-row" data-kind={entry.kind} key={entry.pageId}>
                <span className="tree-twisty" data-placeholder="true" aria-hidden="true" />
                <a
                  className="tree-link"
                  // Links are draggable by default; the browser's own drag
                  // would cancel this app's gesture before it started.
                  draggable={false}
                  href={pageLink(entry.pageId, entry.title)}
                  {...(entry.pageId === currentPageId
                    ? { 'aria-current': 'page' as const }
                    : {})}
                >
                  {/* Favourites carry no icon in their own shape, so they keep
                      the default one. Reaching for the tree node here would
                      make the favourites list depend on the tree being loaded,
                      which it deliberately does not. */}
                  {/* The same component the tree uses, and the entry's own
                      icon: this drew "folder or else a document", so a page
                      with a key on it in the tree was a blank document here and
                      a canvas was one too. */}
                  <EntryIconView icon={entry.icon} kind={entry.kind} />{' '}
                  <span style={titleColorStyle(entry.icon)}>
                    {entry.title || t('page.untitled')}
                  </span>
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
          </SidebarSection>
        )}

        {/* The tree, under a heading of its own.
          *
          * It had none: the folders simply began, so there was nothing to fold
          * and nothing to hang a `+` on. The heading is what makes both
          * sections behave alike, which is the point of the change. */}
        <SidebarSection
          label={t('sidebar.folders')}
          open={sectionsOpen.folders}
          count={tree.length}
          onToggle={() => toggleSection('folders')}
          onAdd={() => onCreatePage(null, 'folder')}
          addLabel={t('sidebar.newFolder')}
        >
          {tree.length === 0 ? (
            // The empty case matters more now that the large button at the foot
            // is gone: it says where to press rather than only that there is
            // nothing here.
            <p className="sidebar-empty muted">{t('sidebar.emptyFolders')}</p>
          ) : (
          <TreeLevel
            workspaceId={workspaceId}
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
            onStartExport={onStartExport}
            onStartImport={onStartImport}
            onStartShare={onStartShare}
            favouriteIds={favouriteIds}
            onToggleFavourite={onToggleFavourite}
            watchedIds={watchedIds}
            onToggleWatch={onToggleWatch}
            onReloadTree={onReloadTree}
            tree={tree}
            onMove={onMove}
            drag={drag}
          />
          )}
        </SidebarSection>
            </>
          ) : (
            children
          )}
        </div>

        {/* The edge, draggable (see useSidebarWidth).
          *
          * Because the tree's problem is space rather than text: a title like
          * "02.03.2026 - 09:05 - Notiz" needs about 200px of label, and three
          * levels of nesting inside 260px leave it 180. Every clever
          * alternative is worse — a middle ellipsis throws away the date, which
          * for date-prefixed titles is the half that matters, and wrapping
          * doubles the height of a list of thirty of them.
          *
          * A button rather than a bare div so it can be focused, and
          * double-click puts it back — which is what somebody will try. */}
        <button
          type="button"
          className="sidebar-resize"
          aria-label={t('sidebar.resize')}
          onMouseDown={startResize}
          onDoubleClick={resetWidth}
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
  onStartExport,
  onStartImport,
  onStartShare,
  favouriteIds,
  onToggleFavourite,
  watchedIds,
  onToggleWatch,
  onReloadTree,
  tree,
  onMove,
  drag,
  workspaceId,
}: {
  nodes: PageNode[];
  /** For the list of templates the `+` offers (ADR-0045). */
  workspaceId: string;
  currentPageId: string | null;
  collapsed: Set<string>;
  renaming: string | null;
  onToggle: (pageId: string) => void;
  onCreatePage: (
    parentPageId: string | null,
    kind: 'page' | 'folder' | 'canvas',
    templateId?: string,
  ) => void;
  onRename: (pageId: string, title: string) => void;
  onCancelRename: () => void;
  onStartRename: (pageId: string) => void;
  onDelete: (pageId: string, descendants: number) => void;
  onStartMove: (pageId: string) => void;
  /** Moving out of this workspace entirely (ADR-0038). Its own dialog. */
  onStartMoveToWorkspace: (pageId: string) => void;
  onStartExport: (pageId: string) => void;
  onStartImport: (pageId: string) => void;
  onStartShare: (pageId: string) => void;
  favouriteIds: Set<string>;
  onToggleFavourite: (pageId: string, favourite: boolean) => void;
  /** Which entries are watched, and how to change that (ADR-0064). */
  watchedIds: Set<string>;
  onToggleWatch: (pageId: string, watching: boolean) => void;
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
  const pageLink = usePageLink();
  const { t } = useT();
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.id);
        const isFolder = node.kind === 'folder';
        /*
         * A page that is here as a **path**, not as a page (ADR-0026).
         *
         * Somebody was granted something inside it and nothing here. It has to
         * appear or the granted child is reachable only by knowing its address
         * — and before this it did not, so a guest found the page they were
         * given floating at the top of the sidebar, outside the section it
         * actually lives in.
         *
         * What it must not do is offer anything. No link, because there is
         * nothing here they may open; no rename, no ⋮, no "new inside this",
         * no drag. And no title: the name was withheld on purpose, and sending
         * it "so the interface can hide it" would be sending it.
         */
        const isPath = node.pathOnly === true;
        /*
         * May they change this entry (ADR-0095)?
         *
         * A narrower version of the rule above it: a path row offers nothing
         * because there is nothing here they may do, and a row they may read
         * and not write offers everything about *reading* — the link, the
         * title, the icon, the twisty — and none of the verbs. Before the tree
         * carried a role there was nothing to ask, so a viewer got the rename
         * field, the "new inside this" menu and a drag gesture, all of which
         * the server refuses.
         */
        const canEdit = mayEdit(node);
        const title = node.title || (isFolder ? 'Untitled folder' : 'Untitled');

        return (
          // No class: nothing styles this wrapper and nothing reads it. A class
          // name that means nothing is a name somebody will later assume means
          // something.
          <div key={node.id}>
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
              data-path-only={isPath ? 'true' : undefined}
              // Not draggable: moving a page needs rights on it, and this is a
              // page somebody has none on. A gesture that can only be refused
              // is worse than one that is not offered.
              //
              // The same sentence covers a viewer, who has *some* rights and
              // not this one — which is why the condition is now the role
              // rather than the path flag (ADR-0095).
              {...(canEdit ? { onPointerDown: drag.onPointerDown } : {})}
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

              {isPath ? (
                // A word rather than an empty space: a nameless row with a
                // twisty beside it reads as a fault. This says what it is —
                // and says nothing about the page, which is the point.
                <span className="tree-link tree-path-only">{t('tree.pathOnly')}</span>
              ) : node.id === renaming && canEdit ? (
                <RenameField
                  initial={node.title ?? ''}
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
                  href={pageLink(node.id, node.title ?? undefined)}
                  {...(node.id === currentPageId ? { 'aria-current': 'page' as const } : {})}
                >
                  {/* The entry's own kind, not "folder or else page". A canvas
                      could not reach the icon at all through that, so every
                      board in the tree was drawn as a document. */}
                  <EntryIconView icon={node.icon} kind={node.kind} />{' '}
                  <span style={titleColorStyle(node.icon)}>{title}</span>
                  {/* Visible before somebody starts typing rather than after
                      (ADR-0049). Small and grey: a lock anybody who may edit can
                      lift must not read like a warning. */}
                  {node.locked === true && (
                    <LockIcon className="tree-locked" aria-label={t('entry.lockedShort')} />
                  )}
                </a>
              )}

              {node.id !== renaming && !isPath && (
                <>
                  {/* Only a folder offers "new inside this". A page contains
                      nothing (ADR-0019), so offering it there would produce a
                      refusal the person could not have predicted — and neither
                      does a folder somebody may only read, for exactly the same
                      reason (ADR-0095). */}
                  {isFolder && canEdit && (
                    <AddEntryMenu
                      title={title}
                      workspaceId={workspaceId}
                      onCreate={(kind, templateId) =>
                        onCreatePage(node.id, kind, templateId)
                      }
                    />
                  )}
                  <EntryMenu
                    node={node}
                    // What the menu may offer. Passed rather than read from the
                    // node inside, so there is one reading of the role per row
                    // and the menu cannot answer differently from the row it
                    // hangs off (ADR-0095).
                    canEdit={canEdit}
                    canManage={mayManage(node)}
                    onChanged={onReloadTree}
                    onRename={onRename}
                    onCreate={onCreatePage}
                    onDelete={onDelete}
                    onStartRename={onStartRename}
                    onStartMove={onStartMove}
            onStartMoveToWorkspace={onStartMoveToWorkspace}
            onStartExport={onStartExport}
            onStartImport={onStartImport}
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
                    isWatched={watchedIds.has(node.id)}
                    onToggleWatch={onToggleWatch}
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
                  workspaceId={workspaceId}
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
            onStartExport={onStartExport}
            onStartImport={onStartImport}
                  onStartShare={onStartShare}
                  favouriteIds={favouriteIds}
                  onToggleFavourite={onToggleFavourite}
                  watchedIds={watchedIds}
                  onToggleWatch={onToggleWatch}
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
