/**
 * SONE web — settings.
 *
 * Currently only the About section, which exists to answer one question that
 * came up on the first real deployment: which version is actually running?
 *
 * Two versions are shown, not one, and the distinction is the useful part. The
 * server's version comes over HTTP; the client's is baked into the bundle at
 * build time. A browser holding a cached bundle from an earlier deployment
 * reports the server's version if only asked over HTTP — a reassuring answer
 * about code that is not the code executing. When they disagree, that is said
 * plainly, because a stale bundle is the cause of bug reports nobody can
 * reproduce.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type SessionInfo, type VersionInfo } from '../api/client.ts';
import { WEB_COMMIT, WEB_VERSION, isStaleBundle } from '../buildInfo.ts';
import {
  SCALE_LABELS,
  TEXT_SCALES,
  useAppearance,
  type TextScale,
  type ThemePreference,
} from '../hooks/useAppearance.ts';
import { paths } from '../routes/paths.ts';
import {
  InstancePanel,
  MaintenancePanel,
  UsersPanel,
  WorkspacesPanel,
  useIsInstanceAdmin,
} from './Admin.tsx';
import { messageFor } from './Auth.tsx';
import { GroupsPanel } from './GroupsPanel.tsx';
import { LandingSettings } from './LandingSettings.tsx';
import { WorkspaceDetail } from './WorkspaceDetail.tsx';
import { WorkspaceList } from './WorkspaceList.tsx';
import { InvitePanel } from './InvitePanel.tsx';
import { WorkspaceInvite } from './WorkspaceInvite.tsx';
import { OidcPanel } from './OidcPanel.tsx';
import { ThemeSettings } from './ThemeSettings.tsx';
import { AVATAR_BOUND, webVariant } from '../lib/imageVariant.ts';

interface SettingsProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
  /** Back to the notes. Settings is a screen of its own (ADR-0027). */
  onClose: () => void;
}

/**
 * The sections, in the order they are offered.
 *
 * Instance sections are listed here and filtered at render, rather than being a
 * separate list: one place decides what exists, so an added section cannot be
 * missing from the navigation or reachable without appearing in it.
 */
const SECTIONS = [
  // Three groups, and the names say whose settings they are (ADR-0027).
  //
  // "You" and "Administration" left it unclear which of two "Invite people"
  // entries meant what, because the group named who may change a thing and not
  // what the thing belongs to. These name the subject: yourself, a workspace,
  // or the instance everybody shares.
  { id: 'account', label: 'Account', group: 'You', hint: 'Your name, address and password' },
  { id: 'appearance', label: 'Appearance', group: 'You', hint: 'How SONE looks to you' },
  {
    id: 'landing',
    label: 'Where you land',
    group: 'You',
    hint: 'The page each workspace opens on',
  },

  {
    id: 'workspaces',
    label: 'All workspaces',
    group: 'Workspaces',
    hint: 'Every workspace here, and who is in them',
    manager: true,
  },

  {
    id: 'instance',
    label: 'This instance',
    group: 'Instance',
    hint: 'Name, sign-up and defaults',
    admin: true,
  },
  {
    id: 'accounts',
    label: 'Accounts',
    group: 'Instance',
    hint: 'Everybody with an account here',
    admin: true,
  },
  {
    id: 'invite',
    label: 'Invite to the instance',
    group: 'Instance',
    // Named against the other invitation rather than "Invite people", which was
    // also the name of inviting somebody to a workspace.
    hint: 'An account and a workspace of their own — no team',
    admin: true,
  },
  {
    id: 'sso',
    label: 'Single sign-on',
    group: 'Instance',
    hint: 'Sign in through an identity provider',
    admin: true,
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    group: 'Instance',
    hint: 'Storage, jobs and health',
    admin: true,
  },
  { id: 'about', label: 'About', group: 'Instance', hint: 'Version and licence' },
] as const;

export function Settings({
  section,
  session,
  workspaceId,
  onClose,
}: SettingsProps): ReactElement {
  const { isAdmin } = useIsInstanceAdmin();

  // Only sections this account can actually open. An administration section
  // shown to someone who cannot use it would fail with an error that looks like
  // a bug rather than like a decision.
  // Two rights now, not one (ADR-0027). A section marked `manager` is for
  // whoever may administer workspaces, which an instance administrator is
  // implicitly and somebody granted the right is without being one.
  // Which workspace is open in the list, if any. State rather than a route,
  // because it is a step inside one section and not a place to link to.
  const [openWorkspace, setOpenWorkspace] = useState<{ id: string; name: string } | null>(
    null,
  );

  const canManageWorkspaces = isAdmin === true || session.user.canManageWorkspaces;
  const available = SECTIONS.filter((entry) => {
    if ('admin' in entry) return isAdmin === true;
    if ('manager' in entry) return canManageWorkspaces;
    return true;
  });
  const current = available.some((entry) => entry.id === section)
    ? section
    : available[0]!.id;

  const groups = [...new Set(available.map((entry) => entry.group))];

  return (
    <div className="settings-screen">
      <nav className="settings-nav" aria-label="Settings sections">
        {/* The way back, first and plainly.
          *
          * A screen of its own needs a door out, and it belongs at the top of
          * the navigation rather than in a corner: it is the entry somebody
          * looks for when they have finished, and looking for it should not be
          * part of finishing. */}
        <button type="button" className="settings-back" onClick={onClose}>
          ‹ Back to your notes
        </button>

        {groups.map((group) => (
          <div className="settings-nav-group" key={group}>
            <p className="sidebar-label">{group}</p>
            {available
              .filter((entry) => entry.group === group)
              .map((entry) => (
                <a
                  key={entry.id}
                  className="settings-nav-item"
                  href={paths.settings(entry.id)}
                  title={entry.hint}
                  {...(entry.id === current ? { 'aria-current': 'page' as const } : {})}
                >
                  {/* The name alone.
                    *
                    * A line of explanation under each entry made every one of
                    * them three lines tall, and a navigation that has to be
                    * read is not a navigation — it is a page about the
                    * navigation. The explanation moved onto the entry as its
                    * title, where it is available and not in the way. */}
                  {entry.label}
                </a>
              ))}
          </div>
        ))}
      </nav>

      <div className="settings-body">
        <h1>{available.find((entry) => entry.id === current)?.label ?? 'Settings'}</h1>

        {current === 'account' && <Account session={session} workspaceId={workspaceId} />}
        {current === 'appearance' && <AppearanceSettings />}
        {current === 'workspaces-legacy' && (
          <>
            <WorkspaceSettings session={session} workspaceId={workspaceId} />
            {/* Inviting is a workspace matter, so it sits with the workspace's
                own settings rather than in the administration area — which is
                for the instance. */}
            <WorkspaceInvite workspaceId={workspaceId} />
          </>
        )}
        {current === 'theme' && (
          <ThemeSettings
            workspaceId={workspaceId}
            canEdit={
              // The same two roles the server enforces. Stated here so the
              // controls are disabled rather than failing on save — a form that
              // lets somebody fill it in and then refuses is worse than one
              // that says up front it is read-only.
              session.workspaces.find((entry) => entry.id === workspaceId)?.role === 'owner' ||
              session.workspaces.find((entry) => entry.id === workspaceId)?.role === 'admin'
            }
          />
        )}
        {current === 'instance' && <InstancePanel />}
        {current === 'groups' && <GroupsPanel workspaceId={workspaceId} />}
        {current === 'invite' && <InvitePanel />}
        {current === 'sso' && <OidcPanel />}
        {current === 'accounts' && <UsersPanel />}
        {current === 'landing' && <LandingSettings workspaceId={workspaceId} />}
        {current === 'workspaces' &&
          (openWorkspace ? (
            <WorkspaceDetail
              workspaceId={openWorkspace.id}
              name={openWorkspace.name}
              onBack={() => setOpenWorkspace(null)}
            />
          ) : (
            <WorkspaceList
              currentWorkspaceId={workspaceId}
              onOpen={(id, chosenName) => setOpenWorkspace({ id, name: chosenName })}
              onRestore={(id) => {
                // Restoring is one click, unlike deleting: putting something
                // back is not the action that needs slowing down.
                void api
                  .setWorkspaceDeletion(id, { restore: true })
                  .then(() => window.location.reload());
              }}
            />
          ))}
        {current === 'workspaces-old' && <WorkspacesPanel />}
        {current === 'maintenance' && <MaintenancePanel />}
        {current === 'about' && <About />}
      </div>
    </div>
  );
}

/**
 * The current workspace: who is in it, and what this account may do.
 *
 * Distinct from the instance sections above it. A workspace owner runs their
 * workspace; an instance administrator runs the server. Anyone may create a
 * workspace, so the two cannot be the same permission.
 */
function WorkspaceSettings({
  session,
  workspaceId,
}: {
  session: SessionInfo;
  workspaceId: string;
}): ReactElement {
  const workspace = session.workspaces.find((entry) => entry.id === workspaceId);

  return (
    <section className="settings-section">
      <h2>{workspace?.name ?? 'This workspace'}</h2>
      <dl className="settings-list">
        <dt>Your role</dt>
        <dd>{workspace?.role ?? 'unknown'}</dd>
      </dl>
      <p className="muted settings-note">
        Members and invitations are managed from the workspace switcher. There
        are no seat limits and no paid tiers — every feature is available to
        every installation (ADR-0007).
      </p>
    </section>
  );
}

function Account({
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

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordDone, setPasswordDone] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      <h2>Account</h2>

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

      {/* Changing a password asks for the current one.
        *
        * Not a formality: a session left open on a shared machine is the
        * ordinary way an account is taken, and without this the person who
        * finds it can lock its owner out in two fields. */}
      <h3 className="settings-heading">Password</h3>

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
