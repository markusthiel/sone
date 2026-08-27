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
}

export function PageView({ handle }: PageViewProps): ReactElement {
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
    };
    pageMap.observe(observer);
    return () => pageMap.unobserve(observer);
  }, [pageMap]);

  const commitTitle = (next: string): void => {
    setTitle(next);
    if (!handle.canEdit) return;
    pageMap.set(PAGE_KEYS.title, next);
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
        <EditorSurface handle={handle} />
      </ErrorBoundary>
    </div>
  );
}

/** Connection state and who else is here. */
export function PageStatus({ handle, connectionState }: {
  handle: PageHandle | null;
  connectionState: string;
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

  const label =
    dot === 'ready'
      ? 'Synced'
      : dot === 'closed'
        ? 'Disconnected'
        : connectionState === 'reconnecting'
          ? 'Reconnecting…'
          : 'Syncing…';

  return (
    <>
      <span className="status-dot" data-state={dot} aria-hidden="true" />
      <span className="muted" style={{ fontSize: '0.85rem' }}>
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
