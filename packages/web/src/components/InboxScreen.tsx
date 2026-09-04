/**
 * The notifications themselves — the content, not the menu (ADR-0069).
 *
 * The views live in the panel beside this and the list arrives already filtered,
 * which is why there is no control here any more: a filter drawn twice is a
 * filter that can disagree with itself, and the one in the panel is the one
 * that also carries the counts.
 *
 * Fetching happens above both (useInbox) for the same reason.
 *
 * One row is one conversation, not one notification (ADR-0071). What the row
 * shows is the newest thing said in it and how many there were; opening it
 * settles all of them, because they are one thing to deal with.
 *
 * It is a list you work down with the keyboard: `j` and `k` move, Enter opens,
 * `e` marks a row read, `u` puts it back to waiting. Moving is done by moving
 * the *focus* rather than by drawing a selection of our own — then Enter,
 * scrolling into view and the screen reader's announcement all come from the
 * browser and cannot disagree with what is on screen.
 */

import { useEffect, useRef, type ReactElement } from 'react';

import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import type { InboxItem } from '../hooks/useInbox.ts';
import { groupsIn, type InboxGroup, type InboxView } from './InboxPanel.tsx';

export function InboxScreen({
  items,
  view,
  error,
  onRead,
}: {
  /** Everything; the view below decides what this shows. Null while loading. */
  items: InboxItem[] | null;
  view: InboxView;
  error: string | null;
  onRead: (ids: string[], read: boolean) => void;
}): ReactElement {
  const { t } = useT();
  const groups = items === null ? null : groupsIn(items, view);
  const rows = useRef<Array<HTMLAnchorElement | null>>([]);
  /*
   * Which row to take up after the list changes.
   *
   * Marking a row read in the unread view removes it, and the focus goes with
   * it — so `e` twice in a row worked once and then did nothing, which is the
   * failure mode of every keyboard list that forgets this. The row that moves
   * up into the place takes the focus, so working down a list is one key
   * pressed repeatedly.
   */
  const next = useRef<number | null>(null);

  useEffect(() => {
    const at = next.current;
    if (at === null || !groups) return;
    next.current = null;
    // Clamped: acting on the last row leaves nothing at that index, and the
    // row before it is where somebody is looking.
    rows.current[Math.min(at, groups.length - 1)]?.focus();
  }, [groups]);

  /*
   * The keys, on the window rather than on the list.
   *
   * A handler on the list would only fire once something in it already had
   * focus, which is the state `j` exists to reach. Anything typed into a field
   * is left alone — an inbox that swallows "j" while somebody is writing a
   * reply is worse than one with no shortcuts.
   */
  useEffect(() => {
    if (!groups || groups.length === 0) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        return;
      }

      const at = rows.current.findIndex((row) => row !== null && row === document.activeElement);
      const focus = (to: number): void => {
        const row = rows.current[Math.max(0, Math.min(groups.length - 1, to))];
        if (row) {
          event.preventDefault();
          row.focus();
        }
      };

      // Nothing focused yet: both keys mean "start", from the end they came
      // from. Otherwise a first press of `k` would do nothing at all.
      if (event.key === 'j') return focus(at === -1 ? 0 : at + 1);
      if (event.key === 'k') return focus(at === -1 ? groups.length - 1 : at - 1);
      if (at === -1) return;

      const group = groups[at];
      if (!group) return;
      if (event.key === 'e' || event.key === 'u') {
        event.preventDefault();
        next.current = at;
        onRead(
          group.items.map((one) => one.id),
          event.key === 'e',
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groups, onRead]);

  return (
    <div className="page-body">
      <h1 className="page-title">{t('inbox.title')}</h1>

      {error && <p className="error">{messageFor(error)}</p>}

      {groups === null && <p className="muted">{t('panel.loading')}</p>}

      {groups?.length === 0 && (
        <>
          <p className="muted">{t('inbox.emptyView')}</p>
          {/* Said here rather than left to be assumed: nothing about this
              interface should imply an email is on its way (ADR-0052). */}
          <p className="settings-note">{t('inbox.noEmail')}</p>
        </>
      )}

      {groups && groups.length > 0 && (
        <>
          {/* Said rather than left to be found. A shortcut nobody knows about
              is a shortcut nobody has. */}
          <p className="settings-note inbox-keys">{t('inbox.keys')}</p>

          <ul className="inbox-list">
            {groups.map((group, at) => (
              <Row
                key={group.id}
                group={group}
                onRead={onRead}
                ref={(element) => {
                  rows.current[at] = element;
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Row({
  group,
  onRead,
  ref,
}: {
  group: InboxGroup;
  onRead: (ids: string[], read: boolean) => void;
  ref: (element: HTMLAnchorElement | null) => void;
}): ReactElement {
  const { t } = useT();
  const item = group.latest;

  return (
    <li data-read={group.unread === 0 ? 'true' : undefined}>
      <a
        ref={ref}
        href={paths.page(item.pageId, item.pageTitle)}
        onClick={() => {
          // Read on opening, which is what "read" means here — and the whole
          // conversation, because that is what was opened. Fired without
          // waiting: the navigation matters more than the acknowledgement, and
          // a mark that fails is one row that stays bold.
          if (group.unread > 0) onRead(group.items.map((one) => one.id), true);
        }}
      >
        <span className="inbox-what">
          {t(`inbox.${item.kind}` as MessageKey)}
          {/* How many times this conversation spoke. Only when it spoke more
              than once — "1" beside every row would be noise. */}
          {group.items.length > 1 && (
            <span className="inbox-times">{t('inbox.times', { count: group.items.length })}</span>
          )}
        </span>
        <span className="inbox-excerpt">{item.excerpt}</span>
        {/* Where it was, because an inbox spans workspaces and "which page" is
            the first thing somebody needs to know. */}
        <span className="inbox-where">
          {item.workspaceName} · {item.pageTitle}
          {' · '}
          {new Date(item.createdAt).toLocaleString()}
        </span>
      </a>

      {/* The same two acts the keys perform, for everybody who is not using
          them. Whichever one this row is not already in. */}
      <button
        className="quiet inbox-mark"
        type="button"
        onClick={() =>
          onRead(
            group.items.map((one) => one.id),
            group.unread > 0,
          )
        }
      >
        {group.unread > 0 ? t('inbox.markRead') : t('inbox.markUnread')}
      </button>
    </li>
  );
}
