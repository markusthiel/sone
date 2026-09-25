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
import { SoneLockup } from './Logo.tsx';

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

/**
 * The mark above a logged-out screen (ADR-0202).
 *
 * Somebody standing in front of a sign-in form has no other way of knowing what
 * they are signing in to: there is no rail, no workspace, no page — only this
 * card. SONE's showed the word "Anmelden" and nothing else, which is the one
 * screen in the application where the mark is not decoration.
 *
 * `SoneLockup` rather than the drawing, so an instance with a logo of its own
 * shows that logo and its own name (ADR-0123): putting "SONE" over somebody
 * else's mark would be this software signing their letterhead.
 */
function AuthBrand(): ReactElement {
  const { t } = useT();
  return (
    <div className="auth-brand">
      <SoneLockup size={32} />
      <p className="auth-claim">{t('auth.claim')}</p>
    </div>
  );
}

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
  const { t } = useT();
  const message = useMessage();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [password, setPassword] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setup({ email, password, displayName, workspaceName, setupKey });
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
        <AuthBrand />
        <h1>{t('auth.setup')}</h1>
        <p className="muted">
          {t('auth.setup.note')}
        </p>

        {/*
          Where the key is, before the field that asks for it (ADR-0155).
          A field for something one cannot find is a dead end with an input in
          it.
        */}
        <p className="muted">
          {t('auth.setup.keyWhere')}
          {/* Through the catalogue like everything else: a command in the
              markup is English on a translated screen, and the i18n guard is
              right to say so. */}
          <code className="setup-key-hint">{t('auth.setup.keyCommand')}</code>
          {t('auth.setup.keyLife')}
        </p>

        <div className="field">
          <label htmlFor="key">{t('auth.setup.key')}</label>
          <input
            id="key"
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label htmlFor="ws">{t('auth.workspaceName')}</label>
          <input
            id="ws"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            required
            autoComplete="organization"
          />
        </div>
        <div className="field">
          <label htmlFor="name">{t('auth.yourName')}</label>
          <input
            id="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label htmlFor="email">{t('auth.email')}</label>
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
          <label htmlFor="pw">{t('auth.password')}</label>
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
            {t('auth.passwordHint')}
          </span>
        </div>

        {error && <p className="error">{message(error)}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t('auth.creatingWorkspace') : t('auth.createWorkspace')}
        </button>
      </form>
    </div>
  );
}

export function LoginScreen({
  onDone,
  instance,
}: AuthFormProps & { instance: InstanceInfo }): ReactElement {
  const { t } = useT();
  const message = useMessage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A half-finished sign-in, waiting for a code (ADR-0063). */
  const [secondStep, setSecondStep] = useState<string | null>(null);

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
      const answer = await api.login({ email, password });
      /*
       * The sign-in may stop half way (ADR-0063).
       *
       * A ticket instead of a cookie means this account has a second factor.
       * The password is not kept: it has already been accepted, and holding it
       * to retry with would be holding it for no reason.
       */
      if (answer && typeof answer === 'object' && answer.needsSecondFactor && answer.ticket) {
        setSecondStep(answer.ticket);
        setPassword('');
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  // The code step replaces the form entirely: the password is already accepted,
  // and leaving it on screen invites somebody to retype it when the code is
  // what is wrong (ADR-0063).
  if (secondStep) return <SecondFactorStep ticket={secondStep} onDone={onDone} />;

  return (
    <div className="centered">
      <form className="card" onSubmit={submit}>
        <AuthBrand />
        <h1>{t('auth.signIn')}</h1>
        <div className="field">
          <label htmlFor="email">{t('auth.email')}</label>
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
          <label htmlFor="pw">{t('auth.password')}</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {error && <p className="error">{message(error)}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t('auth.signingIn') : t('auth.signIn')}
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
            <p className="auth-or muted">{t('auth.or')}</p>
            <a className="btn sso" href="/api/auth/oidc/start">
              {sso.buttonLabel ?? t('auth.sso')}
            </a>
          </>
        )}

        {/* Only when a relay is configured (ADR-0059).
          *
          * Without one the reset is absent, not broken — and a link to a form
          * that can only ever say "a link is on its way" about a mail nobody
          * will send is worse than no link: it teaches somebody to wait. */}
        {instance.canSendMail === true && (
          <p className="muted">
            <a href={paths.reset()}>{t('reset.forgot')}</a>
          </p>
        )}

        {instance.signupMode === 'open' && (
          <p className="muted">
            {t('auth.noAccount')} <a href={paths.signup()}>{t('auth.createOne')}</a>.
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * Asking for a reset link, or setting a new password with one (ADR-0059).
 *
 * Two states in one screen, chosen by whether the address carries a token —
 * because they are two halves of one errand and a person arriving from a mail
 * should not have to notice which screen they are on.
 */
export function ResetScreen({
  token,
  navigate,
}: {
  token: string | null;
  navigate: (to: string) => void;
}): ReactElement {
  const { t } = useT();
  const message = useMessage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="centered card">
        <h1>{t('reset.done')}</h1>
        <p>{t('reset.done.hint')}</p>
        <button type="button" className="btn primary" onClick={() => navigate(paths.login())}>
          {t('reset.toSignIn')}
        </button>
      </div>
    );
  }

  if (token) {
    return (
      <div className="centered card">
        <h1>{t('reset.setTitle')}</h1>
        <p>{t('reset.setHint')}</p>
        <label>
          {t('reset.newPassword')}
          <input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="error">{message(error)}</p>}
        <button
          type="button"
          className="btn primary"
          disabled={busy || password === ''}
          onClick={() => {
            setBusy(true);
            setError(null);
            void api
              .resetPassword(token, password)
              .then(() => setDone(true))
              .catch((err: unknown) => {
                setError(err instanceof ApiError ? err.code : 'network_error');
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? t('reset.setting') : t('reset.set')}
        </button>
      </div>
    );
  }

  /*
   * The asking half, and the sentence it shows.
   *
   * Shown for *any* address, including one with no account: the server answers
   * identically on purpose, and a screen that said "we sent you a mail" only
   * for real addresses would put the oracle back that the route removed
   * (ADR-0059).
   */
  if (asked) {
    return (
      <div className="centered card">
        <h1>{t('reset.askedTitle')}</h1>
        <p>{t('reset.askedHint')}</p>
        <button type="button" className="btn subtle" onClick={() => navigate(paths.login())}>
          {t('reset.toSignIn')}
        </button>
      </div>
    );
  }

  return (
    <div className="centered card">
      <AuthBrand />
      <h1>{t('reset.askTitle')}</h1>
      <p>{t('reset.askHint')}</p>
      <label>
        {t('auth.email')}
        <input
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={busy || email.trim() === ''}
        onClick={() => {
          setBusy(true);
          void api
            .requestReset(email.trim())
            // The same next screen whichever way it went, including a network
            // failure: the alternative tells somebody watching whether the
            // request reached anything.
            .then(() => setAsked(true))
            .catch(() => setAsked(true))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? t('reset.asking') : t('reset.ask')}
      </button>
      <button type="button" className="btn subtle" onClick={() => navigate(paths.login())}>
        {t('reset.backToSignIn')}
      </button>
    </div>
  );
}

/**
 * The second step of signing in (ADR-0063).
 *
 * Its own small screen rather than a field that appears under the password: the
 * password is already accepted at this point, and showing it still filled in
 * would invite somebody to retype it when the code is what is wrong.
 */
function SecondFactorStep({
  ticket,
  onDone,
}: {
  ticket: string;
  onDone: () => void;
}): ReactElement {
  const { t } = useT();
  const message = useMessage();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setBusy(true);
    setError(null);
    void api
      .secondFactorLogin(ticket, code.trim())
      .then(onDone)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.code : 'network_error');
        setBusy(false);
      });
  };

  return (
    <div className="centered card">
      <h1>{t('auth.secondFactor')}</h1>
      <p>{t('auth.secondFactor.hint')}</p>
      <label>
        {t('auth.code')}
        <input
          // Numeric, but not `type="number"`: a code is a string of six digits
          // and a spinner on it is nonsense. `inputMode` gets the right
          // keyboard on a phone without any of that.
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && code.trim() !== '') submit();
          }}
        />
      </label>
      {error && <p className="error">{message(error)}</p>}
      <button
        type="button"
        className="btn primary"
        disabled={busy || code.trim() === ''}
        onClick={submit}
      >
        {busy ? t('auth.checking') : t('auth.signIn')}
      </button>
      {/* Said here rather than only in the settings screen: somebody locked out
          is reading this page, not that one. */}
      <p className="muted">{t('auth.secondFactor.lost')}</p>
    </div>
  );
}

/**
 * The only screen a blocked account can reach (ADR-0065).
 *
 * Not a dialog over the workspace: a dialog implies something behind it that
 * could be looked at, and the decision is that there is not. Reading is
 * refused too, because the point of a second factor is that a stolen password
 * grants nothing — and a stolen password with read access to a company's notes
 * has granted the thing that mattered.
 *
 * Signing out stays reachable, because somebody at a borrowed computer needs a
 * way out that is not enrolling their phone on somebody else's account.
 */
export function SecondFactorRequired({ onDone }: { onDone: () => void }): ReactElement {
  const { t } = useT();
  const message = useMessage();
  const [enrolment, setEnrolment] = useState<{ uri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (codes) {
    return (
      <div className="centered card">
        <h1>{t('you.secondFactor.codes')}</h1>
        <p>{t('you.secondFactor.codes.hint')}</p>
        <ul className="recovery-codes">
          {codes.map((one) => (
            <li key={one}>
              <code>{one}</code>
            </li>
          ))}
        </ul>
        {/* Only now is the way through opened: somebody who has not seen their
            recovery codes has not finished, whatever the server thinks. */}
        <button type="button" className="btn primary" onClick={onDone}>
          {t('you.secondFactor.codes.kept')}
        </button>
      </div>
    );
  }

  return (
    <div className="centered card">
      <h1>{t('required.title')}</h1>
      <p>{t('required.hint')}</p>

      {enrolment ? (
        <>
          <p className="settings-note">{t('you.secondFactor.byHand')}</p>
          <code className="totp-secret">
            {(enrolment.secret.match(/.{1,4}/g) ?? []).join(' ')}
          </code>
          <p>
            <a href={enrolment.uri}>{t('you.secondFactor.open')}</a>
          </p>
          <label>
            {t('auth.code')}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={code.trim() === ''}
            onClick={() => {
              void api
                .confirmSecondFactor(code.trim())
                .then((result) => setCodes(result.recoveryCodes))
                .catch((err: unknown) => {
                  setError(err instanceof ApiError ? err.code : 'network_error');
                });
            }}
          >
            {t('you.secondFactor.finish')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            void api
              .startSecondFactor()
              .then(setEnrolment)
              .catch((err: unknown) => {
                setError(err instanceof ApiError ? err.code : 'network_error');
              });
          }}
        >
          {t('you.secondFactor.start')}
        </button>
      )}

      {error && <p className="error">{message(error)}</p>}

      <p className="muted">
        <button
          type="button"
          className="btn subtle"
          onClick={() => {
            void api.logout().then(onDone);
          }}
        >
          {t('account.signOut')}
        </button>
      </p>
    </div>
  );
}

export function SignupScreen({
  onDone,
  invitationToken,
}: AuthFormProps & { invitationToken: string | null }): ReactElement {
  const { t } = useT();
  const message = useMessage();
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
        <AuthBrand />
        <h1>{t('auth.createAccount')}</h1>
        <div className="field">
          <label htmlFor="name">{t('auth.yourName')}</label>
          <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="email">{t('auth.email')}</label>
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
          <label htmlFor="pw">{t('auth.password')}</label>
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
        {error && <p className="error">{message(error)}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t('auth.creatingAccount') : t('auth.createAccountAction')}
        </button>
        <p className="muted">
          {t('auth.haveAccount')} <a href={paths.login()}>{t('auth.signIn')}</a>.
        </p>
      </form>
    </div>
  );
}
