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
}

const SECTIONS: readonly ShellSection[] = [
  { id: 'profile', label: 'Profile', hint: 'Your name, address and picture' },
  { id: 'sign-in', label: 'Signing in', hint: 'Your password' },
  { id: 'appearance', label: 'Appearance', hint: 'How SONE looks to you' },
  { id: 'landing', label: 'Where you land', hint: 'The page each workspace opens on' },
  { id: 'about', label: 'About', hint: 'Version and licence' },
];

export function Settings({
  section,
  session,
  workspaceId,
  onClose,
}: SettingsProps): ReactElement {
  // Which of the two a phone is showing. Starts on the section, because
  // arriving at a list of settings when you asked for one setting is a step
  // nobody wanted.
  const [listOpen, setListOpen] = useState(false);
  const current = resolveSection(SECTIONS, section);

  return (
    <SettingsShell
      area="You"
      sections={SECTIONS}
      current={current}
      hrefFor={(id) => paths.settings(id)}
      listOpen={listOpen}
      onListOpen={setListOpen}
      onClose={onClose}
    >
      {current === 'profile' && <Profile session={session} workspaceId={workspaceId} />}
      {current === 'sign-in' && <SignIn />}
      {current === 'appearance' && <AppearanceSettings />}
      {current === 'landing' && <LandingSettings workspaceId={workspaceId} />}
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
            <b>Picture</b>
            <span>
              Any size — it is shrunk here before it is sent, and shown small.
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
            <b>Name</b>
            <span>What other people see beside anything you write here.</span>
          </span>
          <input
            id="account-name"
            aria-label="Name"
            value={name}
            onChange={(event) => {
              setSaved(false);
              setName(event.target.value);
            }}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>Email</b>
            <span>
              Identifies your account when you sign in. Changing it needs a way
              to prove the new address is yours, which this instance cannot do
              yet.
            </span>
          </span>
          <span className="muted">{session.user.email ?? '—'}</span>
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>Workspace</b>
            <span>Where you are right now.</span>
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
          Save
        </button>
        {saved && <span className="muted">Saved.</span>}
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
            <b>Current password</b>
            <span>
              Asked for because a session left open on a shared machine is the
              ordinary way an account is taken.
            </span>
          </span>
          <input
            id="account-current"
            aria-label="Current password"
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
            <b>New password</b>
            <span>
              At least twelve characters. Length is what makes a password hard
              to guess; a short one with symbols in it is not.
            </span>
          </span>
          <input
            id="account-next"
            aria-label="New password"
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
            Changed. Your other sessions stay signed in.
          </span>
        )}
      </div>
    </section>
  );
}

function AppearanceSettings(): ReactElement {
  const { appearance, setTheme, setUiScale, setEditorScale } = useAppearance();

  return (
    <section className="settings-section">
      <h2>Appearance</h2>
      <p className="muted">
        Stored in this browser. A text size that suits a phone is wrong on a
        large monitor, so these do not follow your account between devices.
      </p>

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>Theme</b>
            <span>
              Following the system is the default. Choose one to override it —
              somebody outside in the sun wants light whatever their laptop
              thinks.
            </span>
          </span>
          <select
            id="theme"
            aria-label="Theme"
            value={appearance.theme}
            onChange={(event) => setTheme(event.target.value as ThemePreference)}
          >
            <option value="system">Match the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        {/* Two scales, not one. Someone who wants a denser sidebar does not
            necessarily want smaller prose, and someone writing long documents may
            want larger prose without a larger interface. */}
        <div className="settings-row">
          <span className="settings-row-label">
            <b>Interface text size</b>
            <span>The sidebar, menus and settings — everything but your writing.</span>
          </span>
          <select
            id="ui-scale"
            aria-label="Interface text size"
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
            <b>Editor text size</b>
            <span>Your writing, and nothing else.</span>
          </span>
          <select
            id="editor-scale"
            aria-label="Editor text size"
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

function About(): ReactElement {
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
      <h2>About</h2>

      {stale && (
        <p className="settings-warning">
          This browser is running an older build than the server. Reload to pick
          up the current version — until then, what you see may not match what
          the server does.{' '}
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}

      <dl className="settings-list">
        <dt>Server</dt>
        <dd>
          {server ? (
            <>
              {server.version}
              <span className="muted"> · {server.commit.slice(0, 8)}</span>
            </>
          ) : error ? (
            <span className="error">{messageFor(error)}</span>
          ) : (
            <span className="muted">checking…</span>
          )}
        </dd>

        <dt>This browser</dt>
        <dd>
          {WEB_VERSION}
          <span className="muted"> · {WEB_COMMIT.slice(0, 8)}</span>
        </dd>

        {/* The contract versions, which are what actually decide whether a
            client can talk to a server and open a document. Shown because when
            an upgrade goes wrong these are the numbers that explain why
            (ADR-0013). */}
        <dt>Document format</dt>
        <dd>{server ? `v${server.documentSchema}` : <span className="muted">—</span>}</dd>

        <dt>Sync protocol</dt>
        <dd>{server ? `v${server.syncProtocol}` : <span className="muted">—</span>}</dd>
      </dl>

      <p className="muted" style={{ fontSize: '0.85rem' }}>
        SONE is free software under the AGPL-3.0. No seat limits, no feature
        gates, no enterprise edition.
      </p>
    </section>
  );
}
