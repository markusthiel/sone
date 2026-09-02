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
import type { CommentActions } from '../hooks/useComments.ts';
import { CheckSquareIcon, TrashIcon } from './icons.tsx';

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
}: {
  thread: CommentThread;
  members: WorkspaceMember[];
  comments: CommentActions;
  canEdit: boolean;
  onReveal: (thread: CommentThread) => void;
}): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState('');

  return (
    <li className="comment-thread" data-detached={thread.range === null ? 'true' : undefined}>
      {/* The words it is about, as they read when it was written. A thread whose
          text has changed is only readable because of this. */}
      <button
        type="button"
        className="comment-quote"
        disabled={thread.range === null}
        title={thread.range === null ? t('comment.detached') : t('comment.reveal')}
        onClick={() => onReveal(thread)}
      >
        {thread.quote}
      </button>

      {thread.range === null && <p className="comment-note">{t('comment.detached')}</p>}

      <ul className="comment-messages">
        {thread.messages.map((message) => {
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

      {canEdit && (
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
}: {
  comments: CommentActions;
  members: WorkspaceMember[];
  canEdit: boolean;
  onReveal: (thread: CommentThread) => void;
}): ReactElement {
  const { t } = useT();

  if (comments.threads.length === 0) {
    return (
      <div className="panel-section">
        <p className="muted">{t('comment.none')}</p>
      </div>
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
            />
          ))}
        </ul>
      </section>
    );

  return (
    <>
      {group('comment.open', comments.open)}
      {/* Between the open threads and the resolved ones, deliberately: a
          detached thread is unfinished business, not a decision. */}
      {group('comment.detachedHeading', comments.detached)}
      {group('comment.resolvedHeading', comments.resolved)}
    </>
  );
}
