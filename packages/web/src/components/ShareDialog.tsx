/**
 * SONE web — sharing a page.
 *
 * The interesting part of this dialog is what it does with a token it will
 * never see again. Only the hash is stored, so the string returned when a link
 * is created is the only copy that will ever exist — the same as a password.
 * So it is shown prominently, once, with the fact stated rather than implied,
 * and the copy button is the primary action.
 *
 * Existing links are listed without their tokens, because there is nothing to
 * list: they cannot be recovered. What can be shown is what each link *does*,
 * which is the question somebody actually has when they find one — who can use
 * it, whether it covers subpages, and how many people are using it right now.
 */

import type { MessageKey } from '../i18n/messages.en.ts';
import { useT } from '../i18n/useT.tsx';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type CreatedShareLink, type ShareLink } from '../api/client.ts';
import { messageFor } from './Auth.tsx';
import { PagePermissions } from './PagePermissions.tsx';

interface ShareDialogProps {
  pageId: string;
  /**
   * How many comment threads the page carries (ADR-0046).
   *
   * Counted by the caller, which already has the page's document open — the
   * dialog would otherwise fetch a page it is only being asked about.
   */
  threadCount: number;
  pageTitle: string;
  /** For the list of people who could be given access. */
  workspaceId: string;
  /**
   * Whether this instance has a mail relay (ADR-0126).
   *
   * Without one the send form is *absent* rather than disabled — ADR-0059's
   * rule for the password reset, applied to the other thing that needs a relay.
   * A control that can only ever fail is worse than one that is not there.
   */
  canSendMail?: boolean;
  onClose: () => void;
}

/**
 * What a link allows, keyed by the role the server stores.
 *
 * Keys rather than sentences, and the *same* keys the page-permissions screen
 * uses: these were English strings in a translated interface — a Record of
 * plain values, which is why the translation guard did not see them — and two
 * lists of role names would eventually disagree about what a role allows.
 */
const ROLE_LABELS: Record<string, MessageKey> = {
  viewer: 'access.viewer',
  commenter: 'access.commenter',
  editor: 'access.editor',
};

/** The minimum the server enforces, stated here so it is not discovered. */
const MIN_PASSWORD_LENGTH = 12;

export function ShareDialog({
  pageId,
  threadCount,
  pageTitle,
  workspaceId,
  canSendMail,
  onClose,
}: ShareDialogProps): ReactElement {
  const { t } = useT();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Which existing link was copied last, for the button's own feedback. */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** The link whose URL is on screen, if any. */
  const [revealed, setRevealed] = useState<{ linkId: string; url: string } | null>(null);
  const [unrecoverable, setUnrecoverable] = useState(false);

  /**
   * Show an existing link, and copy it if the browser allows.
   *
   * Showing it is the point; copying is the convenience. The first version only
   * copied, and it silently did nothing on iOS and Safari: a clipboard write has
   * to happen inside the user's own activation, and awaiting a network request
   * first spends it. Nothing failed visibly — the button simply had no effect.
   *
   * Revealing the URL removes the dependency on that entirely. It is selectable,
   * so it can be copied by hand or read aloud, and the clipboard attempt is
   * allowed to fail without anybody being stuck.
   *
   * The URL is fetched rather than shipped with the list of links: sending every
   * token to everyone who opens this dialog would put them in memory, in logs
   * and in any error report for nothing.
   */
  const revealExisting = async (linkId: string): Promise<void> => {
    setUnrecoverable(false);
    try {
      const { url } = await api.shareLinkUrl(pageId, linkId);
      setRevealed({ linkId, url });

      // Best effort, after the URL is on screen. If the activation has expired
      // — which it has, on iOS — this does nothing and the URL is still there.
      try {
        await navigator.clipboard.writeText(url);
        setCopiedId(linkId);
      } catch {
        setCopiedId(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'token_not_recoverable') {
        setUnrecoverable(true);
        return;
      }
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const [role, setRole] = useState('viewer');
  const [includeSubtree, setIncludeSubtree] = useState(true);
  const [password, setPassword] = useState('');
  /*
   * Thirty days, not never (ADR-0126).
   *
   * A link with no expiry is a permanent grant made in a hurry, and the person
   * making it is usually thinking about the next twenty minutes. Both answers
   * are one dropdown apart; the difference is which one somebody gets by not
   * deciding, and a grant that lapses is the safer of the two to leave
   * undecided.
   */
  const [expiry, setExpiry] = useState('30');

  /** Sending a link to somebody (ADR-0126). */
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  /** Which link went to whom, so the note appears under that link and no other. */
  const [sentTo, setSentTo] = useState<{ linkId: string; to: string } | null>(null);

  const sendLink = async (linkId: string): Promise<void> => {
    setBusy(true);
    try {
      await api.sendShareLink(pageId, linkId, { to: to.trim(), note: note.trim() });
      setSentTo({ linkId, to: to.trim() });
      setTo('');
      setNote('');
      setSendingId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      setLinks((await api.shareLinks(pageId)).links);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const passwordTooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const createLink = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.createShareLink(pageId, {
        role,
        includeSubtree,
        password: password.length > 0 ? password : null,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      });
      setCreated(result);
      setPassword('');
      setCopied(false);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused, and on a page served over plain http
      // it is not available at all. The link stays selectable, so this is a
      // missing convenience rather than a dead end.
      setError('clipboard_unavailable');
    }
  };

  const revoke = async (linkId: string): Promise<void> => {
    try {
      await api.revokeShareLink(pageId, linkId);
      // If the revoked link is the one just created, its token is no longer
      // useful and showing it would invite someone to send a dead link.
      setCreated((previous) => (previous?.id === linkId ? null : previous));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  return (
    <div
      className="dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog share-dialog" role="dialog" aria-modal="true" aria-label={t('share.label')}>
        {/* Was an English sentence with the quotation marks written into the
            JSX, which is why no translation existed to miss: the guard reads
            text nodes, and this one had an expression in the middle of it. */}
        <h2 className="dialog-title">
          {t('share.heading', { title: pageTitle || t('page.untitled') })}
        </h2>

        {/* What a link gives away, where the link is made (ADR-0046).
          *
          * The moment a share link is handed out, every existing comment on the
          * page is visible to whoever holds it — a team that has been
          * discussing a draft and then sends the link to a client has published
          * that discussion.
          *
          * With the count, for the same reason the trash button carries one:
          * the fact that changes the decision belongs where the decision is
          * made. And only when there are comments, because a warning that
          * appears every time is a warning nobody reads. */}
        {threadCount > 0 && (
          <p className="share-warning">
            {t('share.commentsVisible', { count: threadCount })}
          </p>
        )}

        {error && <p className="error">{messageFor(error)}</p>}

        {/* People inside the workspace, before links for people outside.
          *
          * The same question asked twice — who gets to see this — and answering
          * it in two places is how somebody sets one and believes they have set
          * the other. The common case is also the first one. */}
        <PagePermissions pageId={pageId} workspaceId={workspaceId} />

        <h3 className="settings-heading">{t('share.anyoneWithLink')}</h3>

        {/* The new link, shown once. */}
        {created && (
          <div className="share-created">
            <p className="share-created-label">
              {t('share.created')}
            </p>
            <div className="share-created-row">
              <input readOnly value={created.url} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn primary" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <section className="share-new">
          <h3 className="admin-subheading">{t('share.new')}</h3>

          <div className="field">
            <label htmlFor="share-role">{t('share.allows')}</label>
            <select
              id="share-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
            {/* Administration is deliberately absent: it is not something a
                forwarded URL should confer. */}
          </div>

          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={includeSubtree}
                onChange={(event) => setIncludeSubtree(event.target.checked)}
              />{' '}
              Include subpages
            </label>
            <span className="muted settings-note">
              {t('share.subpages.hint')}
            </span>
          </div>

          <div className="field">
            <label htmlFor="share-expiry">{t('share.expires')}</label>
            <select
              id="share-expiry"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            >
              <option value="never">{t('share.never')}</option>
              <option value="1">{t('share.inADay')}</option>
              <option value="7">{t('share.inAWeek')}</option>
              <option value="30">{t('share.inAMonth')}</option>
              <option value="365">{t('share.inAYear')}</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="share-password">Password (optional)</label>
            <input
              id="share-password"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            {passwordTooShort && (
              <span className="error">
                At least {MIN_PASSWORD_LENGTH} characters — a link password
                protects the same content an account password does.
              </span>
            )}
          </div>

          <button
            type="button"
            className="btn primary"
            disabled={busy || passwordTooShort}
            onClick={() => void createLink()}
          >
            {t('share.create')}
          </button>
        </section>

        <section className="share-existing">
          <h3 className="admin-subheading">{t('share.existing')}</h3>

          {!links && <p className="muted">{t('trash.loading')}</p>}
          {links?.length === 0 && <p className="muted">{t('share.notShared')}</p>}

          {links?.map((link) => (
            <div className="admin-row" key={link.id}>
              <div className="admin-row-main">
                <span className="admin-name">
                  {/* The raw value when the server sends a role this build does
                      not know: a name nobody can read beats a blank. */}
                  {(() => {
                    const key = ROLE_LABELS[link.role];
                    return key ? t(key) : link.role;
                  })()}
                </span>
                <span className="admin-meta">
                  {link.includeSubtree ? 'with subpages' : 'this page only'}
                  {link.hasPassword && ' · password'}
                  {link.expiresAt
                    ? ` · until ${new Date(link.expiresAt).toLocaleDateString()}`
                    : ' · no expiry'}
                  {/* The useful number: "four people are using this right now"
                      is actionable, an opaque id is not. */}
                  {link.activeSessions > 0 &&
                    ` · in use by ${link.activeSessions}`}
                  {link.scopePageId !== pageId && ' · on a subpage'}
                </span>
              </div>
              <div className="admin-row-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void revealExisting(link.id)}
                >
                  {revealed?.linkId === link.id ? 'Shown' : 'Show link'}
                </button>
                {/* Absent without a relay, not disabled (ADR-0059). */}
                {canSendMail && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSentTo(null);
                      setSendingId(sendingId === link.id ? null : link.id);
                    }}
                  >
                    {t('share.byMail')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn destructive"
                  onClick={() => void revoke(link.id)}
                >
                  {t('share.revoke')}
                </button>
              </div>

              {/* Sending it (ADR-0126).
                *
                * Per link rather than one form at the foot, because "which
                * link" is the whole question: a page can carry a viewer link
                * and an editor link, and mailing the wrong one hands somebody
                * more than was meant.
                *
                * The link itself is not in this form and never leaves the
                * browser: the server decrypts the one it holds. */}
              {sendingId === link.id && (
                <div className="share-send">
                  <p className="settings-note">{t('share.byMail.note')}</p>
                  <div className="field">
                    <label htmlFor={`share-to-${link.id}`}>{t('share.byMail.to')}</label>
                    <input
                      id={`share-to-${link.id}`}
                      type="email"
                      autoComplete="email"
                      value={to}
                      onChange={(event) => setTo(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`share-note-${link.id}`}>{t('share.byMail.message')}</label>
                    <input
                      id={`share-note-${link.id}`}
                      value={note}
                      maxLength={500}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || to.trim().length === 0}
                    onClick={() => void sendLink(link.id)}
                  >
                    {t('share.byMail.send')}
                  </button>
                </div>
              )}

              {sentTo?.linkId === link.id && sendingId === null && (
                <p className="muted">{t('share.byMail.sent', { to: sentTo.to })}</p>
              )}

              {revealed?.linkId === link.id && (
                <div className="share-revealed">
                  {/* Readable and selectable, wrapping so the whole URL is
                      visible. A field that truncates a link is a field somebody
                      cannot check, and a token is exactly the thing worth
                      checking before sending it to a colleague. */}
                  <code className="share-url">{revealed.url}</code>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      // The URL is already in hand, so this writes inside the
                      // activation and works where the earlier version did not.
                      void navigator.clipboard
                        .writeText(revealed.url)
                        .then(() => setCopiedId(link.id))
                        .catch(() => setError('clipboard_unavailable'));
                    }}
                  >
                    {copiedId === link.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          ))}

          {unrecoverable && (
            <p className="muted settings-note">
            {t('share.tooOld')}
            </p>
          )}

          <p className="muted settings-note">
            {t('share.revoke.hint')}
          </p>
        </section>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('action.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
