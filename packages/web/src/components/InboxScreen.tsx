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
 * `e` marks a row read, `u` puts it back to waiting, `s` puts it aside until
 * tomorrow morning. Moving is done by moving the *focus* rather than by drawing
 * a selection of our own — then Enter, scrolling into view and the screen
 * reader's announcement all come from the browser and cannot disagree with what
 * is on screen.
 *
 * `s` takes the commonest of the three times rather than opening the menu. A
 * shortcut that opens a menu has saved nobody anything, and the other two times
 * are a click away on the same row.
 *
 * A conversation can be answered here (ADR-0076). Not every row: an assignment
 * is a task and not a question, and a notification whose thread has gone has
 * nothing to answer. The box appears on the row rather than in a dialog,
 * because the passage being answered is the line above it and a dialog would
 * cover the one thing somebody needs to read while writing.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { paths } from '../routes/paths.ts';
import { usePageLink } from '../routes/pageLink.tsx';
import { useDismiss } from '../hooks/useDismiss.ts';
import { messageFor } from './Auth.tsx';
import { ClockIcon } from './icons.tsx';
import type { InboxItem } from '../hooks/useInbox.ts';
import { groupsIn, isAsleep, type InboxGroup, type InboxView } from './InboxPanel.tsx';
import { snoozeUntil, type SnoozeChoice } from './snoozeTimes.ts';

export function InboxScreen({
  items,
  view,
  error,
  onRead,
  onSnooze,
  onReply,
}: {
  /** Everything; the view below decides what this shows. Null while loading. */
  items: InboxItem[] | null;
  view: InboxView;
  error: string | null;
  onRead: (ids: string[], read: boolean) => void;
  /** Aside until a moment, or back now with null (ADR-0075). */
  onSnooze: (ids: string[], until: Date | null) => void;
  /** Answer the conversation a row is about (ADR-0076). */
  onReply: (id: string, text: string) => Promise<void>;
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
      if (event.key === 's') {
        event.preventDefault();
        next.current = at;
        // Tomorrow morning, which is the commonest of the three. A shortcut
        // that opens a menu has saved nobody anything.
        onSnooze(
          group.items.map((one) => one.id),
          isAsleep(group.latest) ? null : snoozeUntil('tomorrow'),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groups, onRead, onSnooze]);

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
                onSnooze={onSnooze}
                onReply={onReply}
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
  onSnooze,
  onReply,
  ref,
}: {
  group: InboxGroup;
  onRead: (ids: string[], read: boolean) => void;
  onSnooze: (ids: string[], until: Date | null) => void;
  onReply: (id: string, text: string) => Promise<void>;
  ref: (element: HTMLAnchorElement | null) => void;
}): ReactElement {
  const pageLink = usePageLink();
  const { t } = useT();
  const item = group.latest;
  const asleep = isAsleep(item);
  const ids = group.items.map((one) => one.id);
  const [answering, setAnswering] = useState(false);
  /*
   * A conversation to answer.
   *
   * An assignment is a task rather than a question — there is nobody to answer
   * — and a notification with no thread is one about a page rather than about
   * something somebody said.
   */
  const answerable = item.kind !== 'assignment' && item.threadId !== null;

  return (
    <li
      data-read={group.unread === 0 ? 'true' : undefined}
      data-asleep={asleep ? 'true' : undefined}
    >
      <a
        ref={ref}
        href={pageLink(item.pageId, item.pageTitle)}
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
          {/* When it comes back, in place of when it arrived. A row that is
              asleep is not about the moment it was sent any more; it is about
              the moment it will be back (ADR-0075). */}
          {asleep && item.snoozedUntil
            ? t('inbox.backOn', { when: new Date(item.snoozedUntil).toLocaleString() })
            : new Date(item.createdAt).toLocaleString()}
        </span>
      </a>

      {/* The same acts the keys perform, for everybody who is not using them.
          A sleeping row offers one thing — waking it — because reading and
          unreading something you have put off until Tuesday is a decision about
          a row you deliberately stopped looking at. */}
      {asleep ? (
        <button
          className="quiet inbox-mark"
          type="button"
          onClick={() => onSnooze(ids, null)}
        >
          {t('inbox.wake')}
        </button>
      ) : (
        <>
          <button
            className="quiet inbox-mark"
            type="button"
            onClick={() => onRead(ids, group.unread > 0)}
          >
            {group.unread > 0 ? t('inbox.markRead') : t('inbox.markUnread')}
          </button>
          {answerable && (
            <button
              className="quiet inbox-mark"
              type="button"
              aria-expanded={answering}
              onClick={() => setAnswering((previous) => !previous)}
            >
              {t('inbox.answer')}
            </button>
          )}
          <SnoozeMenu onChoose={(choice) => onSnooze(ids, snoozeUntil(choice))} />
        </>
      )}

      {answering && (
        <ReplyBox
          onSend={(text) => onReply(item.id, text)}
          onDone={() => setAnswering(false)}
        />
      )}
    </li>
  );
}

/**
 * The three times, behind one button.
 *
 * A menu rather than three buttons on every row: the row already carries a
 * link, an excerpt, a place and one other control, and three more would make
 * "later" the loudest thing about a notification.
 */
function SnoozeMenu({ onChoose }: { onChoose: (choice: SnoozeChoice) => void }): ReactElement {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  useDismiss({
    open,
    inside: [panel, button],
    onDismiss: useCallback((reason: 'outside' | 'escape') => {
      setOpen(false);
      if (reason === 'escape') button.current?.focus();
    }, []),
  });

  const choices: Array<{ id: SnoozeChoice; label: MessageKey }> = [
    { id: 'later', label: 'inbox.snooze.later' },
    { id: 'tomorrow', label: 'inbox.snooze.tomorrow' },
    { id: 'nextWeek', label: 'inbox.snooze.nextWeek' },
  ];

  return (
    <div className="inbox-snooze">
      <button
        ref={button}
        className="quiet inbox-mark"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <ClockIcon /> {t('inbox.snooze')}
      </button>

      {open && (
        <div className="inbox-snooze-menu" ref={panel} role="menu">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onChoose(choice.id);
              }}
            >
              {/* The time itself beside the name: "tomorrow morning" is a
                  promise, and the date is what makes it one somebody can
                  check before agreeing to it. */}
              <span>{t(choice.label)}</span>
              <span className="muted small">
                {snoozeUntil(choice.id).toLocaleString(undefined, {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Writing the answer.
 *
 * Its own component so the text belongs to the row it is under and nothing
 * else: a single box held by the list would carry a half-written sentence to
 * whichever row was opened next.
 *
 * The box keeps what was typed until the server has it. A reply is a sentence
 * addressed to somebody, and showing it as sent when it was not is the one
 * failure here nobody could recover from — the words would already be gone.
 */
function ReplyBox({
  onSend,
  onDone,
}: {
  onSend: (text: string) => Promise<void>;
  onDone: () => void;
}): ReactElement {
  const { t } = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = (): void => {
    const said = text.trim();
    if (said === '' || busy) return;
    setBusy(true);
    setFailed(false);
    void onSend(said)
      .then(() => {
        setText('');
        onDone();
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <div className="inbox-reply">
      <textarea
        className="inbox-reply-text"
        value={text}
        autoFocus
        rows={2}
        placeholder={t('inbox.answer.placeholder')}
        aria-label={t('inbox.answer')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter breaks the line: the box is two lines
          // tall and holds a sentence, not a document.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
          }
          if (event.key === 'Escape') onDone();
        }}
      />
      <div className="inbox-reply-actions">
        {failed && <span className="error small">{t('inbox.answer.failed')}</span>}
        <button type="button" className="btn" onClick={onDone}>
          {t('action.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || text.trim() === ''}
          onClick={send}
        >
          {busy ? t('inbox.answer.sending') : t('inbox.answer.send')}
        </button>
      </div>
    </div>
  );
}
