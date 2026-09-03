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

import { useEffect, useState, type ReactElement } from 'react';

import {
  ApiError,
  api,
  type SessionInfo,
  type VersionInfo,
} from '../api/client.ts';
import { WEB_COMMIT, WEB_VERSION, isStaleBundle } from '../buildInfo.ts';
import {
  SCALE_LABELS,
  TEXT_SCALES,
  useAppearance,
  type TextScale,
  type ThemePreference,
} from '../hooks/useAppearance.ts';
import { LANGUAGE_NAMES, LOCALES, useT, type Locale } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { LandingSettings } from './LandingSettings.tsx';
import { SettingsShell, resolveSection, type ShellSection } from './SettingsShell.tsx';
import { AVATAR_BOUND, webVariant } from '../lib/imageVariant.ts';

interface SettingsProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
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
const SECTIONS = [
  { id: 'profile', label: 'you.profile', hint: 'you.profile.hint' },
  { id: 'sign-in', label: 'you.signIn', hint: 'you.signIn.hint' },
  { id: 'appearance', label: 'you.appearance', hint: 'you.appearance.hint' },
  { id: 'landing', label: 'you.landing', hint: 'you.landing.hint' },
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
  onClose,
  onLogout,
}: SettingsProps): ReactElement {
  const { t } = useT();
  // Which of the two a phone is showing. Starts on the section, because
  // arriving at a list of settings when you asked for one setting is a step
  // nobody wanted.
  const [listOpen, setListOpen] = useState(false);
  const current = resolveSection(SECTIONS, section);
  // Read from the session rather than probed: the switcher only has to decide
  // whether to offer the entry, and the area behind it asks the server itself.
  const canAdminister =
    session.user.isInstanceAdmin || session.user.canManageWorkspaces;

  return (
    <SettingsShell
      area="You"
      areaId="settings"
      canAdminister={canAdminister}
      sections={SECTIONS.map((entry) => ({
        id: entry.id,
        label: t(entry.label),
        hint: t(entry.hint),
      }))}
      current={current}
      hrefFor={(id) => paths.settings(id)}
      listOpen={listOpen}
      onListOpen={setListOpen}
      account={{
        displayName: session.user.displayName,
        userId: session.user.id,
        onLogout,
      }}
      onClose={onClose}
    >
      {current === 'profile' && <Profile session={session} workspaceId={workspaceId} />}
      {current === 'sign-in' && <SignIn />}
      {current === 'appearance' && <AppearanceSettings session={session} />}
      {current === 'landing' && <LandingSettings workspaceId={workspaceId} />}
      {current === 'notifications' && <NotificationSettings session={session} />}
      {current === 'about' && <About />}
    </SettingsShell>
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
            {workspace ? ` · ${workspace.role}` : ''}
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
            <span>
              At least twelve characters. Length is what makes a password hard
              to guess; a short one with symbols in it is not.
            </span>
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
          {busy ? 'Changing…' : 'Change password'}
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

function AppearanceSettings({ session }: { session: SessionInfo }): ReactElement {
  const { t, locale, setLocale } = useT();
  const { appearance, setTheme, setUiScale, setEditorScale } = useAppearance();

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
            value={appearance.theme}
            onChange={(event) => setTheme(event.target.value as ThemePreference)}
          >
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
  const [schedule, setSchedule] = useState(session.user.emailSchedule ?? 'batched');
  const [activity, setActivity] = useState(session.user.activityDigest ?? 'off');
  const [mentions, setMentions] = useState(session.user.emailMentions);
  const [assignments, setAssignments] = useState(session.user.emailAssignments);
  const [replies, setReplies] = useState(session.user.emailReplies);
  const [error, setError] = useState<string | null>(null);

  const save = (input: {
    emailMentions?: boolean;
    emailSchedule?: 'batched' | 'daily' | 'off';
    activityDigest?: 'off' | 'daily' | 'weekly';
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

      {/* How often, before what about (ADR-0061).
        *
        * First, because it is the answer to the complaint people actually
        * have — "not every five minutes" — and because "never" here makes the
        * three below moot, which is easier to see when it is above them. */}
      <label className="settings-row">
        <span className="settings-row-label">
          <b>{t('you.notifications.schedule')}</b>
          <span>{t('you.notifications.schedule.hint')}</span>
        </span>
        <select
          value={schedule}
          onChange={(event) => {
            const chosen = event.target.value as 'batched' | 'daily' | 'off';
            setSchedule(chosen);
            save({ emailSchedule: chosen });
          }}
        >
          <option value="batched">{t('you.notifications.schedule.batched')}</option>
          <option value="daily">{t('you.notifications.schedule.daily')}</option>
          <option value="off">{t('you.notifications.schedule.off')}</option>
        </select>
      </label>

      {/* A different mail, and a different question (ADR-0062).
        *
        * Below the three ticks rather than beside them: those are about mail
        * addressed to somebody, this is about a list of what everybody did.
        * Off unless chosen, because an unasked-for list of what colleagues did
        * is what people mean when they call something spam. */}
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

      <label className="settings-row">
        <span className="settings-row-label">
          <b>{t('you.notifications.mentions')}</b>
        </span>
        <input
          type="checkbox"
          checked={mentions}
          onChange={(event) => {
            setMentions(event.target.checked);
            save({ emailMentions: event.target.checked });
          }}
        />
      </label>

      <label className="settings-row">
        <span className="settings-row-label">
          <b>{t('you.notifications.assignments')}</b>
        </span>
        <input
          type="checkbox"
          checked={assignments}
          onChange={(event) => {
            setAssignments(event.target.checked);
            save({ emailAssignments: event.target.checked });
          }}
        />
      </label>

      <label className="settings-row">
        <span className="settings-row-label">
          <b>{t('you.notifications.replies')}</b>
          <span>{t('you.notifications.replies.hint')}</span>
        </span>
        <input
          type="checkbox"
          checked={replies}
          onChange={(event) => {
            setReplies(event.target.checked);
            save({ emailReplies: event.target.checked });
          }}
        />
      </label>

      {error && <p className="error">{messageFor(error)}</p>}
    </section>
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
          This browser is running an older build than the server. Reload to pick
          up the current version — until then, what you see may not match what
          the server does.{' '}
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
        SONE is free software under the AGPL-3.0. No seat limits, no feature
        gates, no enterprise edition.
      </p>
    </section>
  );
}
