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
  /**
   * How many people the link is for (ADR-0147).
   *
   * Held as typed rather than as a number, so that clearing the field to type
   * a different figure does not become a 1 under the cursor. What is sent is
   * the parsed value, and the server refuses anything that is not a count.
   */
  const [maxUses, setMaxUses] = useState('1');
  const [link, setLink] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(0);

  const address = email.trim();

  const invite = (): void => {
    setBusy(true);
    setError(null);
    setLink(null);
    setSentTo(null);

    void api
      // An addressed invitation is for that person and is used once, so the
      // number is not sent with one — the server would ignore it, and a request
      // that carries a figure nothing reads is how a figure comes to be
      // believed.
      .inviteToInstance({
        email: address || null,
        ...(address ? {} : { maxUses: Number(maxUses) }),
      })
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
        // What actually happened, rather than what this screen used to assume
        // (ADR-0147). The route has sent the invitation since ADR-0121 and says
        // so; the panel claimed the instance never sends mail.
        setSentTo(result.mailed ? address : null);
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

        {/* Only for a link (ADR-0147).
          *
          * With an address the invitation is for that person and is used once,
          * whatever this said — and a control that cannot change anything is one
          * somebody sets and then wonders about, which is the argument ADR-0027
          * made about the administrator checkbox. */}
        {address === '' && (
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('invite.maxUses')}</b>
              <span>{t('invite.maxUses.hint')}</span>
            </span>
            <input
              id="invite-max-uses"
              aria-label={t('invite.maxUses')}
              type="number"
              min={1}
              max={1000}
              value={maxUses}
              onChange={(event) => {
                setLink(null);
                setMaxUses(event.target.value);
              }}
            />
          </div>
        )}
      </div>

      <div className="settings-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={invite}>
          {busy ? t('invite.creating') : t('invite.create')}
        </button>
      </div>

      {/* Shown once, and said so.
        *
        * The server stores a hash, so this cannot be recovered later — telling
        * somebody that after they have closed the panel would be too late to be
        * useful. */}
      {link && (
        <div className="settings-card invite-created">
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('invite.link')}</b>
              <span>
                {sentTo === null
                  ? t('invite.link.note')
                  : t('invite.link.mailed', { address: sentTo })}
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
