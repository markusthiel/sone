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

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type CreatedShareLink, type ShareLink } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

interface ShareDialogProps {
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  viewer: 'Can read',
  commenter: 'Can read and comment',
  editor: 'Can edit',
};

/** The minimum the server enforces, stated here so it is not discovered. */
const MIN_PASSWORD_LENGTH = 12;

export function ShareDialog({
  pageId,
  pageTitle,
  onClose,
}: ShareDialogProps): ReactElement {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [role, setRole] = useState('viewer');
  const [includeSubtree, setIncludeSubtree] = useState(true);
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('never');

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
      <div className="dialog share-dialog" role="dialog" aria-modal="true" aria-label="Share">
        <h2 className="dialog-title">Share “{pageTitle || 'Untitled'}”</h2>

        {error && <p className="error">{messageFor(error)}</p>}

        {/* The new link, shown once. */}
        {created && (
          <div className="share-created">
            <p className="share-created-label">
              Copy this now — it is shown once and cannot be shown again.
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
          <h3 className="admin-subheading">New link</h3>

          <div className="field">
            <label htmlFor="share-role">What it allows</label>
            <select
              id="share-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
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
              On by default, because a link that stops working the moment
              somebody adds a subpage is worse than one that covers slightly
              more than expected.
            </span>
          </div>

          <div className="field">
            <label htmlFor="share-expiry">Expires</label>
            <select
              id="share-expiry"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            >
              <option value="never">Never</option>
              <option value="1">In a day</option>
              <option value="7">In a week</option>
              <option value="30">In a month</option>
              <option value="365">In a year</option>
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
            Create link
          </button>
        </section>

        <section className="share-existing">
          <h3 className="admin-subheading">Existing links</h3>

          {!links && <p className="muted">Loading…</p>}
          {links?.length === 0 && <p className="muted">This page is not shared.</p>}

          {links?.map((link) => (
            <div className="admin-row" key={link.id}>
              <div className="admin-row-main">
                <span className="admin-name">{ROLE_LABELS[link.role] ?? link.role}</span>
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
                  className="btn destructive"
                  onClick={() => void revoke(link.id)}
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}

          <p className="muted settings-note">
            Revoking takes effect at once, including for anyone reading through
            the link at that moment. Links cannot be shown again after they are
            created — only the hash is kept, so a lost link is replaced rather
            than recovered.
          </p>
        </section>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
