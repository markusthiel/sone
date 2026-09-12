/**
 * SONE web — your own settings (ADR-0032).
 *
 * One of three areas, and the boundary between them is whose settings these are
 * rather than who may change them. Here: your profile, your password, how SONE
 * looks to you, and where your session opens.
 *
 * "Where you land" is about a workspace and belongs here, because the value is
 * one person's: two members of the same workspace have different answers, so it
 * cannot be a property of the workspace.
 *
 * About is here too. The version and the licence are what somebody looks up
 * before filing a report, and requiring an administration right to read a
 * licence would be absurd.
 *
 * Two versions are shown on it, not one, and the distinction is the useful part.
 * The server's version comes over HTTP; the client's is baked into the bundle at
 * build time. A browser holding a cached bundle from an earlier deployment
 * reports the server's version if only asked over HTTP — a reassuring answer
 * about code that is not the code executing.
 */

import qr from 'qrcode-generator';
import { roleLabel } from '../workspaceRights.ts';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import {
  ApiError,
  api,
  type SessionInfo,
  type VersionInfo,
} from '../api/client.ts';
import { WEB_COMMIT, WEB_VERSION, isStaleBundle } from '../buildInfo.ts';
import {
  DENSITIES,
  DENSITY_LABELS,
  SCALE_LABELS,
  TEXT_SCALES,
  useAppearance,
  type Density,
  type TextScale,
  type ThemePreference,
} from '../hooks/useAppearance.ts';
import { LANGUAGE_NAMES, LOCALES, useT, type Locale } from '../i18n/useT.tsx';
import { pushState, switchOff, switchOn, type PushState } from '../lib/push.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { resolveSection, type ShellSection } from './SectionNav.tsx';
import { AVATAR_BOUND, webVariant } from '../lib/imageVariant.ts';

interface SettingsProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
  /** Re-reads the session, for a setting the whole interface is drawn from. */
  reloadSession: () => Promise<void> | void;
  /** Back to the notes. Settings is a screen of its own (ADR-0027). */
  onClose: () => void;
  /** Signing out, which the account menu at the foot of the column offers. */
  onLogout: () => void;
}

/**
 * The sections, by id and by the keys that name them.
 *
 * Keys rather than sentences, and translated where they are rendered: the list is
 * module-level because `resolveSection` needs it before anything renders, and a
 * module cannot call a hook (ADR-0041).
 */
export const SECTIONS = [
  { id: 'profile', label: 'you.profile', hint: 'you.profile.hint' },
  { id: 'sign-in', label: 'you.signIn', hint: 'you.signIn.hint' },
  { id: 'appearance', label: 'you.appearance', hint: 'you.appearance.hint' },
  /*
   * Where the mail's own link points (ADR-0058).
   *
   * It had to exist: the unsubscribe line in every notification email is
   * `/settings/notifications`, and I wrote that before there was a section
   * behind it — a link in a message that cannot be recalled, pointing at
   * nothing.
   */
  { id: 'notifications', label: 'you.notifications', hint: 'you.notifications.hint' },
  { id: 'about', label: 'you.about', hint: 'you.about.hint' },
] as const;

export function Settings({
  section,
  session,
  workspaceId,
  reloadSession,
  onClose,
  onLogout,
}: SettingsProps): ReactElement {
  const { t } = useT();
  // Which of the two a phone is showing. Starts on the section, because
  // arriving at a list of settings when you asked for one setting is a step
  // nobody wanted.
  const current = resolveSection(SECTIONS, section);
  // Read from the session rather than probed: the switcher only has to decide
  // whether to offer the entry, and the area behind it asks the server itself.
  const canAdminister =
    session.user.isInstanceAdmin || session.user.canManageWorkspaces;

  return (
    <div className="settings-body">
      <h1 className="page-title">{t(SECTIONS.find((e) => e.id === current)?.label ?? 'area.you')}</h1>
      {current === 'profile' && <Profile session={session} workspaceId={workspaceId} />}
      {current === 'sign-in' && (
        <>
          <SignIn />
          <SingleSignOn />
          <SecondFactorSettings session={session} />
        </>
      )}
      {current === 'appearance' && (
        <AppearanceSettings session={session} reload={reloadSession} />
      )}
      {current === 'notifications' && <NotificationSettings session={session} />}
      {current === 'about' && <About />}
    </div>
  );
}

/**
 * Your name, your address and your picture (ADR-0032).
 *
 * Split from signing in, which used to sit under the same heading. They are
 * different jobs done at different times: a name is changed once and rarely
 * again, a password when something has happened — and a form that offers a
 * current-password field while somebody is editing their display name reads as
 * being asked to authenticate for no reason.
 */
function Profile({
  session,
  workspaceId,
}: {
  session: SessionInfo;
  workspaceId: string;
}): ReactElement {
  const workspace = session.workspaces.find((w) => w.id === workspaceId);
  const { t } = useT();
  const [name, setName] = useState(session.user.displayName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A face that will not load is the ordinary case, not an error: most accounts
  // have none, and the initial is what stands in for it.
  const [avatarBroken, setAvatarBroken] = useState(false);

  const pickAvatar = async (chosen: File): Promise<void> => {
    setError(null);
    // Bounded to 512 and never sent whole. A photograph from a phone is eight
    // megabytes for something drawn at 22 pixels (ADR-0029).
    const small = await webVariant(chosen, AVATAR_BOUND);
    try {
      await api.setAvatar(small ?? chosen);
      // Reloaded: the face appears in the sidebar and beside every block its
      // owner wrote, and one copy updated here would leave the rest stale.
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const saveName = (): void => {
    setError(null);
    void api
      .updateProfile({ displayName: name.trim() })
      .then(() => {
        setSaved(true);
        // Reloaded rather than patched into place: the name appears in the
        // sidebar, in presence and beside every block somebody wrote, and a
        // copy updated here would leave the others saying the old one.
        window.location.reload();
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  return (
    <section className="settings-section">
      {error && <p className="error">{messageFor(error)}</p>}

      <div className="settings-card">
        {/* The picture first: it is the part of an account somebody recognises
          * before they read anything. */}
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.picture')}</b>
            <span>
              {t('you.picture.hint')}
            </span>
          </span>
          <span className="avatar-choose">
            <span className="account-avatar" aria-hidden="true">
              {avatarBroken || !session.user.email ? (
                session.user.displayName.trim().charAt(0).toUpperCase() || '?'
              ) : (
                <img
                  src={`/api/users/${session.user.id}/avatar`}
                  alt=""
                  onError={() => setAvatarBroken(true)}
                />
              )}
            </span>
            <input
              id="account-avatar"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) void pickAvatar(chosen);
              }}
            />
          </span>
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.name')}</b>
            <span>{t('you.name.hint')}</span>
          </span>
          <input
            id="account-name"
            aria-label={t('you.name')}
            value={name}
            onChange={(event) => {
              setSaved(false);
              setName(event.target.value);
            }}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.email')}</b>
            <span>
              {t('you.email.hint')}
            </span>
          </span>
          <span className="muted">{session.user.email ?? '—'}</span>
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.workspace')}</b>
            <span>{t('you.workspace.hint')}</span>
          </span>
          <span className="muted">
            {workspace?.name ?? '—'}
            {/* The role's name, not the old enum word: somebody holding
                "Redaktion" was being told they are a member (ADR-0102). */}
            {workspace ? ` · ${roleLabel({ key: workspace.role, name: workspace.roleName }, t)}` : ''}
          </span>
        </div>
      </div>

      <div className="settings-actions">
        <button
          type="button"
          className="btn primary"
          disabled={name.trim() === '' || name === session.user.displayName}
          onClick={saveName}
        >
          {t('you.save')}
        </button>
        {saved && <span className="muted">{t('you.saved')}</span>}
      </div>
    </section>
  );
}

/**
 * Signing in: the password, and whatever else ever guards the way in.
 *
 * Its own section rather than the foot of the profile. Changing a password is
 * deliberate, usually prompted by something having happened, and it belongs
 * where it can be found by looking for it — which is also where single sign-on
 * and a second factor would go.
 */
/**
 * Turning a second factor on and off (ADR-0063).
 *
 * **No QR image, and that is a decision rather than an omission.** Generating
 * one is a real algorithm — Reed-Solomon, masking, version selection — and
 * unlike the MIME reader, nothing about SONE's scope makes it smaller. The
 * options were a dependency or a third-party image service, and the second is
 * out of the question: it would send the shared secret to somebody else.
 *
 * So: the secret in groups of four, which every authenticator app accepts by
 * hand, and an `otpauth://` link, which on a phone opens the app directly and
 * is better than a QR code there. A QR image for the desktop case is worth a
 * dependency and is offered as one.
 */
/**
 * The QR code an authenticator app scans (ADR-0063 amendment).
 *
 * `qrcode-generator` does the encoding — Reed-Solomon, masking and version
 * selection, which is a real algorithm that SONE's scope does not make smaller.
 * One package, no transitive dependencies, and it computes locally: the shared
 * secret never leaves the instance, which ruled out every image service.
 *
 * The drawing is ours rather than the library's `createSvgTag`, so the colours
 * are the theme's and there is no `dangerouslySetInnerHTML` in a screen that
 * displays a credential.
 */
function SecretQr({ uri }: { uri: string }): ReactElement | null {
  // The hook at the top, not inside an attribute: I had `useT()` in the
  // aria-label, which is a hook call in a conditional render path.
  const { t } = useT();
  const modules = useMemo(() => {
    try {
      // Type 0 picks the smallest version that fits; 'M' is the middle error
      // correction level, which is what authenticator apps expect.
      const code = qr(0, 'M');
      code.addData(uri);
      code.make();
      const count = code.getModuleCount();
      const dark: Array<[number, number]> = [];
      for (let row = 0; row < count; row += 1) {
        for (let column = 0; column < count; column += 1) {
          if (code.isDark(row, column)) dark.push([row, column]);
        }
      }
      return { count, dark };
    } catch {
      // A URI too long for any version, or a library that changed under us:
      // the typed secret below is the fallback, and it always works.
      return null;
    }
  }, [uri]);

  if (!modules) return null;

  // A quiet zone of four modules, which the specification requires and which
  // scanners genuinely need.
  const quiet = 4;
  const size = modules.count + quiet * 2;

  return (
    <svg
      className="totp-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={t('you.secondFactor.qrLabel')}
    >
      {/* Always on white, never on the theme's surface: a dark-mode QR code
          with inverted colours is one many scanners refuse. */}
      <rect width={size} height={size} fill="#fff" />
      {modules.dark.map(([row, column]) => (
        <rect
          key={`${row}-${column}`}
          x={column + quiet}
          y={row + quiet}
          width={1}
          height={1}
          fill="#000"
        />
      ))}
    </svg>
  );
}

function SecondFactorSettings({ session }: { session: SessionInfo }): ReactElement {
  const { t } = useT();
  const [enrolment, setEnrolment] = useState<{ uri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState(session.user.hasSecondFactor === true);

  // Shown once, and the server could not show them again if asked: they are
  // stored hashed (ADR-0063).
  if (codes) {
    return (
      <section className="settings-section">
        <h2>{t('you.secondFactor.codes')}</h2>
        <p className="settings-note">{t('you.secondFactor.codes.hint')}</p>
        <ul className="recovery-codes">
          {codes.map((one) => (
            <li key={one}>
              <code>{one}</code>
            </li>
          ))}
        </ul>
        <button type="button" className="btn primary" onClick={() => setCodes(null)}>
          {t('you.secondFactor.codes.kept')}
        </button>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2>{t('you.secondFactor')}</h2>
      <p className="settings-note">{t('you.secondFactor.hint')}</p>

      {on ? (
        <>
          <p>{t('you.secondFactor.isOn')}</p>
          <label className="settings-row">
            <span className="settings-row-label">
              <b>{t('you.secondFactor.removePassword')}</b>
              {/* The password, not just this session: an open laptop is the
                  exact situation a second factor exists for. */}
              <span>{t('you.secondFactor.removePassword.hint')}</span>
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={password === ''}
            onClick={() => {
              void api
                .removeSecondFactor(password)
                .then(() => {
                  setOn(false);
                  setPassword('');
                  setError(null);
                })
                .catch((err: unknown) => {
                  setError(err instanceof ApiError ? err.code : 'network_error');
                });
            }}
          >
            {t('you.secondFactor.remove')}
          </button>
        </>
      ) : enrolment ? (
        <>
          <p>{t('you.secondFactor.scan')}</p>
          <SecretQr uri={enrolment.uri} />
          {/* On a phone this opens the authenticator app; on a desktop it is
              inert, which is why the typed secret is below it. */}
          <p>
            <a href={enrolment.uri}>{t('you.secondFactor.open')}</a>
          </p>
          <p className="settings-note">{t('you.secondFactor.byHand')}</p>
          <code className="totp-secret">
            {(enrolment.secret.match(/.{1,4}/g) ?? []).join(' ')}
          </code>

          <label className="settings-row">
            <span className="settings-row-label">
              <b>{t('auth.code')}</b>
              {/* Proving one is what makes the enrolment count: a mis-scanned
                  secret must not lock somebody out of their own account. */}
              <span>{t('you.secondFactor.prove')}</span>
            </span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
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
                .then((result) => {
                  setCodes(result.recoveryCodes);
                  setEnrolment(null);
                  setCode('');
                  setOn(true);
                  setError(null);
                })
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
              .then((started) => {
                setEnrolment(started);
                setError(null);
              })
              .catch((err: unknown) => {
                setError(err instanceof ApiError ? err.code : 'network_error');
              });
          }}
        >
          {t('you.secondFactor.start')}
        </button>
      )}

      {error && <p className="error">{messageFor(error)}</p>}
    </section>
  );
}

/**
 * Connecting a provider to an account that already exists (ADR-0084).
 *
 * The ordinary path is an invitation: somebody is invited, sets a password, and
 * *then* wants to use the company's provider instead of remembering another
 * one. Until this existed, only accounts a provider had created could ever use
 * a provider — everybody invited before it was configured was shut out, and two
 * records described this screen as though it were here.
 *
 * A whole-page navigation rather than a popup: the provider decides how it
 * authenticates somebody, and a window it cannot resize or redirect freely is
 * a worse version of the same trip.
 */
function SingleSignOn(): ReactElement | null {
  const { t } = useT();
  const [state, setState] = useState<Awaited<ReturnType<typeof api.oidcLink>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api
      .oidcLink()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The callback comes back here with a mark in the address, because it is a
  // redirect from somewhere else and there is no other way for it to say how it
  // went.
  const justLinked = new URLSearchParams(window.location.search).get('linked') === '1';

  const disconnect = (): void => {
    setBusy(true);
    setError(null);
    void api
      .oidcUnlink()
      .then(() => load())
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  // Nothing at all when the instance has no provider: an empty section headed
  // "single sign-on" is a thing to wonder about rather than a thing to use.
  if (!state?.available) return null;

  return (
    <section className="settings-section">
      <h2>{t('you.sso')}</h2>
      <p className="muted settings-note">{t('you.sso.note')}</p>

      {justLinked && !error && <p className="muted">{t('you.sso.justLinked')}</p>}
      {error && <p className="error">{messageFor(error)}</p>}

      {state.linked ? (
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('you.sso.connected')}</b>
              <span>{state.linked.issuer}</span>
            </span>
            <button
              type="button"
              className="btn"
              disabled={busy || !state.canUnlink}
              onClick={disconnect}
            >
              {t('you.sso.disconnect')}
            </button>
          </div>
          {!state.canUnlink && (
            <p className="muted settings-note">{t('you.sso.onlyWayIn')}</p>
          )}
        </div>
      ) : (
        <div className="admin-row-actions">
          <a className="btn" href="/api/auth/oidc/start?link=1">
            {state.buttonLabel ?? t('you.sso.connect')}
          </a>
        </div>
      )}
    </section>
  );
}

function SignIn(): ReactElement {
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordDone, setPasswordDone] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savePassword = (): void => {
    setBusy(true);
    setPasswordError(null);
    void api
      .changePassword({ currentPassword: current, newPassword: next })
      .then(() => {
        setPasswordDone(true);
        setCurrent('');
        setNext('');
      })
      .catch((err: unknown) =>
        setPasswordError(err instanceof ApiError ? err.code : 'network_error'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="settings-section">
      {/* Changing a password asks for the current one.
        *
        * Not a formality: a session left open on a shared machine is the
        * ordinary way an account is taken, and without this the person who
        * finds it can lock its owner out in two fields. */}
      {passwordError && <p className="error">{messageFor(passwordError)}</p>}

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.currentPassword')}</b>
            <span>
              {t('you.currentPassword.hint')}
            </span>
          </span>
          <input
            id="account-current"
            aria-label={t('you.currentPassword')}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setPasswordDone(false);
              setCurrent(event.target.value);
            }}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.newPassword')}</b>
            <span>{t('you.newPassword.hint')}</span>
          </span>
          <input
            id="account-next"
            aria-label={t('you.newPassword')}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setPasswordDone(false);
              setNext(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="settings-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy || current === '' || next.length < 12}
          onClick={savePassword}
        >
          {busy ? t('you.changingPassword') : t('you.changePassword')}
        </button>
        {passwordDone && (
          <span className="muted">
            {t('you.passwordChanged')}
          </span>
        )}
      </div>
    </section>
  );
}

function AppearanceSettings({
  session,
  reload,
}: {
  session: SessionInfo;
  /** Re-reads the session, so a new scheme reaches the whole interface. */
  reload: () => Promise<void> | void;
}): ReactElement {
  const { t, locale, setLocale } = useT();
  const { appearance, setUiScale, setEditorScale, setDensity } = useAppearance();

  /**
   * Light or dark, saved to the account (ADR-0124).
   *
   * The same shape as the language above it, and for the same reason: a
   * preference for dark is a property of the person, not of the machine they
   * happen to be at. The two sizes below stay per browser, and the hints say
   * which is which.
   *
   * Four options, not three. `''` is "as the workspace says" and `system` is
   * "this device decides" — different answers, and the difference is the whole
   * point: somebody in a dark workspace who wants their laptop's own setting
   * has to be able to say so without picking light or dark by hand.
   */
  const chooseScheme = (value: string): void => {
    void api
      .updateProfile({ colorScheme: value === '' ? null : (value as 'light' | 'dark' | 'system') })
      // Reloaded rather than applied here: the resolution needs the workspace's
      // theme and the instance's under it, and that is done in one place
      // (ADR-0124). A second answer computed on this screen is how two parts of
      // an interface end up disagreeing about what colour it is.
      .then(() => reload());
  };

  /**
   * The language, saved to the account rather than to this browser.
   *
   * Deliberately different from the sizes below it, and the hint says so: a text
   * size that suits a phone is wrong on a monitor, while somebody's language is
   * theirs wherever they sign in.
   *
   * `null` means "match the browser" — the setting is *absent* rather than set
   * to a language, so somebody travelling between a German and an English
   * machine keeps getting each one's own (ADR-0041).
   */
  const chosen = session.user.locale ?? '';
  const chooseLanguage = (value: string): void => {
    // Applied first, saved second. The provider re-renders without a reload,
    // which is the decision ADR-0041 made — reloading throws away a half-typed
    // paragraph — and a failed save leaves the interface in the language that
    // was asked for rather than snapping back mid-sentence.
    if (value !== '') setLocale(value as Locale);
    void api.updateProfile({ locale: value === '' ? null : value });
  };

  return (
    <section className="settings-section">
      <h2>{t('you.appearance')}</h2>

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.language')}</b>
            <span>{t('you.language.hint')}</span>
          </span>
          <select
            id="locale"
            aria-label={t('you.language')}
            value={chosen}
            onChange={(event) => chooseLanguage(event.target.value)}
          >
            <option value="">{t('you.language.system')}</option>
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {/* Each language names itself: somebody looking for German is
                    looking for "Deutsch", not for "German" in a language they
                    are trying to leave. */}
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="muted">{t('you.appearance.note')}</p>

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.theme')}</b>
            <span>
              {t('you.theme.hint')}
            </span>
          </span>
          <select
            id="theme"
            aria-label={t('you.theme')}
            value={session.user.colorScheme ?? ''}
            onChange={(event) => chooseScheme(event.target.value)}
          >
            <option value="">{t('you.theme.workspace')}</option>
            <option value="system">{t('you.theme.system')}</option>
            <option value="light">{t('you.theme.light')}</option>
            <option value="dark">{t('you.theme.dark')}</option>
          </select>
        </div>

        {/* Two scales, not one. Someone who wants a denser sidebar does not
            necessarily want smaller prose, and someone writing long documents may
            want larger prose without a larger interface. */}
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.interfaceSize')}</b>
            <span>{t('you.interfaceSize.hint')}</span>
          </span>
          <select
            id="ui-scale"
            aria-label={t('you.interfaceSize')}
            value={appearance.uiScale}
            onChange={(event) => setUiScale(event.target.value as TextScale)}
          >
            {TEXT_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {SCALE_LABELS[scale]}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.editorSize')}</b>
            <span>{t('you.editorSize.hint')}</span>
          </span>
          <select
            id="editor-scale"
            aria-label={t('you.editorSize')}
            value={appearance.editorScale}
            onChange={(event) => setEditorScale(event.target.value as TextScale)}
          >
            {TEXT_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {SCALE_LABELS[scale]}
              </option>
            ))}
          </select>
        </div>

        {/* Density, beside the scales and not in the workspace's theme
            (ADR-0140).
          *
          * It is a third thing, not a coarser text size: somebody on a large
          * monitor may want the same type and half the air around it. And it
          * belongs to this browser for the reason the scales do — a phone that
          * inherited "compact" from a desktop is a phone nobody can tap. */}
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.density')}</b>
            <span>{t('you.density.hint')}</span>
          </span>
          <select
            id="density"
            aria-label={t('you.density')}
            value={appearance.density}
            onChange={(event) => setDensity(event.target.value as Density)}
          >
            {DENSITIES.map((density) => (
              <option key={density} value={density}>
                {DENSITY_LABELS[density]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

/**
 * Whether to be emailed, per kind (ADR-0058).
 *
 * Three ticks and a sentence about what a mail contains — the part somebody
 * deciding this actually wants to know, and which no other screen says. Saved
 * on change rather than behind a button: a tick that needs confirming is a tick
 * somebody will leave half-set.
 */
function NotificationSettings({ session }: { session: SessionInfo }): ReactElement {
  const { t } = useT();
  const [mentionsWhen, setMentionsWhen] = useState(session.user.mentionsWhen ?? 'immediately');
  const [assignmentsWhen, setAssignmentsWhen] = useState(
    session.user.assignmentsWhen ?? 'immediately',
  );
  const [repliesWhen, setRepliesWhen] = useState(session.user.repliesWhen ?? 'off');
  const [activity, setActivity] = useState(session.user.activityDigest ?? 'off');
  const [scope, setScope] = useState(session.user.digestScope ?? 'all');
  const [error, setError] = useState<string | null>(null);

  const save = (input: {
    mentionsWhen?: 'immediately' | 'daily' | 'off';
    assignmentsWhen?: 'immediately' | 'daily' | 'off';
    repliesWhen?: 'immediately' | 'daily' | 'off';
    activityDigest?: 'off' | 'daily' | 'weekly';
    digestScope?: 'all' | 'watched';
    emailAssignments?: boolean;
    emailReplies?: boolean;
  }): void => {
    void api.updateProfile(input).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.code : 'network_error');
    });
  };

  return (
    <section className="settings-section">
      <h2>{t('you.notifications')}</h2>
      {/* What a mail says, before the choice about receiving one: somebody
          deciding this wants to know what leaves the instance, and nothing else
          in the interface tells them. */}
      <p className="settings-note">{t('you.notifications.contents')}</p>

      {/* On this device, above the mail (ADR-0180).
        *
        * First because it is the one answer here that is about *this machine*:
        * everything below is about an address and follows somebody everywhere,
        * and this one stops at the iPad it was switched on for. Which is also
        * why it says so rather than reading as an account-wide switch. */}
      <OnThisDevice />

      {/* A different mail, and a different question (ADR-0062).
        *
        * Below the per-kind answers rather than among them: those are about
        * mail addressed to somebody, this is a list of what everybody did. Off
        * unless chosen.
        *
        * Restored after my own edit swallowed it: the range I replaced ran from
        * the old schedule row to the last tick, and this select sat between
        * them. The guard for messages defined and never used is what noticed. */}
      <label className="settings-row">
        <span className="settings-row-label">
          <b>{t('you.activity')}</b>
          <span>{t('you.activity.hint')}</span>
        </span>
        <select
          value={activity}
          onChange={(event) => {
            const chosen = event.target.value as 'off' | 'daily' | 'weekly';
            setActivity(chosen);
            save({ activityDigest: chosen });
          }}
        >
          <option value="off">{t('you.activity.off')}</option>
          <option value="daily">{t('you.activity.daily')}</option>
          <option value="weekly">{t('you.activity.weekly')}</option>
        </select>
      </label>

      {/* What the mail covers (ADR-0064). Only shown when the mail is on: a
        * scope for a mail nobody receives is a question about nothing. */}
      {activity !== 'off' && (
        <label className="settings-row">
          <span className="settings-row-label">
            <b>{t('you.activity.scope')}</b>
            <span>{t('you.activity.scope.hint')}</span>
          </span>
          <select
            value={scope}
            onChange={(event) => {
              const chosen = event.target.value as 'all' | 'watched';
              setScope(chosen);
              save({ digestScope: chosen });
            }}
          >
            <option value="all">{t('you.activity.scope.all')}</option>
            <option value="watched">{t('you.activity.scope.watched')}</option>
          </select>
        </label>
      )}

      {/* One answer per kind, replacing a tick plus a separate schedule
        * (ADR-0061, amended).
        *
        * The record refused this, arguing "two schedules is a matrix". The
        * design that was wanted is not a matrix: it is one control per kind,
        * and "at once when I am mentioned, the rest tomorrow" is the ordinary
        * thing to want. Three controls where there were four. */}
      {(
        [
          ['mentions', mentionsWhen, setMentionsWhen, 'mentionsWhen'],
          ['assignments', assignmentsWhen, setAssignmentsWhen, 'assignmentsWhen'],
          ['replies', repliesWhen, setRepliesWhen, 'repliesWhen'],
        ] as const
      ).map(([kind, value, set, field]) => (
        <label className="settings-row" key={kind}>
          <span className="settings-row-label">
            <b>{t(`you.notifications.${kind}` as const)}</b>
          </span>
          <select
            value={value}
            onChange={(event) => {
              const chosen = event.target.value as 'immediately' | 'daily' | 'off';
              set(chosen);
              save({ [field]: chosen });
            }}
          >
            <option value="immediately">{t('you.when.immediately')}</option>
            <option value="daily">{t('you.when.daily')}</option>
            <option value="off">{t('you.when.off')}</option>
          </select>
        </label>
      ))}

      {error && <p className="error">{messageFor(error)}</p>}
    </section>
  );
}

/**
 * Notifications on this device (ADR-0180).
 *
 * Per device, not per account: switching it off on the iPad must not stop the
 * phone, which is what somebody means by *„auf diesem Gerät"*.
 *
 * The four states are told apart because the way out of each differs — and the
 * two that cannot be acted on say why instead of showing a switch that does
 * nothing. A refused permission is the sharper one: only the browser's own
 * settings can undo it, and asking again does nothing at all, silently.
 */
function OnThisDevice(): ReactElement | null {
  const { t } = useT();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushState().then((answer) => {
      if (live) setState(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  // Nothing at all until the answer is in: a switch that flips from off to on a
  // moment after the screen appears is a switch somebody has already clicked.
  if (state === null) return null;

  /*
   * An iPad's Safari tab is the ordinary case here, and the way out is a
   * sentence rather than a control: iOS shows notifications for a web
   * application only once it has been added to the home screen. Saying so is
   * the whole of the help there is.
   */
  if (state === 'unsupported') return <p className="settings-note">{t('you.device.unsupported')}</p>;
  if (state === 'denied') return <p className="settings-note">{t('you.device.denied')}</p>;

  return (
    <label className="settings-row">
      <span className="settings-row-label">
        <b>{t('you.device')}</b>
        <span>{t('you.device.hint')}</span>
      </span>
      <button
        type="button"
        className={state === 'on' ? 'btn' : 'btn primary'}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void (state === 'on' ? switchOff() : switchOn())
            .then(setState)
            .finally(() => setBusy(false));
        }}
      >
        {state === 'on' ? t('you.device.off') : t('you.device.on')}
      </button>
    </label>
  );
}

function About(): ReactElement {
  const { t } = useT();
  const [server, setServer] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .version()
      .then((info) => {
        if (!cancelled) setServer(info);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stale = isStaleBundle(server?.commit);

  return (
    <section className="settings-section">
      <h2>{t('you.about')}</h2>

      {stale && (
        <p className="settings-warning">
          {t('about.stale')}{' '}
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            {t('action.reload')}
          </button>
        </p>
      )}

      <dl className="settings-list">
        <dt>{t('about.server')}</dt>
        <dd>
          {server ? (
            <>
              {server.version}
              <span className="muted"> · {server.commit.slice(0, 8)}</span>
            </>
          ) : error ? (
            <span className="error">{messageFor(error)}</span>
          ) : (
            <span className="muted">{t('about.checking')}</span>
          )}
        </dd>

        <dt>{t('you.thisBrowser')}</dt>
        <dd>
          {WEB_VERSION}
          <span className="muted"> · {WEB_COMMIT.slice(0, 8)}</span>
        </dd>

        {/* The contract versions, which are what actually decide whether a
            client can talk to a server and open a document. Shown because when
            an upgrade goes wrong these are the numbers that explain why
            (ADR-0013). */}
        <dt>{t('about.documentFormat')}</dt>
        <dd>{server ? `v${server.documentSchema}` : <span className="muted">—</span>}</dd>

        <dt>{t('about.syncProtocol')}</dt>
        <dd>{server ? `v${server.syncProtocol}` : <span className="muted">—</span>}</dd>
      </dl>

      <p className="muted" style={{ fontSize: '0.85rem' }}>
        {t('about.licence')}
      </p>
    </section>
  );
}
