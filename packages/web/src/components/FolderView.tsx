/**
 * SONE web — the folder view.
 *
 * What the content area shows when a folder is selected. Craft does this and it
 * is the better arrangement: a folder is a place, and opening a place should
 * show you what is in it. Using a click on the name to expand a tree row
 * instead wastes the one gesture people reach for most, and leaves a folder
 * with nothing to open.
 *
 * Expanding and collapsing stays on the disclosure triangle, which already
 * exists and is the control people expect for it.
 */

import { useState, type ReactElement } from 'react';

import { ApiError, api, type PageNode } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { CollectionTable } from './CollectionTable.tsx';
import {
  FolderIcon,
  FolderPlusIcon,
  PageIcon,
  PlusIcon,
  TableIcon,
} from './icons.tsx';

interface FolderViewProps {
  /** Called after the folder becomes a collection, so the tree picks it up. */
  onChanged: () => void;
  folder: PageNode;
  /** Ancestor folders, outermost first, for the breadcrumb. */
  trail: PageNode[];
  onCreate: (parentPageId: string, kind: 'page' | 'folder') => void;
  onRename: (pageId: string, title: string) => void;
}

export function FolderView({
  folder,
  trail,
  onCreate,
  onRename,
  onChanged,
}: FolderViewProps): ReactElement {
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folders = folder.children.filter((child) => child.kind === 'folder');
  const pages = folder.children.filter((child) => child.kind === 'page');

  // Known from the tree, so no extra request is needed to decide which view
  // this is. The projection sets it when the document carries a collection.
  const isCollection = folder.collectionId !== null;

  return (
    <div className="page-body folder-view">
      {trail.length > 0 && (
        <nav className="breadcrumb" aria-label="Location">
          {trail.map((ancestor) => (
            <span key={ancestor.id}>
              <a href={paths.page(ancestor.id, ancestor.title)}>
                {ancestor.title || 'Untitled folder'}
              </a>
              <span aria-hidden="true"> / </span>
            </span>
          ))}
        </nav>
      )}

      {renaming ? (
        <input
          className="page-title"
          defaultValue={folder.title}
          autoFocus
          onBlur={(event) => {
            setRenaming(false);
            const next = event.currentTarget.value.trim();
            if (next !== folder.title) onRename(folder.id, next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            else if (event.key === 'Escape') setRenaming(false);
          }}
          aria-label="Folder name"
        />
      ) : (
        // A button, not an input: a folder name is not edited by accident, and
        // a click here is far more often "I want to see inside" than "I want to
        // rename". Renaming is one deliberate click away.
        <button className="folder-title" type="button" onClick={() => setRenaming(true)}>
          <FolderIcon /> {folder.title || 'Untitled folder'}
        </button>
      )}

      {error && <p className="error">{messageFor(error)}</p>}

      {isCollection ? (
        // A collection is still a folder, so it keeps the breadcrumb and the
        // title above. What changes is that its contents are a table rather
        // than two lists.
        <CollectionTable
          pageId={folder.id}
          onCreateRow={() => onCreate(folder.id, 'page')}
        />
      ) : (
        <>
          <div className="folder-actions">
            <button
              type="button"
              className="btn"
              onClick={() => onCreate(folder.id, 'page')}
            >
              <PlusIcon /> New page
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onCreate(folder.id, 'folder')}
            >
              <FolderPlusIcon /> New folder
            </button>
            {/* Turning a folder into a collection adds columns to what is
                already there; it does not move or convert anything. Nothing is
                lost by trying it, which is why it needs no confirmation. */}
            <button
              type="button"
              className="btn"
              onClick={() => {
                void api
                  .createCollection(folder.id)
                  .then(() => onChanged())
                  .catch((err: unknown) =>
                    setError(err instanceof ApiError ? err.code : 'network_error'),
                  );
              }}
            >
              <TableIcon /> Add columns
            </button>
          </div>

          {folder.children.length === 0 ? (
            <p className="muted folder-empty">
              This folder is empty. Add a page to start writing, or a folder to
              keep organising, or add columns to track something across them.
            </p>
          ) : (
            <>
          {/* Folders before pages, matching the sidebar. A filing system that
              orders one way in one place and another way elsewhere makes people
              hunt. */}
          {folders.length > 0 && (
            <section>
              <h2 className="folder-section">Folders</h2>
              <ul className="folder-list">
                {folders.map((child) => (
                  <li key={child.id}>
                    <a href={paths.page(child.id, child.title)}>
                      <FolderIcon />
                      <span className="folder-list-name">
                        {child.title || 'Untitled folder'}
                      </span>
                      <span className="folder-list-meta">
                        {describeContents(child)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pages.length > 0 && (
            <section>
              <h2 className="folder-section">Pages</h2>
              <ul className="folder-list">
                {pages.map((child) => (
                  <li key={child.id}>
                    <a href={paths.page(child.id, child.title)}>
                      <PageIcon />
                      <span className="folder-list-name">
                        {child.title || 'Untitled'}
                      </span>
                      <span className="folder-list-meta">
                        {formatEdited(child.lastEditedAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** "3 pages · 1 folder", or "Empty". Says whether it is worth opening. */
function describeContents(folder: PageNode): string {
  const pages = folder.children.filter((child) => child.kind === 'page').length;
  const folders = folder.children.filter((child) => child.kind === 'folder').length;
  const parts: string[] = [];
  if (pages > 0) parts.push(`${pages} ${pages === 1 ? 'page' : 'pages'}`);
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`);
  return parts.length > 0 ? parts.join(' · ') : 'Empty';
}

/**
 * Relative for recent edits, absolute beyond a week.
 *
 * "3 days ago" is what someone wants for something they touched recently, and
 * useless for something from March.
 */
function formatEdited(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
