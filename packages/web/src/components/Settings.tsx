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
import { WorkspaceDetail } from './WorkspaceDetail.tsx';
import { WorkspaceList } from './WorkspaceList.tsx';
import { InvitePanel } from './InvitePanel.tsx';
import { WorkspaceInvite } from './WorkspaceInvite.tsx';
import { OidcPanel } from './OidcPanel.tsx';
import { ThemeSettings } from './ThemeSettings.tsx';

interface SettingsProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
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

export function Settings({ section, session, workspaceId }: SettingsProps): ReactElement {
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
                  {...(entry.id === current ? { 'aria-current': 'page' as const } : {})}
                >
                  <span className="settings-nav-label">{entry.label}</span>
                  {/* One line saying what is in there.
                    *
                    * A list of nouns makes somebody open three sections to find
                    * one thing, and this area is going to keep growing —
                    * "Invite to the instance" and "Invite somebody here" are
                    * distinguishable by name only once you already know the
                    * difference. */}
                  <span className="settings-nav-hint">{entry.hint}</span>
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
  return (
    <section className="settings-section">
      <h2>Account</h2>
      <dl className="settings-list">
        <dt>Name</dt>
        <dd>{session.user.displayName || '—'}</dd>
        <dt>Email</dt>
        <dd>{session.user.email ?? '—'}</dd>
        <dt>Workspace</dt>
        <dd>
          {workspace?.name ?? '—'}
          {workspace ? ` (${workspace.role})` : ''}
        </dd>
      </dl>
    </section>
  );
}

function AppearanceSettings(): ReactElement {
  const { appearance, setTheme, setUiScale, setEditorScale } = useAppearance();

  return (
    <section className="settings-section">
      <h2>Appearance</h2>
      <p className="muted" style={{ fontSize: '0.85rem', marginBlockStart: 0 }}>
        Stored in this browser. A text size that suits a phone is wrong on a
        large monitor, so these do not follow your account between devices.
      </p>

      <div className="field">
        <label htmlFor="theme">Theme</label>
        <select
          id="theme"
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
      <div className="field">
        <label htmlFor="ui-scale">Interface text size</label>
        <select
          id="ui-scale"
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

      <div className="field">
        <label htmlFor="editor-scale">Editor text size</label>
        <select
          id="editor-scale"
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
