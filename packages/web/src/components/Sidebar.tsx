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

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import type { PageNode } from '../api/client.ts';
import { WEB_VERSION } from '../buildInfo.ts';
import { paths } from '../routes/paths.ts';

interface SidebarProps {
  workspaceName: string;
  tree: PageNode[];
  currentPageId: string | null;
  open: boolean;
  onClose: () => void;
  onCreatePage: (parentPageId: string | null, kind: 'page' | 'folder') => void;
  onLogout: () => void;
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
  workspaceName,
  tree,
  currentPageId,
  open,
  onClose,
  onCreatePage,
  onLogout,
}: SidebarProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

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
        <button className="scrim" aria-label="Close navigation" onClick={onClose} type="button" />
      )}
      <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Pages">
        <div className="sidebar-head">
          <span className="workspace-name" title={workspaceName}>
            {workspaceName}
          </span>
          <div className="sidebar-head-actions">
            <button
              className="quiet"
              type="button"
              onClick={() => onCreatePage(null, 'folder')}
              title="New folder"
              aria-label="New folder"
            >
              ⊞
            </button>
            <button
              className="quiet"
              type="button"
              onClick={() => onCreatePage(null, 'page')}
              title="New page"
              aria-label="New page"
            >
              +
            </button>
          </div>
        </div>

        <a className="sidebar-search" href={paths.search()}>
          <span aria-hidden="true">⌕</span> Search
        </a>

        {tree.length === 0 ? (
          <p className="muted" style={{ padding: '8px' }}>
            No pages yet.
          </p>
        ) : (
          <TreeLevel
            nodes={tree}
            currentPageId={currentPageId}
            collapsed={collapsed}
            onToggle={toggle}
            onCreatePage={onCreatePage}
          />
        )}

        <div style={{ marginBlockStart: 'auto', paddingBlockStart: 12 }}>
          <a className="tree-link" href={paths.settings()}>
            Settings
          </a>
          <button className="quiet" type="button" onClick={onLogout}>
            Sign out
          </button>
          <a className="sidebar-version" href={paths.settings('about')}>
            {WEB_VERSION}
          </a>
        </div>
      </nav>
    </>
  );
}

function TreeLevel({
  nodes,
  currentPageId,
  collapsed,
  onToggle,
  onCreatePage,
}: {
  nodes: PageNode[];
  currentPageId: string | null;
  collapsed: Set<string>;
  onToggle: (pageId: string) => void;
  onCreatePage: (parentPageId: string | null, kind: 'page' | 'folder') => void;
}): ReactElement {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.id);
        const isFolder = node.kind === 'folder';
        const title = node.title || (isFolder ? 'Untitled folder' : 'Untitled');

        return (
          <div key={node.id}>
            <div
              className="tree-row"
              data-kind={node.kind}
              style={{ marginInlineStart: `${node.depth * 12}px` }}
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
                ▶
              </button>

              {isFolder ? (
                // A folder has no document to open, so clicking its name
                // expands it rather than navigating to an empty page. That is
                // the whole difference between a folder and a page.
                <button
                  className="tree-link tree-folder"
                  type="button"
                  onClick={() => hasChildren && onToggle(node.id)}
                >
                  <span aria-hidden="true">{node.icon?.kind === 'emoji' ? node.icon.value : '📁'}</span>{' '}
                  {title}
                </button>
              ) : (
                <a
                  className="tree-link"
                  href={paths.page(node.id, node.title)}
                  {...(node.id === currentPageId ? { 'aria-current': 'page' as const } : {})}
                >
                  {node.icon?.kind === 'emoji' ? `${node.icon.value} ` : ''}
                  {title}
                </a>
              )}

              {/* Only a folder offers "new inside this". A page contains
                  nothing (ADR-0019), so offering it there would produce a
                  refusal the person could not have predicted. */}
              {isFolder && (
                <>
                  <button
                    className="tree-add"
                    type="button"
                    onClick={() => onCreatePage(node.id, 'folder')}
                    title={`New folder inside ${title}`}
                    aria-label={`New folder inside ${title}`}
                  >
                    ⊞
                  </button>
                  <button
                    className="tree-add"
                    type="button"
                    onClick={() => onCreatePage(node.id, 'page')}
                    title={`New page inside ${title}`}
                    aria-label={`New page inside ${title}`}
                  >
                    +
                  </button>
                </>
              )}
            </div>

            {hasChildren && !isCollapsed && (
              <TreeLevel
                nodes={node.children}
                currentPageId={currentPageId}
                collapsed={collapsed}
                onToggle={onToggle}
                onCreatePage={onCreatePage}
              />
            )}
          </div>
        );
      })}
    </>
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
