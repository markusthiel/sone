/**
 * SONE web — inviting somebody to the instance.
 *
 * An account here, and their own workspace, without a decision about which team
 * they belong to. That is the thing that could not be expressed before
 * (ADR-0025): every invitation named a workspace, so inviting somebody always
 * meant placing them.
 */

import { useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';

export function InvitePanel(): ReactElement {
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      .then((result) => setLink(`${window.location.origin}${paths.signup(result.token)}`))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  return (
    <section className="settings-section">
      <p className="muted">
        Invite somebody to this instance. They get an account and a workspace of
        their own — nothing else. Adding them to a team is a separate step, made
        by whoever runs that team.
      </p>

      {error && <p className="error">{messageFor(error)}</p>}

      <div className="field">
        <label htmlFor="invite-email">Email address (optional)</label>
        <input
          id="invite-email"
          type="email"
          value={email}
          placeholder="someone@example.org"
          onChange={(event) => {
            setLink(null);
            setEmail(event.target.value);
          }}
        />
        <p className="muted">
          With an address the invitation is for that person and can be used once.
          Without one it is a link anybody holding it may use, which is how you
          invite a group without typing every address.
        </p>
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
        <div className="field">
          <label htmlFor="invite-link">Invitation link</label>
          <input id="invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
          <p className="muted">
            Copy it now — it is not stored anywhere it can be read again. Send it
            to the person yourself; this instance does not send mail.
          </p>
        </div>
      )}
    </section>
  );
}
