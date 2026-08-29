/**
 * SONE web — the right sidebar.
 *
 * Tabs over one panel: outline now, properties now, more later. The pattern is
 * the one AFFiNE uses and it holds up — a narrow column that changes what it
 * shows is far better than several competing panels, because only one of them
 * is ever wanted at a time.
 *
 * A column on wide screens and a drawer on narrow ones, from the same markup —
 * the same arrangement as the left sidebar, and with the same trap avoided: the
 * backdrop is positioned and hidden *outside* any media query. Styling it only
 * inside the narrow block once made it an unstyled button in the page grid,
 * which took a column of its own and destroyed the layout on desktop.
 *
 * Which tab is open, and whether the panel is open at all, are remembered per
 * browser. Reopening a panel on every navigation is the kind of small friction
 * that makes an app feel like it is not paying attention.
 */

import type { PageHandle } from '@sone/client';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type PageDetail } from '../api/client.ts';
import { useOutline, scrollToBlock } from '../hooks/useOutline.ts';
import { usePageTags } from '../hooks/usePageTags.ts';
import { useTasks, type Task } from '../hooks/useTasks.ts';
import { TagEditor } from './TagEditor.tsx';
import { messageFor } from './Auth.tsx';
import { ChevronRightIcon, PageIcon, TagIcon } from './icons.tsx';
import { Contributors } from './Contributors.tsx';
import { highlightAuthor } from './authorHighlightBridge.ts';

export const RIGHT_TABS = ['outline', 'tasks', 'people', 'properties'] as const;
export type RightTab = (typeof RIGHT_TABS)[number];

const TAB_LABELS: Record<RightTab, string> = {
  outline: 'Outline',
  tasks: 'Tasks',
  // "People" rather than "Contributors": shorter, and it does not imply a
  // ranking of who contributed most, which this list deliberately does not
  // measure.
  people: 'People',
  properties: 'Properties',
};

const OPEN_KEY = 'sone.rightPanel';
const TAB_KEY = 'sone.rightPanelTab';

export function readRightPanelOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function readTab(): RightTab {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    return (RIGHT_TABS as readonly string[]).includes(stored ?? '')
      ? (stored as RightTab)
      : 'outline';
  } catch {
    return 'outline';
  }
}

interface RightSidebarProps {
  handle: PageHandle | null;
  pageId: string | null;
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function RightSidebar({
  handle,
  pageId,
  workspaceId,
  open,
  onClose,
}: RightSidebarProps): ReactElement {
  const [tab, setTab] = useState<RightTab>(readTab);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Storage disabled. Losing the preference is acceptable.
    }
  }, [tab]);

  return (
    <>
      {open && (
        <button
          className="scrim scrim-right"
          type="button"
          aria-label="Close panel"
          onClick={onClose}
        />
      )}
      <aside
        className={`right-panel${open ? ' open' : ''}`}
        aria-label="Page panel"
        // Hidden from assistive technology when closed, or a screen reader
        // announces a panel that is not on screen.
        {...(open ? {} : { 'aria-hidden': true })}
      >
        <div className="right-tabs" role="tablist" aria-label="Panel">
          {RIGHT_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className="right-tab"
              onClick={() => setTab(name)}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </div>

        <div className="right-body" role="tabpanel">
          {tab === 'outline' && <OutlinePanel handle={handle} />}
          {tab === 'tasks' && <TasksPanel handle={handle} />}
          {/* Who has written here — not who is here now, which the circles at
              the top of the page show instead (ADR-0022). */}
          {tab === 'people' && (
            <Contributors
              handle={handle}
              workspaceId={workspaceId}
              onHighlight={highlightAuthor}
            />
          )}
          {tab === 'properties' && (
            <PropertiesPanel pageId={pageId} handle={handle} workspaceId={workspaceId} />
          )}
        </div>
      </aside>
    </>
  );
}

function OutlinePanel({ handle }: { handle: PageHandle | null }): ReactElement {
  const outline = useOutline(handle?.doc ?? null);

  if (!handle) {
    return <p className="panel-empty">Open a page to see its outline.</p>;
  }
  if (outline.length === 0) {
    // Says what to do rather than only that there is nothing, because an empty
    // outline on a page full of text looks like a fault.
    return (
      <p className="panel-empty">
        No headings yet. Type <code># </code> at the start of a line to make one.
      </p>
    );
  }

  // Indentation is relative to the shallowest heading present, so a document
  // that starts at level 2 is not drawn with a permanent empty first level.
  const shallowest = Math.min(...outline.map((entry) => entry.level));

  return (
    <nav className="outline" aria-label="Outline">
      {outline.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="outline-entry"
          style={{ paddingInlineStart: `${8 + (entry.level - shallowest) * 12}px` }}
          data-level={entry.level}
          onClick={() => scrollToBlock(entry.id)}
        >
          {entry.text || <span className="muted">Untitled heading</span>}
        </button>
      ))}
    </nav>
  );
}

function TasksPanel({ handle }: { handle: PageHandle | null }): ReactElement {
  const { tasks, toggle } = useTasks(handle?.doc ?? null);
  const canEdit = handle?.canEdit ?? false;

  if (!handle) {
    return <p className="panel-empty">Open a page to see its tasks.</p>;
  }
  if (tasks.length === 0) {
    return (
      <p className="panel-empty">
        No tasks yet. Type <code>[] </code> at the start of a line to make one.
      </p>
    );
  }

  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  return (
    <div className="tasks">
      {/* A count, because the useful question about a task list is how much is
          left rather than what is in it. */}
      <p className="tasks-summary">
        {open.length} of {tasks.length} open
      </p>

      {open.map((task) => (
        <TaskRow key={task.id} task={task} canEdit={canEdit} onToggle={toggle} />
      ))}

      {done.length > 0 && (
        <>
          {/* Completed tasks are kept, below, rather than hidden. Hiding them
              loses the record of what was done, and a list that empties itself
              gives no sense of progress. */}
          <p className="tasks-label">Done</p>
          {done.map((task) => (
            <TaskRow key={task.id} task={task} canEdit={canEdit} onToggle={toggle} />
          ))}
        </>
      )}
    </div>
  );
}

function TaskRow({
  task,
  canEdit,
  onToggle,
}: {
  task: Task;
  canEdit: boolean;
  onToggle: (taskId: string, done: boolean) => void;
}): ReactElement {
  return (
    <label
      className="task-row"
      data-done={task.done ? 'true' : 'false'}
      style={{ paddingInlineStart: `${8 + Math.min(task.indent, 4) * 14}px` }}
    >
      <input
        type="checkbox"
        checked={task.done}
        // Disabled rather than hidden for a reader: the state is information,
        // and removing the control while keeping the box would look broken.
        disabled={!canEdit}
        onChange={(event) => onToggle(task.id, event.target.checked)}
      />
      <span className="task-text">
        {task.text || <span className="muted">Untitled task</span>}
      </span>
      {/* Jumping to the block is what makes the panel a way of navigating rather
          than a second place to keep the same list. */}
      <button
        type="button"
        className="task-goto"
        aria-label="Go to this task"
        onClick={(event) => {
          event.preventDefault();
          scrollToBlock(task.id);
        }}
      >
        <ChevronRightIcon />
      </button>
    </label>
  );
}

function PropertiesPanel({
  pageId,
  handle,
  workspaceId,
}: {
  pageId: string | null;
  handle: PageHandle | null;
  workspaceId: string;
}): ReactElement {
  const { tags, known, setTags } = usePageTags(handle?.doc ?? null, pageId, workspaceId);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetched when the tab is shown rather than with the page: most of what is
  // here does not change while reading, and a request nobody looked at is
  // waste.
  useEffect(() => {
    if (!pageId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setError(null);
    void api
      .page(pageId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (!pageId) {
    return <p className="panel-empty">Open a page to see its properties.</p>;
  }
  if (error) {
    return <p className="error panel-empty">{messageFor(error)}</p>;
  }
  if (!detail) {
    return <p className="panel-empty muted">Loading…</p>;
  }

  const formatted = (value: string): string =>
    new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  return (
    <dl className="properties">
      <dt>
        <PageIcon /> Kind
      </dt>
      <dd>{detail.kind === 'folder' ? 'Folder' : 'Page'}</dd>

      <dt>Created</dt>
      <dd>{formatted(detail.createdAt)}</dd>

      <dt>Edited</dt>
      <dd>{formatted(detail.lastEditedAt)}</dd>

      <dt>Your access</dt>
      {/* From the page detail rather than from the handle: the handle's role is
          null while a document opens or reconnects, and reporting "none" for
          that moment is how the read-only notice came to lie to the owner of a
          workspace. */}
      <dd>{detail.role}</dd>

      <dt>Sync</dt>
      <dd>{handle ? describeStatus(handle) : 'not open'}</dd>

      <dt>
        <TagIcon /> Tags
      </dt>
      <dd>
        <TagEditor
          tags={tags}
          known={known}
          canEdit={handle?.canEdit ?? false}
          onChange={setTags}
        />
      </dd>
    </dl>
  );
}

function describeStatus(handle: PageHandle): string {
  switch (handle.status) {
    case 'synced':
      return 'up to date';
    case 'syncing':
      return 'syncing';
    case 'offline':
      return 'offline — edits are kept locally';
    case 'denied':
      return 'no access';
    default:
      return handle.status;
  }
}

/** The toggle that lives in the top bar. */
export function RightPanelToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      className="quiet panel-toggle"
      type="button"
      aria-label={open ? 'Hide the page panel' : 'Show the page panel'}
      aria-expanded={open}
      onClick={onToggle}
    >
      <ChevronRightIcon />
    </button>
  );
}
