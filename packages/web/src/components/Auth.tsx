/**
 * SONE web — authentication screens.
 *
 * Error messages come from a code table, not from the server (ADR-0011). The
 * server sends `invalid_credentials`; the wording is the client's.
 */

import { useState, type FormEvent , type ReactElement } from 'react';

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
  unknown_error: 'Something went wrong.',
};

export const messageFor = (code: string): string =>
  MESSAGES[code] ?? MESSAGES['unknown_error']!;

interface AuthFormProps {
  onDone: () => void;
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
      await api.signup({
        email,
        password,
        displayName,
        ...(invitationToken ? { invitationToken } : {}),
      });
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
