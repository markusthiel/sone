/**
 * SONE web — page tree sidebar.
 *
 * A drawer on narrow screens and a column on wide ones, from the same markup.
 * The "new subpage" button is always rendered, never hover-revealed: a control
 * that appears on :hover does not exist on a phone (ADR-0016).
 */

import type { ReactElement } from 'react';
import type { PageNode } from '../api/client.ts';
import { paths } from '../routes/paths.ts';

interface SidebarProps {
  workspaceName: string;
  tree: PageNode[];
  currentPageId: string | null;
  open: boolean;
  onClose: () => void;
  onCreatePage: (parentPageId: string | null) => void;
  onLogout: () => void;
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
  return (
    <>
      {open && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={onClose}
          type="button"
        />
      )}
      <nav
        className={`sidebar${open ? ' open' : ''}`}
        aria-label="Pages"
      >
        <div className="sidebar-head">
          <span className="workspace-name" title={workspaceName}>
            {workspaceName}
          </span>
          <button
            className="quiet"
            type="button"
            onClick={() => onCreatePage(null)}
            title="New page"
            aria-label="New page"
          >
            +
          </button>
        </div>

        <a className="tree-link" href={paths.search()}>
          Search
        </a>

        {tree.length === 0 ? (
          <p className="muted" style={{ padding: '8px' }}>
            No pages yet.
          </p>
        ) : (
          <TreeLevel
            nodes={tree}
            currentPageId={currentPageId}
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
        </div>
      </nav>
    </>
  );
}

function TreeLevel({
  nodes,
  currentPageId,
  onCreatePage,
}: {
  nodes: PageNode[];
  currentPageId: string | null;
  onCreatePage: (parentPageId: string | null) => void;
}): ReactElement {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.id}>
          <div
            className="tree-row"
            style={{ marginInlineStart: `${node.depth * 12}px` }}
          >
            <a
              className="tree-link"
              href={paths.page(node.id, node.title)}
              {...(node.id === currentPageId ? { 'aria-current': 'page' as const } : {})}
            >
              {node.icon?.kind === 'emoji' ? `${node.icon.value} ` : ''}
              {node.title || 'Untitled'}
            </a>
            <button
              className="tree-add"
              type="button"
              onClick={() => onCreatePage(node.id)}
              title={`New page inside ${node.title || 'Untitled'}`}
              aria-label={`New page inside ${node.title || 'Untitled'}`}
            >
              +
            </button>
          </div>
          {node.children.length > 0 && (
            <TreeLevel
              nodes={node.children}
              currentPageId={currentPageId}
              onCreatePage={onCreatePage}
            />
          )}
        </div>
      ))}
    </>
  );
}
