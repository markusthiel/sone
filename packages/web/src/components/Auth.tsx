/**
 * SONE web — authentication screens.
 *
 * Error messages come from a code table, not from the server (ADR-0011). The
 * server sends `invalid_credentials`; the wording is the client's.
 */

import { useEffect, useState, type FormEvent , type ReactElement } from 'react';

import { ApiError, api, type InstanceInfo } from '../api/client.ts';
import { en, type MessageKey } from '../i18n/messages.en.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';

/**
 * The English wording for an error code.
 *
 * The table itself moved into the message catalogue (ADR-0041), which is where a
 * translated one has to live. This stays because the screens that show it before
 * anybody has signed in are outside the locale provider: there is no session to
 * ask a language of yet, and a hook cannot be called from a module-level helper
 * either.
 *
 * Everything inside the application uses `useMessage`, which is this with the
 * catalogue behind it.
 */
export const messageFor = (code: string): string =>
  en[`error.${code}` as MessageKey] ?? en['error.unknown_error'];

/**
 * The same lookup, translated.
 *
 * A hook rather than a function taking `t`, so a call site changes from
 * `messageFor(error)` to `message(error)` and nothing else.
 */
export function useMessage(): (code: string) => string {
  const { t } = useT();
  return (code) => {
    const key = `error.${code}` as MessageKey;
    // A code with no message is a code somebody forgot; the fallback is the same
    // one the English table used, not the code itself, because a reader cannot
    // do anything with `parent_missing`.
    return key in en ? t(key) : t('error.unknown_error');
  };
}

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
