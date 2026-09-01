/**
 * SONE web — accepting an invitation when you already have an account.
 *
 * Following an invitation link while signed in used to do nothing visible: the
 * sign-up route only rendered for anonymous visitors, so somebody with an
 * account landed in their own workspace with no sign the link had meant
 * anything. The invitation was not consumed and nothing said why.
 */

import { useT } from '../i18n/useT.tsx';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';

interface Props {
  token: string;
  navigate: (path: string) => void;
  /** Given the workspace joined, so the caller can land there. */
  onJoined: (workspaceId: string | null) => void;
}

export function AcceptInvitation({ token, navigate, onJoined }: Props): ReactElement {
  const { t } = useT();
  const [invitation, setInvitation] = useState<{
    workspaceName: string | null;
    instanceOnly: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spent, setSpent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .inspectInvitation(token)
      .then((result) => {
        if (!cancelled) setInvitation(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A token that no longer resolves, seen by somebody who is signed in.
        //
        // Almost always an invitation that has already been used — often by
        // this very person, a moment ago. "Something went wrong" after
        // everything went right is worse than saying nothing, so this says what
        // it is and offers the way on.
        if (err instanceof ApiError && (err.code === 'invalid_invitation' || err.code === 'not_found')) {
          setSpent(true);
          return;
        }
        setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = (): void => {
    setBusy(true);
    setError(null);
    void api
      .acceptInvitation(token)
      .then((result) => {
        // Straight to the workspace, because that is what somebody just
        // accepted and looking at it is how they know it worked. Without it
        // they arrive in their own — a member of the team they joined, looking
        // at nothing to do with it.
        onJoined(result.workspaceId);
        // Home, which opens whichever workspace the reload settles on. There
        // is no path to a workspace by id — workspaces are chosen in the
        // switcher, not addressed — and inventing one here would be a route
        // nothing else uses.
        navigate(paths.home());
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="centered">
      <div className="card">
        <h1>{t('invitation.title')}</h1>

        {error && <p className="error">{messageFor(error)}</p>}

        {/* An invitation to the instance, followed by somebody who already has
          * an account, has nothing left to give. Said plainly rather than
          * refused: nothing is wrong, it simply happened already. */}
        {spent && (
          <>
            <p>
              This invitation has already been used. If that was you just now,
              your account is ready.
            </p>
            <button type="button" className="btn primary" onClick={() => navigate('/')}>
              {t('action.continue')}
            </button>
          </>
        )}

        {invitation?.instanceOnly && (
          <>
            <p>{t('invitation.alreadyMember')}</p>
            <button type="button" className="btn primary" onClick={() => navigate('/')}>
              {t('action.continue')}
            </button>
          </>
        )}

        {invitation && !invitation.instanceOnly && (
          <>
            <p>
              You have been invited to join{' '}
              <strong>{invitation.workspaceName ?? 'a workspace'}</strong>.
            </p>
            <p className="muted">
              Your own workspace stays where it is. Joining adds this one beside
              it.
            </p>
            <div className="settings-actions">
              <button type="button" className="btn primary" disabled={busy} onClick={accept}>
                {busy ? 'Joining…' : 'Join'}
              </button>
              {/* Declining is navigating away. There is nothing to record: an
                * invitation nobody accepts expires on its own, and a "declined"
                * state would be a thing to store, show and explain. */}
              <button type="button" className="btn" onClick={() => navigate('/')}>
                {t('action.notNow')}
              </button>
            </div>
          </>
        )}

        {!invitation && !error && !spent && <p className="muted">Checking the invitation…</p>}
      </div>
    </div>
  );
}
