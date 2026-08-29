/**
 * SONE web — page view.
 *
 * Live-synced title plus a read-only block rendering. The title is editable
 * because it demonstrates the whole write path end to end — type here and the
 * sidebar, the search index and the other browser all follow.
 */

import type { PageHandle } from '@sone/client';
import { DOC_KEYS, PAGE_KEYS } from '@sone/core';
import { useEffect, useState , type ReactElement } from 'react';

import { EditorSurface } from './EditorSurface.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

interface PageViewProps {
  handle: PageHandle;
  pageId: string;
  /**
   * Called when the title changes, including by another client.
   *
   * The sidebar reads titles from the projection over HTTP, so without this it
   * shows the old name until something refetches — which is what made editing a
   * heading look like it had not synced.
   */
  onTitleChange?: (title: string) => void;
}

export function PageView({ handle, pageId, onTitleChange }: PageViewProps): ReactElement {
  const pageMap = handle.doc.getMap(DOC_KEYS.page);
  const [title, setTitle] = useState<string>(
    () => (pageMap.get(PAGE_KEYS.title) as string | undefined) ?? '',
  );

  // Mirror remote title changes into local state. Guarded against writing back
  // what we just typed, which would fight the cursor.
  useEffect(() => {
    const observer = (): void => {
      const next = (pageMap.get(PAGE_KEYS.title) as string | undefined) ?? '';
      setTitle((current) => (current === next ? current : next));
      // Reported for remote changes too, so a rename from another client
      // reaches the sidebar without a refetch.
      onTitleChange?.(next);
    };
    pageMap.observe(observer);
    return () => pageMap.unobserve(observer);
  }, [pageMap, onTitleChange]);

  const commitTitle = (next: string): void => {
    setTitle(next);
    if (!handle.canEdit) return;
    pageMap.set(PAGE_KEYS.title, next);
    // Told directly rather than waiting for the observer: a local write does
    // fire it, but going straight there keeps the sidebar in step with the
    // caret rather than one tick behind.
    onTitleChange?.(next);
  };

  return (
    <div className="page-body">
      <input
        className="page-title"
        value={title}
        onChange={(e) => commitTitle(e.target.value)}
        placeholder="Untitled"
        readOnly={!handle.canEdit}
        aria-label="Page title"
      />

      {/* Three states, told apart on purpose.
       *
       * `canEdit` is false whenever the role is unknown, which includes while
       * the document is opening and while a reconnect is in flight — the role
       * is cleared when a connection drops and only returns with the next open
       * acknowledgement. Deriving "read-only" from it therefore told the owner
       * of a workspace they had no write access, mid-reconnect, which is both
       * alarming and false.
       *
       * Read-only is claimed only when the role is actually known and actually
       * read-only. */}
      {handle.status === 'denied' && (
        <p className="error">You no longer have access to this page.</p>
      )}
      {handle.status !== 'denied' && handle.role === null && (
        <p className="muted">Opening…</p>
      )}
      {handle.status !== 'denied' && handle.role !== null && !handle.canEdit && (
        <p className="muted">You have read-only access to this page.</p>
      )}

      {/* A second boundary around the editor specifically, so a crash there
          leaves the title, the sidebar and navigation working. Losing the
          editor is bad; losing the way out of the page is worse. */}
      <ErrorBoundary where="The editor">
        <EditorSurface handle={handle} pageId={pageId} />
      </ErrorBoundary>

    </div>
  );
}


/**
 * Connection state and who else is here.
 *
 * The wording matters more than it looks. An indefinite "Syncing…" was shown
 * for a connection that had never been established, which suggests progress
 * that is not happening and hides the one fact somebody could act on. When the
 * client reports why it cannot connect, that is said instead.
 */
export function PageStatus({ handle, connectionState, failure }: {
  handle: PageHandle | null;
  connectionState: string;
  failure?: { kind: string; attempts: number } | null;
}): ReactElement {
  const peers = handle?.peers() ?? [];

  // 'ready' plus a synced document is the only fully-good state; anything else
  // is reported rather than hidden, because a silent offline state is how
  // people lose work they thought was saved.
  const dot =
    connectionState === 'ready'
      ? handle && handle.status !== 'synced'
        ? 'offline'
        : 'ready'
      : connectionState === 'closed'
        ? 'closed'
        : 'offline';

  // A repeated failure is reported plainly rather than as another "…". Two
  // attempts is the threshold: one can be a page load racing the network, and
  // announcing a problem that resolves itself is its own kind of noise.
  const persistent = failure && failure.attempts >= 2 ? failure : null;

  const label = persistent
    ? FAILURE_LABELS[persistent.kind] ?? 'Cannot reach the server'
    : dot === 'ready'
      ? 'Synced'
      : dot === 'closed'
        ? 'Disconnected'
        : connectionState === 'reconnecting'
          ? 'Reconnecting…'
          : 'Syncing…';

  return (
    <>
      <span
        className="status-dot"
        data-state={persistent ? 'closed' : dot}
        aria-hidden="true"
      />
      <span
        // status-text so the bar can truncate it. A long status — "Cannot reach
        // the sync server" — wrapped onto three lines and took the row's height
        // with it, so losing the connection also rearranged the page.
        className={`status-text ${persistent ? 'error' : 'muted'}`}
        style={{ fontSize: '0.85rem' }}
        title={persistent ? FAILURE_DETAIL[persistent.kind] : label}
      >
        {label}
      </span>
      {peers.length > 0 && (
        <div className="peers" aria-label={`${peers.length} other people here`}>
          {peers.slice(0, 5).map((peer, i) => (
            <span
              key={i}
              className="peer"
              style={{ background: peer.color || 'var(--sone-accent)' }}
              title={peer.displayName}
            >
              {(peer.displayName || '?').slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * What to call each failure.
 *
 * Short enough for a status line. The detail below carries the part an operator
 * needs, on hover and in the console — a status line is not the place for a
 * paragraph, but hiding the cause entirely is what made this hard to diagnose in
 * the first place.
 */
const FAILURE_LABELS: Record<string, string> = {
  unreachable: 'Cannot reach the sync server',
  no_auth_response: 'The server is not responding',
  closed: 'Connection lost',
};

const FAILURE_DETAIL: Record<string, string> = {
  unreachable:
    'The WebSocket connection to /sync never completed. This is usually a ' +
    'reverse proxy that does not forward WebSocket upgrades. Edits are kept ' +
    'locally and will sync once the connection works.',
  no_auth_response:
    'The connection opened but the server did not answer. Edits are kept ' +
    'locally in the meantime.',
  closed: 'The connection dropped and is being retried. Edits are kept locally.',
};
