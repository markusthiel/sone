/**
 * SONE web — the comments panel (ADR-0046).
 *
 * Three groups, and the middle one is the reason this is not just a list.
 *
 * Open threads are the discussion. **Detached** threads are the ones whose text
 * has been deleted: they keep their quotation and they stay, because dropping
 * them would mean somebody's objection vanishes when the text they objected to
 * is removed — the case where the objection matters most. Resolved threads are
 * decisions that were made, kept because those are worth being able to find.
 */

import { useState, type ReactElement } from 'react';

import { guestName, isGuestKey } from '@sone/client';
import type { CommentThread } from '@sone/core';

import type { WorkspaceMember } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import {
  COMMENT_MARK_STYLES,
  type CommentMarkStyle,
} from '../hooks/useCommentMarkStyle.ts';
import type { CommentActions } from '../hooks/useComments.ts';
import { CheckSquareIcon, ChevronRightIcon, TrashIcon } from './icons.tsx';

/** A person's name, or what can honestly be said instead. */
function nameOf(author: string, members: WorkspaceMember[]): { name: string; guest: boolean } {
  if (isGuestKey(author)) return { name: guestName(author), guest: true };
  const member = members.find((one) => one.userId === author);
  // Somebody who has left still said what they said, and dropping their name
  // would quietly rewrite who was in the conversation.
  return { name: member?.displayName ?? '', guest: false };
}

function Thread({
  thread,
  members,
  comments,
  canEdit,
  onReveal,
  open,
  onToggle,
}: {
  thread: CommentThread;
  members: WorkspaceMember[];
  comments: CommentActions;
  canEdit: boolean;
  onReveal: (thread: CommentThread) => void;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState('');

  return (
    <li className="comment-thread" data-detached={thread.range === null ? 'true' : undefined}>
      {/* The words it is about, as they read when it was written. A thread whose
          text has changed is only readable because of this. */}
      <div className="comment-head">
        {/* Two jobs on one line, and they are deliberately two controls: the
            quotation shows the passage in the page, the chevron opens the
            thread. One control doing both would mean somebody who wants to read
            a reply gets scrolled somewhere first. */}
        <button
          type="button"
          className="comment-quote"
          disabled={thread.range === null}
          title={thread.range === null ? t('comment.detached') : t('comment.reveal')}
          onClick={() => onReveal(thread)}
        >
          {thread.quote}
        </button>
        <button
          type="button"
          className="comment-fold"
          aria-expanded={open}
          aria-label={open ? t('comment.collapse') : t('comment.expand')}
          title={open ? t('comment.collapse') : t('comment.expand')}
          onClick={onToggle}
        >
          <ChevronRightIcon />
          {/* How much is behind it, so a closed thread still says whether
              anybody answered. */}
          {!open && thread.messages.length > 1 && (
            <span className="comment-count">{thread.messages.length}</span>
          )}
        </button>
      </div>

      {thread.range === null && <p className="comment-note">{t('comment.detached')}</p>}

      <ul className="comment-messages">
        {/* Closed, the first message stays. A thread showing only its quotation
            says what is being discussed and not what was said about it, which is
            the half somebody scanning a page actually wants. */}
        {(open ? thread.messages : thread.messages.slice(0, 1)).map((message) => {
          const who = nameOf(message.author, members);
          return (
            <li key={message.id} className="comment-message">
              <span className="comment-author">
                {who.name || t('comment.unknownAuthor')}
                {who.guest && <span className="contributor-guest">{t('panel.guest')}</span>}
              </span>
              <p className="comment-text">{message.text}</p>
              {canEdit && (
                <button
                  type="button"
                  className="comment-remove"
                  aria-label={t('comment.removeMessage')}
                  title={t('comment.removeMessage')}
                  onClick={() => comments.removeReply(thread.id, message.id)}
                >
                  <TrashIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && open && (
        <div className="comment-reply">
          {/* A reply, which is how anybody is addressed — member or guest
              (ADR-0046). It quotes nothing and needs no identity beyond what the
              message it answers already carries, so it cannot reach the wrong
              person. */}
          <textarea
            className="comment-draft"
            value={draft}
            placeholder={t('comment.replyPlaceholder')}
            aria-label={t('comment.replyPlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line: a comment is usually
              // one sentence, and reaching for a button for one sentence is the
              // friction that stops people commenting.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                comments.reply(thread.id, draft);
                setDraft('');
              }
            }}
          />
          <div className="comment-actions">
            <button
              type="button"
              className="btn subtle"
              onClick={() => comments.setResolved(thread.id, !thread.resolved)}
            >
              <CheckSquareIcon /> {thread.resolved ? t('comment.reopen') : t('comment.resolve')}
            </button>
            <button
              type="button"
              className="btn subtle destructive"
              onClick={() => comments.removeOne(thread.id)}
            >
              {t('comment.removeThread')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function CommentsPanel({
  comments,
  members,
  canEdit,
  onReveal,
  pending,
  onCancelPending,
  marks,
}: {
  comments: CommentActions;
  members: WorkspaceMember[];
  canEdit: boolean;
  onReveal: (thread: CommentThread) => void;
  /** A selection waiting for its first message (ADR-0046). */
  pending: { from: Uint8Array; to: Uint8Array; quote: string } | null;
  onCancelPending: () => void;
  marks: {
    style: CommentMarkStyle;
    setStyle: (style: CommentMarkStyle) => void;
    hidden: boolean;
    setHidden: (hidden: boolean) => void;
  };
}): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState('');

  /**
   * Which threads are open.
   *
   * A set of the *closed* ones rather than the open ones, so a thread that
   * arrives while somebody is reading is open — a new comment appearing folded
   * would be a comment nobody notices, which is the opposite of what a comment
   * is for.
   */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allClosed = comments.threads.length > 0 && closed.size === comments.threads.length;

  /**
   * The selection somebody pressed Comment on, at the top and focused.
   *
   * The thread does not exist until this is submitted: a thread with an empty
   * first message is a highlight over nothing, and it would arrive on somebody
   * else's screen as exactly that.
   */
  const start = pending ? (
    <section className="panel-section">
      <div className="comment-thread" data-pending="true">
        <p className="comment-quote" aria-hidden="true">
          {pending.quote}
        </p>
        <textarea
          className="comment-draft"
          value={draft}
          autoFocus
          placeholder={t('comment.startPlaceholder')}
          aria-label={t('comment.startPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onCancelPending();
              setDraft('');
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              comments.start(pending, draft);
              setDraft('');
              onCancelPending();
            }
          }}
        />
        <div className="comment-actions">
          <button
            type="button"
            className="btn primary"
            disabled={draft.trim() === ''}
            onClick={() => {
              comments.start(pending, draft);
              setDraft('');
              onCancelPending();
            }}
          >
            {t('comment.start')}
          </button>
          <button
            type="button"
            className="btn subtle"
            onClick={() => {
              setDraft('');
              onCancelPending();
            }}
          >
            {t('action.cancel')}
          </button>
        </div>
      </div>
    </section>
  ) : null;

  if (comments.threads.length === 0) {
    return (
      <>
        {start}
        <div className="panel-section">
          <p className="muted">{t('comment.none')}</p>
        </div>
      </>
    );
  }

  const group = (
    key: 'comment.open' | 'comment.detachedHeading' | 'comment.resolvedHeading',
    threads: CommentThread[],
  ): ReactElement | null =>
    threads.length === 0 ? null : (
      <section className="panel-section">
        <h3 className="panel-heading">{t(key)}</h3>
        <ul className="comment-list">
          {threads.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              members={members}
              comments={comments}
              canEdit={canEdit}
              onReveal={onReveal}
              open={!closed.has(thread.id)}
              onToggle={() => toggle(thread.id)}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <>
      {/* How much the page is marked.
        *
        * Two controls of different kinds, deliberately (ADR-0046). The switch is
        * view state — it lasts while somebody reads this page and is not written
        * into the document, because a switch stored there would let one person
        * hide the marks for everybody. The choice below it is a preference, kept
        * per browser: how much marking somebody wants depends on the screen they
        * are reading on, and a phone is not a desk. */}
      <div className="comment-marks">
        {/* `.checkbox` belongs to the label — it is the row, sized for a
            finger. I put it on the input, which turned the box into a tall flex
            container and made the whole control behave oddly. */}
        <label className="checkbox comment-marks-toggle">
          <input
            type="checkbox"
            checked={!marks.hidden}
            onChange={(event) => marks.setHidden(!event.target.checked)}
          />
          {t('comment.showMarks')}
        </label>

        {comments.threads.length > 1 && (
          <button
            type="button"
            className="btn subtle comment-fold-all"
            onClick={() =>
              setClosed(
                allClosed ? new Set() : new Set(comments.threads.map((thread) => thread.id)),
              )
            }
          >
            {allClosed ? t('comment.expandAll') : t('comment.collapseAll')}
          </button>
        )}

        <select
          className="comment-marks-style"
          value={marks.style}
          disabled={marks.hidden}
          aria-label={t('comment.markStyle')}
          onChange={(event) => marks.setStyle(event.target.value as CommentMarkStyle)}
        >
          {COMMENT_MARK_STYLES.map((one) => (
            <option key={one} value={one}>
              {t(`comment.mark.${one}` as 'comment.mark.highlight')}
            </option>
          ))}
        </select>
      </div>

      {start}
      {group('comment.open', comments.open)}
      {/* Between the open threads and the resolved ones, deliberately: a
          detached thread is unfinished business, not a decision. */}
      {group('comment.detachedHeading', comments.detached)}
      {group('comment.resolvedHeading', comments.resolved)}
    </>
  );
}
