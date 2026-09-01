/**
 * SONE web — inviting somebody to the instance.
 *
 * An account here, and their own workspace, without a decision about which team
 * they belong to. That is the thing that could not be expressed before
 * (ADR-0025): every invitation named a workspace, so inviting somebody always
 * meant placing them.
 */

import { useT } from '../i18n/useT.tsx';
import { useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { PendingInvitations } from './PendingInvitations.tsx';

export function InvitePanel(): ReactElement {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(0);

  const invite = (): void => {
    setBusy(true);
    setError(null);
    setLink(null);

    void api
      .inviteToInstance({ email: email.trim() || null })
      // The existing sign-up path, not a new one. An invitation link has led
      // there since invitations existed, and a second route to the same place
      // would be a second thing to keep working.
      //
      // Built from the address bar rather than by the server, which knows its
      // configured public URL and not necessarily the one somebody reached it
      // by — behind a proxy those differ, and a link nobody can open is worse
      // than no link.
      .then((result) => {
        setLink(`${window.location.origin}${paths.signup(result.token)}`);
        setCreated((previous) => previous + 1);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  return (
    <section className="settings-section">
      <p className="muted">
        {t('invite.instance.note')}
      </p>

      {error && <p className="error">{messageFor(error)}</p>}

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('invite.email')}</b>
            <span>
              {t('invite.address.note')}
            </span>
          </span>
          <input
            id="invite-email"
            aria-label={t('invite.email')}
            type="email"
            value={email}
            placeholder={t('invite.emailPlaceholder')}
            onChange={(event) => {
              setLink(null);
              setEmail(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="settings-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={invite}>
          {busy ? 'Creating…' : 'Create invitation'}
        </button>
      </div>

      {/* Shown once, and said so.
        *
        * The server stores a hash, so this cannot be recovered later — telling
        * somebody that after they have closed the panel would be too late to be
        * useful. */}
      {link && (
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('invite.link')}</b>
              <span>
                Copy it now — it is not stored anywhere it can be read again.
                Send it to the person yourself; this instance does not send mail.
              </span>
            </span>
            <input
              id="invite-link"
              aria-label={t('invite.link')}
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>
      )}

      {/* Null: the invitations that name no workspace (ADR-0025). Same rows and
          same component as a workspace's, because the difference between the two
          invitations is which list to ask for and not how a row looks. */}
      <PendingInvitations workspaceId={null} reloadToken={created} />
    </section>
  );
}
