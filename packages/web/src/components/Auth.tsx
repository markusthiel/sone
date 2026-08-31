/**
 * SONE web — authentication screens.
 *
 * Error messages come from a code table, not from the server (ADR-0011). The
 * server sends `invalid_credentials`; the wording is the client's.
 */

import { useEffect, useState, type FormEvent , type ReactElement } from 'react';

import { ApiError, api, type InstanceInfo } from '../api/client.ts';
import { paths } from '../routes/paths.ts';

/**
 * Message catalogue.
 *
 * English only for now. This is the table an ICU catalogue replaces, and
 * keeping the indirection from the start means adding a language is a file
 * rather than a refactor.
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password combination did not work.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  weak_password: 'Passwords need to be at least 12 characters.',
  missing_fields: 'Please fill in every field.',
  invitation_invalid: 'This invitation has expired or has already been used.',
  no_workspace: 'Your account is not a member of any workspace yet.',
  network_error: 'Could not reach the server.',
  invalid_role: 'A share link cannot grant that role.',
  too_many_rows: 'That is more than fifty entries. Paste them in smaller pieces.',
  not_archived: 'That entry is not in the trash.',
  parent_missing:
    'The folder this was in is gone. Restore that folder first, or move this ' +
    'somewhere else.',
  clipboard_unavailable:
    'Could not copy automatically. Select the link and copy it by hand.',
  file_too_large: 'That file is too large.',
  proxy_rejected_size:
    'The web server in front of SONE refused the file for being too large. ' +
    'Its upload limit is separate from SONE’s — with nginx it is ' +
    'client_max_body_size, which allows only 1 MB unless it is raised.',
  proxy_error:
    'Something between the browser and SONE rejected the request. Check the ' +
    'reverse proxy’s log rather than SONE’s.',
  unsupported_file_type: 'That file type is not supported.',
  empty_file: 'That file is empty.',
  storage_unavailable:
    'SONE could not write the file to disk. The server log names the directory; ' +
    'the usual cause is a volume whose ownership does not match the user in ' +
    'the container.',
  file_missing_from_storage:
    'The file is recorded but missing from storage. The instance may have been ' +
    'restored without its files.',
  unknown_error: 'Something went wrong.',
};

export const messageFor = (code: string): string =>
  MESSAGES[code] ?? MESSAGES['unknown_error']!;

interface AuthFormProps {
  /**
   * Where to land, when signing up decided it.
   *
   * An invitation names a workspace, and somebody who has just accepted one
   * should arrive there rather than in their own — they were invited, and their
   * own workspace is not what they clicked the link for.
   */
  onDone: (workspaceId?: string) => void;
  navigate: (to: string) => void;
}

export function SetupScreen({ onDone }: AuthFormProps): ReactElement {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setup({ email, password, displayName, workspaceName });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="card" onSubmit={submit}>
        <h1>Set up SONE</h1>
        <p className="muted">
          This creates the first workspace and its owner. It can only be done once.
        </p>

        <div className="field">
          <label htmlFor="ws">Workspace name</label>
          <input
            id="ws"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            required
            autoComplete="organization"
          />
        </div>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          />
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            At least 12 characters. Length beats complexity.
          </span>
        </div>

        {error && <p className="error">{messageFor(error)}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Setting up…' : 'Create workspace'}
        </button>
      </form>
    </div>
  );
}

export function LoginScreen({
  onDone,
  instance,
}: AuthFormProps & { instance: InstanceInfo }): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Whether this instance has a provider.
   *
   * Fetched rather than passed in with the rest of the instance information,
   * because the sign-in page is the only place that needs it and everywhere
   * else would then carry it. A failure leaves the button absent, which is the
   * same as not having one — the password form is unaffected either way.
   */
  const [sso, setSso] = useState<{ enabled: boolean; buttonLabel: string | null }>({
    enabled: false,
    buttonLabel: null,
  });

  useEffect(() => {
    let cancelled = false;
    void api
      .oidcConfig()
      .then((config) => {
        if (!cancelled) setSso(config);
      })
      .catch(() => {
        // No button. The password form is what matters here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login({ email, password });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="card" onSubmit={submit}>
        <h1>Sign in</h1>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {error && <p className="error">{messageFor(error)}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {/* The provider, when there is one.
          *
          * Below the password form rather than instead of it: both ways in stay
          * available, and an instance whose only door is somebody else's
          * service cannot be repaired when that service is unreachable
          * (ADR-0024).
          *
          * A link, not a button — it is a navigation to the provider, and the
          * browser should treat it as one. */}
        {sso.enabled && (
          <>
            <p className="auth-or muted">or</p>
            <a className="btn sso" href="/api/auth/oidc/start">
              {sso.buttonLabel ?? 'Single sign-on'}
            </a>
          </>
        )}

        {instance.signupMode === 'open' && (
          <p className="muted">
            No account? <a href={paths.signup()}>Create one</a>.
          </p>
        )}
      </form>
    </div>
  );
}

export function SignupScreen({
  onDone,
  invitationToken,
}: AuthFormProps & { invitationToken: string | null }): ReactElement {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.signup({
        email,
        password,
        displayName,
        ...(invitationToken ? { invitationToken } : {}),
      });
      // The workspace the server decided on: the invited one when there was an
      // invitation, their own otherwise.
      onDone(created.workspaceId);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="card" onSubmit={submit}>
        <h1>Create an account</h1>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="error">{messageFor(error)}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted">
          Already have an account? <a href={paths.login()}>Sign in</a>.
        </p>
      </form>
    </div>
  );
}
