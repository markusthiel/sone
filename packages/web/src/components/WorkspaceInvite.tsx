/**
 * SONE web — inviting somebody to this workspace.
 *
 * Separate from inviting somebody to the instance (ADR-0025). This one names a
 * workspace and a role, and it works whether or not the person already has an
 * account: with one they are asked to join, without one they register first and
 * land in both their own workspace and this one.
 */

import { useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { PendingInvitations } from './PendingInvitations.tsx';

const ROLES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'member', label: 'Member', hint: 'Can read and write everything not restricted' },
  { id: 'admin', label: 'Admin', hint: 'Can also manage people and permissions' },
  { id: 'guest', label: 'Guest', hint: 'Sees only what they are given access to' },
];

export function WorkspaceInvite({ workspaceId }: { workspaceId: string }): ReactElement {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped after one is created, so the list beside this form includes it
  // without the form having to know the list exists.
  const [created, setCreated] = useState(0);

  const invite = (): void => {
    setBusy(true);
    setError(null);
    setLink(null);

    void api
      .inviteToWorkspace(workspaceId, { email: email.trim() || null, role })
      // Built from where the browser is, not from the server's configured
      // public URL: behind a proxy those differ, and a link nobody can open is
      // worse than no link.
      .then((result) => {
        setLink(`${window.location.origin}${paths.signup(result.token)}`);
        setCreated((previous) => previous + 1);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Invite somebody here</h3>
      <p className="muted">
        Works whether or not they already have an account. With one, the link
        asks them to join and their own workspace is untouched. Without one,
        they register first and end up in both.
      </p>

      {error && <p className="error">{messageFor(error)}</p>}

      <div className="field">
        <label htmlFor="ws-invite-email">Email address (optional)</label>
        <input
          id="ws-invite-email"
          type="email"
          value={email}
          placeholder="someone@example.org"
          onChange={(event) => {
            setLink(null);
            setEmail(event.target.value);
          }}
        />
        <p className="muted">
          With an address the invitation is for that person and can be used once
          — and only they can accept it, even if somebody else opens the link.
        </p>
      </div>

      <div className="field">
        <label htmlFor="ws-invite-role">They join as</label>
        <select
          id="ws-invite-role"
          value={role}
          onChange={(event) => {
            setLink(null);
            setRole(event.target.value);
          }}
        >
          {ROLES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="muted">{ROLES.find((r) => r.id === role)?.hint}</p>
      </div>

      <div className="settings-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={invite}>
          {busy ? 'Creating…' : 'Create invitation'}
        </button>
      </div>

      {link && (
        <div className="field">
          <label htmlFor="ws-invite-link">Invitation link</label>
          <input
            id="ws-invite-link"
            readOnly
            value={link}
            onFocus={(event) => event.target.select()}
          />
          <p className="muted">
            Copy it now — the server keeps only a hash of it, so it cannot be
            shown again. Send it yourself; this instance does not send mail.
          </p>
        </div>
      )}

      {/* What has been sent and not yet used up. Both forms produced a link and
          then forgot it, so one sent to the wrong address stayed valid until it
          expired and nothing said it existed (ADR-0025). */}
      <PendingInvitations workspaceId={workspaceId} reloadToken={created} />
    </section>
  );
}
