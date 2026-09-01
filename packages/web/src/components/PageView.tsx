/**
 * SONE web — page view.
 *
 * Live-synced title plus a read-only block rendering. The title is editable
 * because it demonstrates the whole write path end to end — type here and the
 * sidebar, the search index and the other browser all follow.
 */

import type { PageHandle } from '@sone/client';
import {
  DOC_KEYS,
  PAGE_KEYS,
  readEntryIcon,
  readTitleColor,
  type EntryIcon,
} from '@sone/core';
import { useEntryKind } from '../hooks/usePageWidth.ts';
import { usePageWidth } from '../hooks/usePageWidth.ts';
import { useT } from '../i18n/useT.tsx';
import { useEffect, useState , type ReactElement } from 'react';

import { blockFromHash } from '../routes/paths.ts';
import { scrollToBlock } from '../hooks/useOutline.ts';
import { CanvasSurface } from './CanvasSurface.tsx';
import { EditorSurface } from './EditorSurface.tsx';
import { EntryIconView, titleColorStyle } from './EntryIconView.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

interface PageViewProps {
  /** So a refusal is only believed once the connection has settled. */
  connectionState: string;
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

/** An entry's icon and title colour out of whatever the document holds. */
function readIcon(value: unknown): { icon: EntryIcon | null; titleColor: string | null } {
  return { icon: readEntryIcon(value), titleColor: readTitleColor(value) };
}

export function PageView({
  handle,
  pageId,
  connectionState,
  onTitleChange,
}: PageViewProps): ReactElement {
  const isCanvas = useEntryKind(handle?.doc ?? null) === 'canvas';
  // From the document, so it arrives like any other edit (ADR-0028).
  const width = usePageWidth(handle?.doc ?? null);
  const { t } = useT();
  const pageMap = handle.doc.getMap(DOC_KEYS.page);
  const [title, setTitle] = useState<string>(
    () => (pageMap.get(PAGE_KEYS.title) as string | undefined) ?? '',
  );

  /**
   * The page's own icon and colours (ADR-0030), read from the document.
   *
   * From the document rather than passed in from the tree: this component is
   * also what a share link renders, where there is no tree at all — and reading
   * it here means a change made in another browser arrives the same way a
   * rename does, through the observer below.
   *
   * The title colour is stored inside the same object, so both come from one
   * read.
   */
  const [icon, setIcon] = useState<{
    icon: EntryIcon | null;
    titleColor: string | null;
  }>(() => readIcon(pageMap.get(PAGE_KEYS.icon)));

  // Mirror remote title changes into local state. Guarded against writing back
  // what we just typed, which would fight the cursor.
  useEffect(() => {
    const observer = (): void => {
      const next = (pageMap.get(PAGE_KEYS.title) as string | undefined) ?? '';
      setTitle((current) => (current === next ? current : next));
      // The same observer, because it fires for every key in the map and an
      // icon chosen elsewhere has to arrive here too. Compared before storing,
      // or every keystroke in the title would replace an equal object and
      // re-render the heading.
      setIcon((current) => {
        const read = readIcon(pageMap.get(PAGE_KEYS.icon));
        return current.icon?.value === read.icon?.value &&
          current.icon?.color === read.icon?.color &&
          current.titleColor === read.titleColor
          ? current
          : read;
      });
      // Reported for remote changes too, so a rename from another client
      // reaches the sidebar without a refetch.
      onTitleChange?.(next);
    };
    pageMap.observe(observer);
    return () => pageMap.unobserve(observer);
  }, [pageMap, onTitleChange]);

  /**
   * Land on the block a URL names (ADR-0033).
   *
   * A search result links to `#b-<id>`, and the block it names is not in the DOM
   * when the page mounts: the document arrives over the sync connection a moment
   * later. So this retries for a couple of seconds and then gives up quietly —
   * the alternative is a link that works on a fast connection and silently does
   * nothing on a slow one.
   *
   * Given up on rather than reported: the page is open and correct, and an error
   * about a failed scroll would be about a convenience.
   */
  useEffect(() => {
    const wanted = blockFromHash(window.location.hash);
    if (!wanted) return;

    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tryScroll = (): void => {
      if (scrollToBlock(wanted)) return;
      attempts += 1;
      if (attempts > 20) return;
      timer = setTimeout(tryScroll, 100);
    };
    tryScroll();

    return () => {
      if (timer) clearTimeout(timer);
    };
    // Per page: following a second result from the same search has to scroll
    // again, and the hash is what changed.
  }, [pageId]);

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
    <div className="page-body" data-width={width} data-kind={isCanvas ? 'canvas' : undefined}>
      {/* The icon and the name on one line, the same shape a folder has. */}
      <div className="entry-heading">
        <span className="entry-heading-icon">
          <EntryIconView icon={icon.icon} kind="page" />
        </span>
        <input
          className="page-title"
          style={titleColorStyle(icon.titleColor ? { titleColor: icon.titleColor } : null)}
          value={title}
          onChange={(e) => commitTitle(e.target.value)}
          placeholder={t('page.untitled')}
          readOnly={!handle.canEdit}
          aria-label={t('page.title')}
        />
      </div>

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
      {/* Denied, and the connection settled enough to believe it.
        *
        * Switching workspaces reconnects, and a page opened against the old
        * connection is refused — correctly, and for a page in the workspace
        * somebody has just arrived in. The refusal was true of a moment that
        * had already passed, and it was shown to somebody who had only pressed
        * a switcher.
        *
        * A page that is really out of reach still says so: the connection
        * becomes ready and the denial stands. */}
      {handle.status === 'denied' && connectionState === 'ready' && (
        <p className="error">{t('page.noAccess')}</p>
      )}
      {(handle.role === null || (handle.status === 'denied' && connectionState !== 'ready')) && (
        <p className="muted">Opening…</p>
      )}
      {handle.status !== 'denied' && handle.role !== null && !handle.canEdit && (
        <p className="muted">{t('page.readOnly')}</p>
      )}

      {/* A second boundary around the editor specifically, so a crash there
          leaves the title, the sidebar and navigation working. Losing the
          editor is bad; losing the way out of the page is worse. */}
      {/* A canvas is a page with a different body, not a different screen: the
          title, the panel, the trail and the sharing are all the page's
          (ADR-0043). Only what is under the heading changes. */}
      <ErrorBoundary where="The editor">
        {isCanvas ? (
          <CanvasSurface handle={handle} pageId={pageId} canEdit={handle.canEdit !== false} />
        ) : (
          <EditorSurface handle={handle} pageId={pageId} />
        )}
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
  const { t } = useT();
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
