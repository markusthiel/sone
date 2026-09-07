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

import { useEffect, useState, type ReactElement } from 'react';

import { guestName, isGuestKey } from '@sone/client';
import { isDetached, type CommentThread } from '@sone/core';

import type { WorkspaceMember } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import {
  COMMENT_MARK_STYLES,
  type CommentMarkStyle,
} from '../hooks/useCommentMarkStyle.ts';
import type { CommentActions } from '../hooks/useComments.ts';
import { useFoldedThreads } from '../hooks/useFoldedThreads.ts';
import { CheckSquareIcon, ChevronRightIcon, TrashIcon } from './icons.tsx';
import { MentionDraftInput } from './MentionDraftInput.tsx';
import { mentionsInDraft, type Picked } from './mentionDraft.ts';

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
  canComment,
  onReveal,
  open,
  onToggle,
}: {
  thread: CommentThread;
  members: WorkspaceMember[];
  comments: CommentActions;
  /** May delete a message. */
  canEdit: boolean;
  /** May add one, which is the smaller right (ADR-0090). */
  canComment: boolean;
  onReveal: (thread: CommentThread) => void;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  // Beside the draft, and for the same reason it is here: the people named in a
  // comment are part of it until it is sent (ADR-0085).
  const [picked, setPicked] = useState<readonly Picked[]>([]);

  /**
   * Send the reply, from Enter or from the button.
   *
   * One function for both. They were two copies of the same two lines, and the
   * button — which cannot see what the composer knows — would otherwise send
   * the text without the people named in it (ADR-0085).
   */
  const sendReply = (): void => {
    comments.reply(thread.id, draft, mentionsInDraft(draft, picked));
    setDraft('');
    setPicked([]);
  };

  return (
    <li
      className="comment-thread"
      data-detached={isDetached(thread) ? 'true' : undefined}
    >
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
          /*
           * A thread about a canvas item is never "detached".
           *
           * `range === null` means the text a comment pointed at is gone. An
           * item comment has no range by design, so the same test would have
           * struck through every canvas thread and disabled its button — the
           * difference between "cannot be found" and "was never text".
           */
          disabled={isDetached(thread)}
          title={
            thread.item !== null
              ? t('comment.aboutItem')
              : /*
                 * A thread about a place in a PDF says which page (ADR-0151).
                 *
                 * It has no range — it was never text in *this* document — so
                 * without this branch it read as "the text this was about has
                 * been deleted", which is the same wrong sentence ADR-0057 had
                 * to take off the canvas threads. And it keeps its quotation as
                 * its label: a place has words, which is exactly what ADR-0150
                 * came first for.
                 */
                thread.place !== null
                ? t('comment.aboutPlace', { page: thread.place.page })
                : thread.range === null
                  ? t('comment.detached')
                  : t('comment.reveal')
          }
          onClick={() => onReveal(thread)}
        >
          {thread.item !== null ? t('comment.aboutItem') : thread.quote}
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

      {isDetached(thread) && (
        <p className="comment-note">{t('comment.detached')}</p>
      )}

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
                {/* How it arrived, when it did not come from here (ADR-0060).
                  *
                  * Beside the name rather than under the text, because it is a
                  * fact about the message and not part of what was said — and
                  * because quote trimming is guesswork: a reader should be able
                  * to tell that a machine cut a reply rather than that a
                  * colleague wrote something strange. */}
                {message.via === 'email' && (
                  <span className="comment-via" title={t('comment.viaEmail.hint')}>
                    {t('comment.viaEmail')}
                    {message.trimmed === true && ` · ${t('comment.trimmed')}`}
                    {message.hadAttachments === true && ` · ${t('comment.attachmentsDropped')}`}
                  </span>
                )}
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

      {canComment && open && (
        <div className="comment-reply">
          {/* A reply, which is how anybody is addressed — member or guest
              (ADR-0046). It quotes nothing and needs no identity beyond what the
              message it answers already carries, so it cannot reach the wrong
              person. */}
          {/* An `@` names somebody, and the notification says which sentence
              (ADR-0085). The Enter rule moved into the component with it: while
              the list is open Enter picks a person, and otherwise it sends. */}
          <MentionDraftInput
            value={draft}
            picked={picked}
            onChange={(text, chosen) => {
              setDraft(text);
              setPicked(chosen);
            }}
            people={members}
            placeholder={t('comment.replyPlaceholder')}
            onSend={sendReply}
          />
          {/* A button, not only Enter.
            *
            * Enter stays, because a comment is usually one sentence — but a
            * shortcut is the *second* way to do something, never the only one. A
            * box with no button is a box somebody types into and then looks
            * around for what to press. */}
          <div className="comment-actions">
            <button
              type="button"
              className="btn primary"
              disabled={draft.trim() === ''}
              onClick={sendReply}
            >
              {t('comment.reply')}
            </button>
            <button
              type="button"
              className="btn subtle"
              onClick={() => comments.setResolved(thread.id, !thread.resolved)}
            >
              <CheckSquareIcon /> {thread.resolved ? t('comment.reopen') : t('comment.resolve')}
            </button>
            {/* Last, and on its own side: the one thing here that cannot be
                undone by pressing it again. */}
            <button
              type="button"
              className="btn subtle destructive comment-destroy"
              aria-label={t('comment.removeThread')}
              title={t('comment.removeThread')}
              onClick={() => comments.removeOne(thread.id)}
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function CommentsPanel({
  comments,
  internal,
  members,
  canEdit,
  canComment,
  onReveal,
  pending,
  onCancelPending,
  marks,
  pageId,
}: {
  comments: CommentActions;
  members: WorkspaceMember[];
  /**
   * May change the page. Deleting a message hangs on this, and writing one
   * does not — see `canComment`.
   */
  canEdit: boolean;
  /**
   * May write a message (ADR-0090).
   *
   * Split from `canEdit` because the two really are different: somebody given
   * a page to comment on may add to the conversation and may not delete
   * anybody's part of it, including — deliberately — their own. A message
   * somebody could take back after it was answered is a conversation that can
   * be rewritten.
   */
  canComment: boolean;
  onReveal: (thread: CommentThread) => void;
  /** A selection waiting for its first message (ADR-0046). */
  /**
   * The internal threads, in their own document (ADR-0057).
   *
   * One list with these marked, not a second tab: somebody discussing a
   * paragraph wants the discussion, and splitting it by audience makes them
   * look in two places for one conversation.
   */
  internal: CommentActions | null;
  pending: {
    from: Uint8Array;
    to: Uint8Array;
    quote: string;
    /** A canvas item, when the comment is about one (ADR-0046). */
    item?: string;
  } | null;
  onCancelPending: () => void;
  marks: { style: CommentMarkStyle; setStyle: (style: CommentMarkStyle) => void };
  /** Which page's folding is being remembered. */
  pageId: string | null;
}): ReactElement {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  // Beside the draft, and for the same reason it is here: the people named in a
  // comment are part of it until it is sent (ADR-0085).
  const [picked, setPicked] = useState<readonly Picked[]>([]);

  /**
   * Which threads are folded, remembered per page (ADR-0046).
   *
   * Folding is something somebody did on purpose, and a reload undoing it is
   * the application forgetting an instruction. Kept in the browser rather than
   * in the document — a switch stored there would fold a thread for everybody —
   * and the set is of the *closed* ones, so a thread that arrives while nobody
   * is looking is open.
   */
  const { closed, toggle, setAll } = useFoldedThreads(
    pageId,
    comments.threads.map((thread) => thread.id),
  );
  const allClosed = comments.threads.length > 0 && closed.size === comments.threads.length;

  /**
   * The selection somebody pressed Comment on, at the top and focused.
   *
   * The thread does not exist until this is submitted: a thread with an empty
   * first message is a highlight over nothing, and it would arrive on somebody
   * else's screen as exactly that.
   */
  /**
   * Where the next thread goes (ADR-0057).
   *
   * Chosen when it is started and never moved: moving one means copying it into
   * the other document and deleting it here, and the copy cannot take back what
   * the guests who already synced the page have. A control that appears to make
   * a discussion private after the fact is the most dangerous thing this could
   * offer.
   *
   * Remembered per page, because a team that has decided to talk internally
   * about a draft is going to do it more than once.
   */
  const [startInternal, setStartInternal] = useState(false);
  useEffect(() => {
    setStartInternal(false);
  }, [pageId]);

  /**
   * Start the thread, from Enter or from the button.
   *
   * One function for both, because the two used to be two copies of the same
   * three lines — and the button, which cannot see what the composer knows,
   * would otherwise send the text without the people named in it (ADR-0085).
   */
  const send = (): void => {
    startThread(draft, mentionsInDraft(draft, picked));
    setDraft('');
    setPicked([]);
    onCancelPending();
  };

  const startThread = (text: string, mentions: string[]): void => {
    if (!pending) return;
    // The document the choice names, not whichever set the panel was handed:
    // this is the line that decides who can read what follows.
    const into = startInternal && internal ? internal : comments;
    into.start(pending, text, mentions);
  };

  const start = pending ? (
    <section className="panel-section">
      <div className="comment-thread" data-pending="true">
        {/* What this will be about. A canvas item has no words to quote, so it
            says which kind of thing it is instead of showing an empty line
            where a quotation belongs. */}
        <p className="comment-quote" aria-hidden={pending.item ? undefined : true}>
          {pending.item ? t('comment.aboutItem') : pending.quote}
        </p>
        <MentionDraftInput
          value={draft}
          picked={picked}
          onChange={(text, chosen) => {
            setDraft(text);
            setPicked(chosen);
          }}
          people={members}
          autoFocus
          placeholder={t('comment.startPlaceholder')}
          onEscape={() => {
            onCancelPending();
            setDraft('');
            setPicked([]);
          }}
          onSend={send}
        />
        {/* Who will be able to read it, beside the button that starts it.
          *
          * Only offered when there is an internal document to write into — for
          * a share-link visitor there is none, and a choice with one option is
          * a control that teaches somebody the wrong thing about what they
          * have. */}
        {internal && (
          <label className="checkbox comment-internal-choice">
            <input
              type="checkbox"
              checked={startInternal}
              onChange={(event) => setStartInternal(event.target.checked)}
            />
            {t('comment.startInternal')}
          </label>
        )}

        <div className="comment-actions">
          <button
            type="button"
            className="btn primary"
            disabled={draft.trim() === ''}
            onClick={() => {
              send();
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
    /** Whose document these came from, and where a reply goes. */
    source: CommentActions,
    /** Marked as internal, by a word rather than a colour (ADR-0057). */
    isInternal = false,
  ): ReactElement | null =>
    threads.length === 0 ? null : (
      <section className="panel-section">
        <h3 className="panel-heading">
          {t(key)}
          {/* A word, not a colour: a colour is a convention nobody has learnt
              yet, and this is the one distinction in the panel where being
              wrong is a disclosure. */}
          {isInternal && <span className="comment-internal">{t('comment.internal')}</span>}
        </h3>
        <ul className="comment-list">
          {threads.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              members={members}
              comments={source}
              canEdit={canEdit}
              canComment={canComment}
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
        {/* One control, not two.
          *
          * There was a checkbox for "mark commented passages" *and* a "not at
          * all" option in the list below it — two controls for one decision,
          * which is why the tick appeared to keep coming back: unticking it and
          * choosing "not at all" were the same thing said twice, and the two
          * could disagree. The list says all three states on its own. */}
        <label className="comment-marks-label" htmlFor="comment-marks">
          {t('comment.markStyle')}
        </label>

        {comments.threads.length > 1 && (
          <button
            type="button"
            className="btn subtle comment-fold-all"
            onClick={() => setAll(!allClosed)}
          >
            {allClosed ? t('comment.expandAll') : t('comment.collapseAll')}
          </button>
        )}

        <select
          id="comment-marks"
          className="comment-marks-style"
          value={marks.style}
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
      {/* One list, internal threads among them and marked (ADR-0057).
        *
        * The actions come from whichever document a thread belongs to, which is
        * why the group takes the set it came from rather than always
        * `comments`: a reply to an internal thread has to be written into the
        * internal document, and passing the wrong one would write it where
        * everybody can read it. */}
      {group('comment.open', comments.open, comments)}
      {internal && group('comment.open', internal.open, internal, true)}
      {/* Between the open threads and the resolved ones, deliberately: a
          detached thread is unfinished business, not a decision. */}
      {group('comment.detachedHeading', comments.detached, comments)}
      {internal && group('comment.detachedHeading', internal.detached, internal, true)}
      {group('comment.resolvedHeading', comments.resolved, comments)}
      {internal && group('comment.resolvedHeading', internal.resolved, internal, true)}
    </>
  );
}
